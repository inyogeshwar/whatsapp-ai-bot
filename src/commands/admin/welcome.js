/**
 * .welcome on|off|status|set <template> — welcome message configuration.
 * Template placeholders: {user} (mention) and {group} (group name).
 */
export default {
  name: 'welcome',
  aliases: ['wel'],
  category: 'admin',
  description: 'Configure the welcome message for new members.',
  usage: '.welcome on | off | status | set <template with {user} and {group}>',
  groupOnly: true,
  adminOnly: true,
  cooldown: 3,
  async execute(ctx) {
    const settings = ctx.settings.get(ctx.chatId);
    const sub = (ctx.command.args[0] ?? '').toLowerCase();

    switch (sub) {
      case 'on':
        await ctx.settings.update(ctx.chatId, { welcome: { ...settings.welcome, enabled: true } });
        await ctx.reply('✅ Welcome messages are now *ON*.');
        return;
      case 'off':
        await ctx.settings.update(ctx.chatId, { welcome: { ...settings.welcome, enabled: false } });
        await ctx.reply('✅ Welcome messages are now *OFF*.');
        return;
      case 'set': {
        const template = ctx.command.argText.replace(/^set\s+/i, '').trim();
        if (template === '') {
          await ctx.reply(
            `Example: ${ctx.config.prefix}welcome set Welcome @user to {group}! Please read the rules.`
          );
          return;
        }
        await ctx.settings.update(ctx.chatId, {
          welcome: { ...settings.welcome, template: template.slice(0, 1000), enabled: true },
        });
        await ctx.reply(
          `✅ Welcome template saved and enabled.\nPreview: ${template.slice(0, 150).replace(/\{user\}/g, '@you').replace(/\{group\}/g, 'This Group')}`
        );
        return;
      }
      case 'status':
        await ctx.reply(
          [
            `👋 *Welcome status*`,
            `Enabled: ${settings.welcome.enabled ? '✅ yes' : '❌ no'}`,
            `Template: ${settings.welcome.template}`,
          ].join('\n')
        );
        return;
      default:
        await ctx.reply(
          [
            `*Welcome usage*`,
            `${ctx.config.prefix}welcome on`,
            `${ctx.config.prefix}welcome off`,
            `${ctx.config.prefix}welcome status`,
            `${ctx.config.prefix}welcome set Welcome @user to {group}!`,
            ``,
            `Placeholders: {user} = mention, {group} = group name`,
          ].join('\n')
        );
    }
  },
};
