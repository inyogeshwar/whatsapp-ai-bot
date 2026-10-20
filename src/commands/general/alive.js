/**
 * .alive — bot status card.
 * Shows only safe operational info: no secrets, no paths, no session data.
 */
import { BOT_VERSION } from '../../config.js';
import { formatUptime } from '../../utils/text.js';

const START_TIME = Date.now();

export default {
  name: 'alive',
  aliases: ['status'],
  category: 'general',
  description: 'Show bot status and uptime.',
  usage: '.alive',
  cooldown: 5,
  async execute(ctx) {
    const uptimeSec = (Date.now() - START_TIME) / 1000;
    const lines = [
      `╭─ *${ctx.config.botName}* ─ status`,
      `│ 🟢 Online`,
      `│ ⏱ Uptime: ${formatUptime(uptimeSec)}`,
      `│ 🟢 Node.js: ${process.version}`,
      `│ 📦 Bot version: ${BOT_VERSION}`,
      `│ 🕒 ${new Date().toUTCString()}`,
      '╰────────────────',
    ];
    await ctx.reply(lines.join('\n'));
  },
};
