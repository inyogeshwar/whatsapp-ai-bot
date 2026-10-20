/**
 * index.js — entry point.
 *
 * Bootstrap order:
 *   1. config (validated .env)      — already loaded at import time
 *   2. logger                        — already built at import time
 *   3. persistent group-settings store
 *   4. moderation store wiring
 *   5. connection manager (QR → connect → event loop)
 *   6. process signal handlers (graceful shutdown)
 */
import { config } from './config.js';
import { logger } from './logger.js';
import { startBot, shutdownBot } from './connection.js';
import { GroupSettingsStore } from './group-settings.js';
import { setModerationStore } from './services/moderation-service.js';

async function main() {
  logger.info(
    {
      bot: config.botName,
      prefix: config.prefix,
      aiEnabled: config.ai.enabled,
      ownerConfigured: Boolean(config.ownerJid),
    },
    'starting WhatsApp AI Bot'
  );

  if (!config.ownerJid) {
    logger.warn(
      'BOT_OWNER_JID is not set — owner-only commands are disabled. Set it in your .env file.'
    );
  }

  // Persistent per-group settings (welcome/goodbye/antilink/rules).
  const settingsStore = await new GroupSettingsStore(config.dataDir).init();
  setModerationStore(settingsStore);

  // Connect (or reuse an existing connection) and start the event loop.
  await startBot(settingsStore);

  // ── Graceful shutdown ──────────────────────────────────────────────
  let shuttingDown = false;
  const graceful = (signal) => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await shutdownBot(signal);
    process.exit(0);
  };

  process.once('SIGINT', graceful('SIGINT'));
  process.once('SIGTERM', graceful('SIGTERM'));

  // If the session is logged out (401 device_removed), connection.js stops
  // reconnecting forever. Exit with a dedicated code so a supervisor
  // (scripts/keep-alive.js) does NOT restart us in a tight loop.
  const { onSessionLost } = await import('./connection.js');
  onSessionLost(() => {
    logger.fatal('exiting with code 2 — session lost, re-scan required');
    process.exit(2);
  });

  // Last-resort safety net: log and keep going; per-message errors are
  // already isolated inside the handler pipeline.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason instanceof Error ? reason?.message : String(reason) }, 'unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error?.message, stack: error?.stack }, 'uncaughtException — shutting down');
    shutdownBot('uncaughtException').finally(() => process.exit(1));
  });
}

main().catch((error) => {
  // Startup failures (bad config, unreadable auth dir…) are fatal and must
  // be readable by a beginner.
  logger.fatal({ err: error?.message }, 'failed to start — fix the issue above and run npm start again');
  process.exit(1);
});
