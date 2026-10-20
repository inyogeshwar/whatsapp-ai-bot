/**
 * .uptime — how long this bot process has been running.
 */
import { formatMs } from '../../utils/text.js';

const startedAt = Date.now();

export default {
  name: 'uptime',
  aliases: ['up'],
  category: 'general',
  description: 'Show how long the bot has been running.',
  usage: '.uptime',
  cooldown: 3,
  async execute(ctx) {
    const upMs = Date.now() - startedAt;
    const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    await ctx.reply(
      `🤖 *${ctx.config.botName}* uptime: ${formatMs(upMs)}\n` +
        `💾 Memory: ${memMb} MB\n` +
        `🟢 Node ${process.version}`
    );
  },
};
