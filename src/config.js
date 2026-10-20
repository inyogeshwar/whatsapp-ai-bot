/**
 * config.js — environment loading and validation.
 *
 * All runtime configuration comes from `.env` (see `.env.example`).
 * Values are validated at startup with beginner-readable error messages.
 * Nothing here is ever logged wholesale — callers pick safe fields.
 */
import 'dotenv/config';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

/** Thrown when the environment is unusable; message is operator-facing. */
export class ConfigError extends Error {}

/** Read a trimmed string or return the default. */
function str(env, key, fallback = '') {
  const raw = env[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value === '' ? fallback : value;
}

/** Read a positive integer (or return the default); throws on garbage. */
function int(env, key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = str(env, key);
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(
      `${key} must be an integer between ${min} and ${max} (got "${raw}"). Fix it in your .env file.`
    );
  }
  return value;
}

function bool(env, key, fallback = false) {
  const raw = str(env, key).toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${key} must be true or false (got "${raw}"). Fix it in your .env file.`);
}

/**
 * Normalize a configured owner identifier into a comparable JID.
 *
 * Baileys v7 uses two identity forms (PN `...@s.whatsapp.net` and LID `...@lid`)
 * and device suffixes (`:2`). We accept:
 *   - bare digits           → assume phone number (PN JID), include country code
 *   - a full JID with @     → kept as-is, normalized (device suffix stripped)
 * Returns null when unset (owner-only features disabled).
 */
export function normalizeOwnerJid(raw) {
  const value = (raw || '').trim();
  if (value === '') return null;
  if (value.includes('@')) {
    if (!/^[0-9]+[:@]/.test(value)) {
      throw new ConfigError(
        `BOT_OWNER_JID "${value}" is not a valid WhatsApp JID. Use digits with country code (e.g. 15551234567) or a full JID like 15551234567@s.whatsapp.net`
      );
    }
    return jidNormalizedUser(value);
  }
  if (!/^\d+$/.test(value)) {
    throw new ConfigError(
      `BOT_OWNER_JID "${value}" is invalid. Use digits with country code only (e.g. 15551234567), no +, spaces or dashes.`
    );
  }
  return jidNormalizedUser(`${value}@s.whatsapp.net`);
}

/**
 * Build and validate the frozen configuration object.
 * @param {NodeJS.ProcessEnv} [env] injected for tests
 */
export function loadConfig(env = process.env) {
  const prefix = str(env, 'BOT_PREFIX', '.');
  if (prefix.length !== 1) {
    throw new ConfigError(`BOT_PREFIX must be exactly one character (got "${prefix}").`);
  }

  const aiProvider = str(env, 'AI_PROVIDER', 'ollama').toLowerCase();
  const aiProviderAliases = {
    ollama: 'ollama',
    // OpenAI-compatible gateways: FreeLLMAPI, LM Studio, llama.cpp --api,
    // vLLM, OpenAI itself, etc. All speak /v1/chat/completions.
    openai: 'openai',
    'openai-compatible': 'openai',
    freellmapi: 'openai',
    lmstudio: 'openai',
  };
  const resolvedAiProvider = aiProviderAliases[aiProvider];
  if (!resolvedAiProvider) {
    throw new ConfigError(
      `AI_PROVIDER "${aiProvider}" is not supported. Use "ollama" or "openai" (OpenAI-compatible gateways like FreeLLMAPI, LM Studio, vLLM).`
    );
  }
  if (resolvedAiProvider === 'openai' && str(env, 'AI_API_KEY') === '') {
    throw new ConfigError(
      'AI_PROVIDER is OpenAI-compatible but AI_API_KEY is empty. Set AI_API_KEY in your .env file (FreeLLMAPI/LM Studio keys also go here).'
    );
  }

  const logLevel = str(env, 'LOG_LEVEL', 'info').toLowerCase();
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  if (!validLevels.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL "${logLevel}" is invalid. Use one of: ${validLevels.join(', ')}.`);
  }

  const config = {
    botName: str(env, 'BOT_NAME', 'My WhatsApp Bot'),
    ownerName: str(env, 'BOT_OWNER_NAME', 'Bot Owner'),
    /** Normalized owner JID (PN or LID form), or null when not configured. */
    ownerJid: normalizeOwnerJid(env.BOT_OWNER_JID),
    prefix,
    logLevel,
    authDir: str(env, 'AUTH_DIR', 'auth'),
    dataDir: str(env, 'DATA_DIR', 'data'),
    /**
     * Optional local QR image path for background/headless runs (pm2, VPS).
     * Empty = disabled (terminal QR only). The file is deleted on login and
     * must be git-ignored — treat it like the auth/ folder.
     */
    qrImage: str(env, 'QR_IMAGE_PATH'),

    /**
     * Login method:
     *   'qr'      → render a QR (terminal + optional QR_IMAGE_PATH image)
     *   'pairing' → render an 8-digit pairing code for a phone number
     *
     * Pairing codes are far more stable than QR with Baileys: no repeated
     * re-scans, which is the usual cause of `device_removed` (401) logouts.
     */
    loginMethod: str(env, 'LOGIN_METHOD', 'qr').toLowerCase() === 'pairing' ? 'pairing' : 'qr',
    /** Phone number (digits, country code) required when LOGIN_METHOD=pairing. */
    pairingNumber: str(env, 'PAIRING_NUMBER').replace(/[^0-9]/g, ''),

    /** Web utilities (weather, dictionary, url shortener) — all keyless APIs. */
    web: {
      enabled: bool(env, 'WEB_ENABLED', true),
      timeoutMs: int(env, 'WEB_TIMEOUT_MS', 15_000, { min: 1000, max: 60_000 }),
    },

    /** Sticker rendering limits. */
    sticker: {
      /** Max source media size accepted before conversion (bytes). */
      maxSizeBytes: int(env, 'STICKER_MAX_BYTES', 2_000_000, { min: 100_000, max: 10_000_000 }),
      /** Optional author name stamped into sticker metadata. */
      author: str(env, 'STICKER_AUTHOR', 'Yogesh Bot'),
      pack: str(env, 'STICKER_PACK', 'WhatsApp AI Bot'),
    },

    ai: {
      enabled: bool(env, 'AI_ENABLED', false),
      provider: resolvedAiProvider,
      baseUrl: str(env, 'AI_BASE_URL', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
      /** Optional bearer token for OpenAI-compatible gateways (never logged). */
      apiKey: str(env, 'AI_API_KEY'),
      model: str(env, 'AI_MODEL', ''),
      maxInput: int(env, 'AI_MAX_INPUT', 2000, { min: 1, max: 100_000 }),
      maxOutput: int(env, 'AI_MAX_OUTPUT', 4000, { min: 1, max: 100_000 }),
      timeoutMs: int(env, 'AI_TIMEOUT_MS', 30_000, { min: 1000, max: 300_000 }),
      rateLimit: int(env, 'AI_RATE_LIMIT', 5, { min: 1, max: 1000 }),
      rateWindowSec: int(env, 'AI_RATE_WINDOW_SEC', 60, { min: 1, max: 3600 }),
    },

    limits: {
      commandRateLimit: int(env, 'CMD_RATE_LIMIT', 8, { min: 1, max: 1000 }),
      commandRateWindowSec: int(env, 'CMD_RATE_WINDOW_SEC', 10, { min: 1, max: 3600 }),
      tagallCooldownSec: int(env, 'TAGALL_COOLDOWN_SEC', 60, { min: 5, max: 3600 }),
      tagallBatchSize: int(env, 'TAGALL_BATCH_SIZE', 250, { min: 10, max: 1000 }),
      maxTextLength: int(env, 'MAX_TEXT_LENGTH', 4000, { min: 100, max: 100_000 }),
      maxMentions: int(env, 'MAX_MENTIONS', 500, { min: 1, max: 5000 }),
    },
  };

  if (config.ai.enabled && config.ai.model === '') {
    throw new ConfigError(
      'AI_ENABLED=true but AI_MODEL is empty. Set AI_MODEL to a model your provider offers (e.g. "gemini-3.5-flash" for FreeLLMAPI, or "llama3.2" for Ollama).'
    );
  }

  if (config.loginMethod === 'pairing' && config.pairingNumber === '') {
    throw new ConfigError(
      'LOGIN_METHOD=pairing but PAIRING_NUMBER is empty. Set PAIRING_NUMBER to your WhatsApp number with country code, digits only (e.g. 15551234567).'
    );
  }

  return Object.freeze(config);
}

/** The bot's own configured version (shown by .alive). */
export const BOT_VERSION = '1.0.0';

/** Loaded once at import time by src/index.js and reused everywhere. */
export const config = loadConfig();
