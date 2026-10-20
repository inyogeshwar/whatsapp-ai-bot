/**
 * .admins — list/mention the group administrators.
 */
import { mentionOf } from '../../utils/group.js';

export default {
  name: 'admins',
  aliases: ['adminlist'],
  category: 'general',
  description: 'Mention the group administrators.',
  usage: '.admins',
  groupOnly: true,
  cooldown: 10,
  async execute(ctx) {
    const meta = ctx.groupMetadata;
    if (!meta) {
      await ctx.reply('Could not fetch the member list right now. Please try again.');
      return;
    }
    const admins = (meta.participants ?? []).filter(
      (p) => p.admin === 'admin' || p.admin === 'superadmin'
    );
    if (admins.length === 0) {
      await ctx.reply('No administrator information is available for this group.');
      return;
    }
    const mentions = admins.map((p) => p.id).filter(Boolean);
    const names = mentions.map((jid) => mentionOf(jid)).join(' ');
    await ctx.sock.sendMessage(
      ctx.chatId,
      { text: `🛡 *Group administrators:*\n${names}`, mentions },
      { quoted: ctx.message }
    );
  },
};
