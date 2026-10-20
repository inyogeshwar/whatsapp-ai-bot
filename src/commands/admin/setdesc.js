/**
 * .setdesc <description> — update the group description.
 */
export default {
  name: 'setdesc',
  aliases: ['desc'],
  category: 'admin',
  description: 'Change the group description (admin only).',
  usage: '.setdesc <new description>',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 10,
  async execute(ctx) {
    const desc = ctx.command.argText.trim();
    if (desc === '') {
      await ctx.reply(`Example: ${ctx.config.prefix}setdesc Welcome to our group!`);
      return;
    }
    if (desc.length > 2000) {
      await ctx.reply('Descriptions are limited to 2000 characters.');
      return;
    }
    try {
      await ctx.sock.groupUpdateDescription(ctx.chatId, desc);
      await ctx.reply('✅ Group description updated.');
    } catch (error) {
      ctx.logger?.warn?.({ err: error?.message }, 'groupUpdateDescription failed');
      await ctx.reply('❌ Failed to update the description. Make sure I am an admin.');
    }
  },
};
