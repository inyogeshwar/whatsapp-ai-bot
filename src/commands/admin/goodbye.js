/**
 * .goodbye on|off|status|set <template> — goodbye message configuration.
 * Template placeholders: {user} (mention) and {group} (group name).
 */
export default {
  name: 'goodbye',
  aliases: ['bye'],
  category: 'admin',
  description: 'Configure the goodbye message for members who leave.',
  usage: '.goodbye on | off | status | set <template with {user} and {group}>',
  groupOnly: true,
  adminOnly: true,
  cooldown: 3,
  async execute(ctx) {
    const settings = ctx.settings.get(ctx.chatId);
    const sub = (ctx.command.args[0] ?? '').toLowerCase();

    switch (sub) {
      case 'on':
        await ctx.settings.update(ctx.chatId, { goodbye: { ...settings.goodbye, enabled: true } });
        await ctx.reply('✅ Goodbye messages are now *ON*.');
        return;
      case 'off':
        await ctx.settings.update(ctx.chatId, { goodbye: { ...settings.goodbye, enabled: false } });
        await ctx.reply('✅ Goodbye messages are now *OFF*.');
        return;
      case 'set': {
        const template = ctx.command.argText.replace(/^set\s+/i, '').trim();
        if (template === '') {
          await ctx.reply(`Example: ${ctx.config.prefix}goodbye set Goodbye @user 👋`);
          return;
        }
        await ctx.settings.update(ctx.chatId, {
          goodbye: { ...settings.goodbye, template: template.slice(0, 1000), enabled: true },
        });
        await ctx.reply(
          `✅ Goodbye template saved and enabled.\nPreview: ${template.slice(0, 150).replace(/\{user\}/g, '@you').replace(/\{group\}/g, 'This Group')}`
        );
        return;
      }
      case 'status':
        await ctx.reply(
          [
            `👋 *Goodbye status*`,
            `Enabled: ${settings.goodbye.enabled ? '✅ yes' : '❌ no'}`,
            `Template: ${settings.goodbye.template}`,
          ].join('\n')
        );
        return;
      default:
        await ctx.reply(
          [
            `*Goodbye usage*`,
            `${ctx.config.prefix}goodbye on`,
            `${ctx.config.prefix}goodbye off`,
            `${ctx.config.prefix}goodbye status`,
            `${ctx.config.prefix}goodbye set Goodbye @user 👋`,
            ``,
            `Placeholders: {user} = mention, {group} = group name`,
          ].join('\n')
        );
    }
  },
};
