/**
 * logger.js — structured logging with sensitive-data redaction.
 *
 * Everything in the bot logs through this module so that a single place
 * guarantees secrets (credentials, keys, QR payloads, message bodies)
 * never end up in the console or a log file.
 */
import pino from 'pino';

const LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Redaction paths remove secret-ish fields if anything ever passes them in.
 * We deliberately keep chat/user IDs (needed for operations) but never full
 * message bodies, credentials or keys.
 */
const REDACT_PATHS = [
  'creds',
  'keys',
  'token',
  'authorization',
  'password',
  'qr',
  'pairingCode',
  'message.message',
  'msg.message',
  '*.creds',
  '*.keys',
  '*.token',
  '*.qr',
];

export const logger = pino({
  level: LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { app: 'whatsapp-ai-bot' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Create a namespaced child logger, e.g. createLogger('connection'). */
export function createLogger(name) {
  return logger.child({ module: name });
}

export default logger;
