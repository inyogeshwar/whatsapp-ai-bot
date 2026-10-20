/**
 * .group open|close — allow all members / restrict messaging to admins.
 */
export default {
  name: 'group',
  aliases: ['gmode'],
  category: 'admin',
  description: 'Open or close the group for messaging (admin only).',
  usage: '.group open | close',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 5,
  async execute(ctx) {
    const sub = (ctx.command.args[0] ?? '').toLowerCase();
    if (sub !== 'open' && sub !== 'close') {
      await ctx.reply(
        [
          `*Group mode usage*`,
          `${ctx.config.prefix}group open  — everyone can send messages`,
          `${ctx.config.prefix}group close — only admins can send messages`,
        ].join('\n')
      );
      return;
    }
    try {
      // v7 API: 'not_announcement' = everyone, 'announcement' = admins only.
      await ctx.sock.groupSettingUpdate(ctx.chatId, sub === 'open' ? 'not_announcement' : 'announcement');
      await ctx.reply(sub === 'open' ? '✅ Group opened — everyone can send messages.' : '✅ Group closed — only admins can send messages.');
    } catch (error) {
      ctx.logger?.warn?.({ err: error?.message, mode: sub }, 'groupSettingUpdate failed');
      await ctx.reply('❌ Failed to change the group mode. Make sure I am an admin.');
    }
  },
};
