/**
 * .delete / .del — delete the message an admin replies to.
 *
 * The deletion key is constructed ONLY from WhatsApp-provided contextInfo
 * (stanzaId + participant) — arbitrary serialized keys supplied by users are
 * never accepted.
 */
import { hasQuoted } from '../../permissions.js';
import { invalidateMetadata } from '../../services/metadata-cache.js';

export default {
  name: 'delete',
  aliases: ['del'],
  category: 'admin',
  description: 'Delete the replied-to message (admin only, bot must be admin).',
  usage: 'Reply to a message and use .delete',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 3,
  async execute(ctx) {
    if (!hasQuoted(ctx.quoted)) {
      await ctx.reply(`Please *reply* to the message you want to delete, e.g.\n${ctx.config.prefix}delete (as a reply)`);
      return;
    }

    const { key } = ctx.quoted;
    try {
      await ctx.sock.sendMessage(ctx.chatId, { delete: key });
      invalidateMetadata(ctx.chatId);
      await ctx.react('✅');
    } catch (error) {
      await ctx.reply(
        '❌ I could not delete that message. It may be too old, or I lack administrator rights.'
      );
      ctx.logger?.warn?.({ err: error?.message }, 'delete command failed');
    }
  },
};
