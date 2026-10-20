/**
 * .ping — latency check.
 */
import { formatMs } from '../../utils/text.js';

export default {
  name: 'ping',
  aliases: ['p'],
  category: 'general',
  description: 'Check the bot response time.',
  usage: '.ping',
  cooldown: 3,
  async execute(ctx) {
    const started = Date.now();
    const sent = await ctx.reply('🏓 Pong!');
    const roundTrip = Date.now() - started;
    if (sent) {
      // Edit the placeholder with the measured time (works on v7).
      try {
        await ctx.sock.sendMessage(ctx.chatId, {
          text: `🏓 Pong! Response time: ${formatMs(roundTrip)}`,
          edit: sent.key,
        });
        return;
      } catch {
        // Edit unsupported (old message/device) — fall through to plain reply.
      }
    }
    await ctx.reply(`🏓 Pong! Response time: ${formatMs(roundTrip)}`);
  },
};
