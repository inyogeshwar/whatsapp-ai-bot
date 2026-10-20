/**
 * keep-alive.js — a tiny supervisor around `npm start`.
 *
 * Why this exists:
 *   WhatsApp sometimes drops the socket with transient codes (408/428/500)
 *   and, rarely, kicks the linked device (401 device_removed). The bot itself
 *   already reconnects on transient codes — this supervisor only restarts the
 *   PROCESS if it exits unexpectedly, so the bot never stays down.
 *
 * How it behaves:
 *   - spawns `node src/index.js`
 *   - if the child exits with code 0 (clean shutdown) → stop, no restart
 *   - if the child exits with a non-zero code → restart after a short delay
 *   - a 401 logout (exit code 2 from index.js) → stop and tell the human
 *   - Ctrl+C stops the supervisor and the child together
 *
 * Usage:  node scripts/keep-alive.js      (or: npm run keep-alive)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'index.js');

const RESTART_DELAY_MS = 5_000;
const EXIT_LOGGED_OUT = 2; // set by index.js when the session is dead

let stopping = false;
let restarts = 0;

function stamp() {
  return new Date().toISOString();
}

function start() {
  console.log(`[keep-alive ${stamp()}] starting bot (restart #${restarts})`);

  const child = spawn(process.execPath, [entry], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;

    if (signal) {
      console.log(`[keep-alive ${stamp()}] bot killed by ${signal} — restarting`);
      scheduleRestart();
      return;
    }

    if (code === EXIT_LOGGED_OUT) {
      console.error(
        `[keep-alive ${stamp()}] SESSION LOGGED OUT (401 device_removed).\n` +
          `  Delete the auth/ folder, run the bot once, and scan the new QR.\n` +
          `  Not restarting in a loop.\n`
      );
      process.exit(EXIT_LOGGED_OUT);
    }

    if (code === 0) {
      console.log(`[keep-alive ${stamp()}] bot exited cleanly — stopping`);
      process.exit(0);
    }

    console.error(`[keep-alive ${stamp()}] bot exited with code ${code} — restarting`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  restarts += 1;
  setTimeout(start, RESTART_DELAY_MS).unref?.();
  // Keep the supervisor alive for the pending restart.
  setTimeout(() => {}, RESTART_DELAY_MS);
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n[keep-alive ${stamp()}] received ${signal} — stopping bot`);
  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

start();
