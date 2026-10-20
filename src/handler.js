/**
 * handler.js — the central message pipeline.
 *
 * Flow for every incoming message (messages.upsert, type 'notify'):
 *   filter → dedupe → anti-link moderation → parse → rate limit →
 *   permission gates → build context → dispatch to the command module.
 *
 * Every stage is wrapped so that a single bad message can never crash the
 * bot or block the rest of the batch.
 */
import { config } from './config.js';
import { createLogger } from './logger.js';
import { CommandRegistry } from './command-registry.js';
import { registerAllCommands } from './commands/register.js';
import {
  extractText,
  parseCommand,
  isProtocolMessage,
  isProcessableMessage,
} from './message-parser.js';
import { isGroupJid, isSystemJid, senderFromKey } from './utils/jid.js';
import { buildContext } from './utils/message.js';
import { evaluateAccess, isOwner } from './permissions.js';
import { RateLimiter, CooldownTracker, RecentSet } from './rate-limiter.js';
import { checkAntiLink } from './services/moderation-service.js';
import { fetchMetadata } from './services/metadata-cache.js';

const log = createLogger('handler');

/** The command registry used at runtime (populated once per process). */
export const registry = new CommandRegistry();
registerAllCommands(registry);

// ── Pipeline state (bounded; module-level is fine for a single bot) ──────
const processedIds = new RecentSet(15 * 60 * 1000, 20_000); // message dedupe
const commandLimiter = new RateLimiter(config.limits.commandRateLimit, config.limits.commandRateWindowSec);
const userCooldowns = new CooldownTracker();
const groupCooldowns = new CooldownTracker(); // e.g. .tagall per group

/** Reset pipeline counters (tests only). */
export function resetPipelineState() {
  processedIds.reset();
  commandLimiter.reset();
  userCooldowns.reset();
  groupCooldowns.reset();
}

/** Exposed so commands like .tagall can enforce per-group cooldowns. */
export function enforceGroupCooldown(groupJid, seconds) {
  return groupCooldowns.checkAndStart(`group:${groupJid}`, seconds);
}

/** Handle one messages.upsert event. Never throws. */
export async function handleUpsert(sock, event) {
  // Only real-time messages. 'append' is history backfill — never re-notify.
  if (!event || event.type !== 'notify') return;

  const messages = Array.isArray(event.messages) ? event.messages : [];
  for (const message of messages) {
    try {
      await processMessage(sock, message);
    } catch (error) {
      // Per-message isolation: log and continue with the next message.
      log.error(
        { err: error?.message, stack: error?.stack?.split('\n')[1] ?? undefined },
        'error.unhandled while processing message'
      );
    }
  }
}

/** Process a single WAMessage. Never throws. */
async function processMessage(sock, message) {
  // ── Structural filters ─────────────────────────────────────────────
  if (!isProcessableMessage(message)) return;
  if (isSystemJid(message.key.remoteJid)) return; // status/broadcast/newsletter
  if (isProtocolMessage(message.message)) return; // revokes, admin events…

  // Debug visibility: every real-time message the socket receives.
  log.info(
    {
      chat: message.key.remoteJid?.split('@')[0] ?? 'unknown',
      fromMe: Boolean(message.key.fromMe),
      text: extractText(message.message)?.slice(0, 60) ?? '',
    },
    'message.received'
  );

  if (message.key.fromMe) return; // never act on our own messages

  // Dedupe: WhatsApp can deliver the same message id twice across reconnects.
  const dedupeKey = `${message.key.remoteJid}:${message.key.id}`;
  if (processedIds.has(dedupeKey)) return;

  const text = extractText(message.message);

  // ── Anti-link moderation (groups; runs for any text, command or not) ──
  if (isGroupJid(message.key.remoteJid)) {
    try {
      await checkAntiLink(sock, message, text);
    } catch (error) {
      log.error({ err: error?.message }, 'moderation.error in anti-link check');
    }
  }

  // ── Command parsing ────────────────────────────────────────────────
  const command = parseCommand(text, config.prefix);
  if (!command) return; // ordinary chat message — nothing to dispatch

  const cmd = registry.get(command.name);
  if (!cmd) return; // unknown command: stay silent (typo or other bot's prefix)

  const senderKey = senderFromKey(message.key);
  const senderId = senderKey.id ?? 'unknown';

  // ── Rate limits ────────────────────────────────────────────────────
  const limit = commandLimiter.consume(`user:${senderId}`);
  if (!limit.allowed) {
    await safeReply(
      sock,
      message,
      `⏳ You are sending commands too quickly. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`
    );
    log.warn({ command: cmd.name, chat: 'rate-limited' }, 'command.denied');
    return;
  }

  if (cmd.cooldown > 0) {
    const cd = userCooldowns.checkAndStart(`cmd:${senderId}:${cmd.name}`, cmd.cooldown);
    if (cd.onCooldown) {
      await safeReply(sock, message, `⏳ Please wait ${cd.remainingSec}s before using .${cmd.name} again.`);
      return;
    }
  }

  // ── Context + permissions ─────────────────────────────────────────
  const groupMetadata = isGroupJid(message.key.remoteJid)
    ? await fetchMetadata(sock, message.key.remoteJid)
    : null;

  const ctx = buildContext({ sock, message, command, settings: null, groupMetadata });
  ctx.settings = settingsStoreRef; // GroupSettingsStore (may be null in tests)
  ctx.registry = registry; // so .menu can render categories

  // Owner resolution (async: may bridge PN ↔ LID via the signal mapping store).
  ctx.isOwner = await isOwner(sock, [ctx.senderId, ctx.senderAltId].filter(Boolean), config);

  const access = await evaluateAccess(ctx, cmd, sock);
  if (!access.ok) {
    await safeReply(sock, message, `⛔ ${access.userMessage}`);
    return;
  }

  // ── Dispatch ───────────────────────────────────────────────────────
  const started = Date.now();
  try {
    await cmd.execute(ctx);
    log.info(
      { command: cmd.name, chat: ctx.isGroup ? 'group' : 'private', ms: Date.now() - started },
      'command.executed'
    );
  } catch (error) {
    log.error(
      { command: cmd.name, err: error?.message, stack: error?.stack?.split('\n').slice(1, 3).join(' | ') },
      'command failed'
    );
    await safeReply(
      sock,
      message,
      `❌ Something went wrong while running .${cmd.name}. The error was logged on the bot console.`
    );
  }
}

/** Reply helper that never throws (used by the pipeline itself). */
async function safeReply(sock, message, text) {
  try {
    await sock.sendMessage(message.key.remoteJid, { text }, { quoted: message });
  } catch {
    /* ignore */
  }
}

// The settings store is injected by attachHandler so handler.js stays
// importable in tests without touching the filesystem.
let settingsStoreRef = null;

/** Wire the pipeline to a socket. Called once per socket instance. */
export function attachHandler(sock, { settingsStore } = {}) {
  settingsStoreRef = settingsStore ?? null;
  sock.ev.on('messages.upsert', (event) => {
    handleUpsert(sock, event).catch((error) => {
      log.error({ err: error?.message }, 'pipeline failure');
    });
  });
  log.debug('message handler attached');
}

export default { attachHandler, handleUpsert, registry, resetPipelineState, enforceGroupCooldown };
