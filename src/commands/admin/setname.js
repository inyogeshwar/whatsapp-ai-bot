/**
 * .setname <name> — update the group subject.
 */
export default {
  name: 'setname',
  aliases: ['subject'],
  category: 'admin',
  description: 'Change the group name (admin only).',
  usage: '.setname <new name>',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 10,
  async execute(ctx) {
    const name = ctx.command.argText.trim();
    if (name === '') {
      await ctx.reply(`Example: ${ctx.config.prefix}setname My Group Name`);
      return;
    }
    if (name.length > 100) {
      await ctx.reply('Group names are limited to 100 characters.');
      return;
    }
    try {
      await ctx.sock.groupUpdateSubject(ctx.chatId, name);
      await ctx.reply(`✅ Group name updated to: *${name}*`);
    } catch (error) {
      ctx.logger?.warn?.({ err: error?.message }, 'groupUpdateSubject failed');
      await ctx.reply('❌ Failed to update the group name. Make sure I am an admin.');
    }
  },
};
