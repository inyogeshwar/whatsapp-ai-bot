/**
 * connection.js — the ONLY module that talks to makeWASocket.
 *
 * Responsibilities:
 *   - create the socket (ESM-safe default import), auth via useMultiFileAuthState
 *     wrapped in makeCacheableSignalKeyStore, persisted to the auth/ directory
 *   - login two ways, chosen by LOGIN_METHOD:
 *       'qr'      → render the login QR in the LOCAL TERMINAL only (never chat,
 *                   never logs, never a web page), optional QR_IMAGE_PATH image
 *       'pairing' → request an 8-digit pairing code for PAIRING_NUMBER and
 *                   print it in the local terminal
 *   - reconnect policy: exponential backoff + jitter for transient failures,
 *     immediate restart for 515, permanent stop for logged-out (401)
 *   - singleton guarantees: one socket, one handler set, no overlapping
 *     reconnect attempts, idempotent start
 *   - controlled shutdown on SIGINT/SIGTERM
 */
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { toFile as qrWriteFile } from 'qrcode';
import { unlink } from 'node:fs/promises';

import { config, BOT_VERSION } from './config.js';
import { createLogger } from './logger.js';
import { attachHandler, resetPipelineState } from './handler.js';
import { attachWelcomeService } from './services/welcome-service.js';
import { setCachedMetadata } from './services/metadata-cache.js';

const log = createLogger('connection');

/**
 * Optional QR image for headless/background runs (pm2, VPS, containers):
 * enable with `QR_IMAGE_PATH=qr.png` in .env. The file is LOCAL-ONLY,
 * git-ignored, and deleted as soon as the login completes. Never serve it.
 */
const qrImagePath = config.qrImage;

const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/** Module-level runtime guard — the singleton. */
const runtime = {
  sock: null,
  saveCreds: null,
  starting: false,
  shuttingDown: false,
  reconnectAttempts: 0,
  reconnectTimer: null,
  lastQr: null,
  onSessionLost: null,
};

/** Exposed for commands/index that need the live socket (e.g. .owner info). */
export function getCurrentSocket() {
  return runtime.sock;
}

/**
 * Register a callback fired when the session is permanently lost (401).
 * Used by index.js to exit with a code a supervisor can recognise.
 */
export function onSessionLost(cb) {
  runtime.onSessionLost = typeof cb === 'function' ? cb : null;
}

/** Exponential backoff with ±25% jitter, capped. */
function backoffDelay(attempt) {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(exponential + jitter));
}

/** Clear listeners/timers of a previous socket before replacing it. */
function cleanupSocket(sock) {
  if (!sock) return;
  try {
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('creds.update');
    sock.ev.removeAllListeners('messages.upsert');
    sock.ev.removeAllListeners('group-participants.update');
    sock.ev.removeAllListeners('groups.update');
    sock.end(undefined);
  } catch {
    // Old socket may already be dead — that is fine.
  }
}

function scheduleReconnect(startBot, delayMs, reason) {
  if (runtime.reconnectTimer || runtime.shuttingDown) return;
  runtime.reconnectAttempts += 1;
  const attempt = runtime.reconnectAttempts;
  log.warn(
    { attempt, max: MAX_RECONNECT_ATTEMPTS, delayMs, reason },
    'connection.reconnect_attempt'
  );
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    startBot().catch((error) => {
      log.error({ err: error?.message }, 'reconnect failed');
    });
  }, delayMs);
  // IMPORTANT: keep the process alive while a reconnect is pending. Without
  // this, if the socket is the only active handle, Node sees nothing left to
  // do and exits — which a supervisor would read as a clean shutdown.
}

/**
 * Start (or restart) the bot. Idempotent: safe to call while starting/online.
 * @param {import('./group-settings.js').GroupSettingsStore} settingsStore
 */
export async function startBot(settingsStore) {
  if (runtime.shuttingDown) return runtime.sock;
  if (runtime.starting) return runtime.sock;
  if (runtime.sock) return runtime.sock;
  runtime.starting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    runtime.saveCreds = saveCreds;

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log),
      },
      // QR is rendered by US from the `qr` event — printQRInTerminal is
      // deprecated in v7 and intentionally not used.
      browser: Browsers.ubuntu('WhatsApp AI Bot'),
      // Privacy: do not broadcast an "online" presence to every chat.
      markOnlineOnConnect: false,
      // Keep memory bounded: no full history sync for a bot.
      syncFullHistory: false,
      // Serve group metadata from our TTL cache when available.
      cachedGroupMetadata: async (jid) => {
        const { getCachedMetadata } = await import('./services/metadata-cache.js');
        return getCachedMetadata(jid) ?? undefined;
      },
      logger: log.child({ module: 'baileys' }),
    });

    runtime.sock = sock;
    runtime.lastQr = null;

    // ── Event wiring (exactly once per socket instance) ──────────────
    sock.ev.on('creds.update', saveCreds);

    // Pairing-code login state. The code can ONLY be requested once the socket
    // is actually ready to accept it — requesting immediately after
    // makeWASocket throws "Connection Closed". The reliable trigger is the
    // first `qr` update, which fires exactly when the socket is ready.
    const alreadyRegistered = state.creds?.registered === true;
    const usePairing = config.loginMethod === 'pairing' && !alreadyRegistered;
    let pairingRequested = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Pairing-code login: request on the first ready signal (the qr event),
      // even though we never print the QR itself in this mode.
      if (qr && usePairing && !pairingRequested) {
        pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(config.pairingNumber);
          const pretty = String(code).match(/.{1,4}/g)?.join('-') ?? code;
          log.info(
            'Pairing code generated — enter it in WhatsApp > Linked Devices > Link with phone number.'
          );
          log.warn('Never share this pairing code with anyone — it grants access to your account.');
          // Printed to the LOCAL terminal only. The code is only valid for a
          // few minutes — tell the operator how long they have.
          console.log(
            `\n  ╔════════════════════════════════════════════╗\n` +
              `  ║  WhatsApp pairing code:  ${pretty}          \n` +
              `  ║                                            \n` +
              `  ║  Enter it within ~2 MINUTES:               \n` +
              `  ║  WhatsApp > Settings > Linked Devices >    \n` +
              `  ║  Link a Device > Link with phone number    \n` +
              `  ╚════════════════════════════════════════════╝\n`
          );
        } catch (error) {
          log.error(
            { err: error?.message },
            'pairing_code_failed — falling back to QR. Check PAIRING_NUMBER and try again.'
          );
        }
      }

      // QR rendering — LOCAL TERMINAL ONLY. Never send this anywhere else.
      // Skipped entirely when the operator chose pairing-code login.
      if (qr && !usePairing) {
        if (qr !== runtime.lastQr) {
          runtime.lastQr = qr;
          log.info('New login QR generated — scan it with WhatsApp on your phone.');
          log.warn('Never share this QR code or a pairing code with anyone — it grants access to your account.');
          qrcode.generate(qr, { small: true });
          if (qrImagePath) {
            try {
              await qrWriteFile(qrImagePath, qr, { width: 640, margin: 2 });
              log.info(
                { path: qrImagePath },
                'QR image also written locally — open the file to scan, delete it after login.'
              );
            } catch (error) {
              log.warn({ err: error?.message }, 'qr_image_write_failed');
            }
          }
        }
      }

      if (connection === 'open') {
        runtime.reconnectAttempts = 0;
        if (qrImagePath) {
          unlink(qrImagePath).catch(() => {}); // stale QR must not linger
        }
        log.info(
          { bot: sock.user?.id?.split(':')[0] ?? 'unknown', version: BOT_VERSION },
          'connection.open — connected to WhatsApp'
        );
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : lastDisconnect?.error?.output?.statusCode;

        log.warn({ statusCode }, 'connection.close');

        if (runtime.shuttingDown) return;

        if (statusCode === DisconnectReason.loggedOut) {
          log.fatal(
            'Session was logged out. Delete the auth/ folder and restart the bot to scan a new QR code. Not reconnecting.'
          );
          runtime.sock = null;
          runtime.onSessionLost?.();
          return;
        }

        if (runtime.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          log.fatal(
            { attempts: runtime.reconnectAttempts },
            'Gave up reconnecting after maximum attempts. Check your internet connection and restart the bot manually.'
          );
          runtime.sock = null;
          return;
        }

        if (statusCode === DisconnectReason.restartRequired) {
          // 515: WhatsApp asked us to restart — reconnect immediately.
          cleanupSocket(sock);
          runtime.sock = null;
          runtime.reconnectAttempts = 0;
          runtime.starting = false;
          setImmediate(() => startBot(settingsStore));
          return;
        }

        // Transient failure: exponential backoff + jitter, then retry.
        cleanupSocket(sock);
        runtime.sock = null;
        runtime.starting = false;
        scheduleReconnect(startBot, backoffDelay(runtime.reconnectAttempts), `code=${statusCode}`);
      }
    });

    attachHandler(sock, { settingsStore });
    attachWelcomeService(sock, { settingsStore });

    // Keep the metadata cache warm on group changes.
    sock.ev.on('groups.update', (updates) => {
      for (const update of updates ?? []) {
        if (update?.id) setCachedMetadata(update.id, update);
      }
    });

    log.info(
      { registered: state.creds?.registered === true },
      runtime.reconnectAttempts > 0 ? 'reconnecting to WhatsApp' : 'starting bot'
    );
    return sock;
  } finally {
    runtime.starting = false;
  }
}

/**
 * Graceful shutdown: stops reconnects, closes the socket, flushes state.
 * Safe to call multiple times.
 */
export async function shutdownBot(signal = 'manual') {
  if (runtime.shuttingDown) return;
  runtime.shuttingDown = true;
  log.info({ signal }, 'shutdown.signal — closing connection');

  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }

  const sock = runtime.sock;
  runtime.sock = null;
  if (sock) {
    try {
      cleanupSocket(sock);
    } catch {
      // ignore — we are exiting anyway
    }
  }
}

/** Reset internal counters (used by tests). */
export function _resetRuntimeForTests() {
  runtime.sock = null;
  runtime.saveCreds = null;
  runtime.starting = false;
  runtime.shuttingDown = false;
  runtime.reconnectAttempts = 0;
  runtime.lastQr = null;
  runtime.onSessionLost = null;
  resetPipelineState();
}
