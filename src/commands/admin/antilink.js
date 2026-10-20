/**
 * .antilink on|off|status|allow add <domain>|allow remove <domain>|allow list
 *
 * Configure per-group link moderation. Enforcement itself lives in
 * services/moderation-service.js and runs on every group message.
 */
export default {
  name: 'antilink',
  aliases: ['noLink'],
  category: 'admin',
  description: 'Configure link moderation for this group.',
  usage: '.antilink on | off | status | allow add <domain> | allow remove <domain> | allow list',
  groupOnly: true,
  adminOnly: true,
  cooldown: 3,
  async execute(ctx) {
    const settings = ctx.settings.get(ctx.chatId);
    const sub = (ctx.command.args[0] ?? '').toLowerCase();
    const antilink = settings.antilink;

    switch (sub) {
      case 'on': {
        await ctx.settings.update(ctx.chatId, { antilink: { ...antilink, enabled: true } });
        await ctx.reply(
          '✅ Anti-link is now *ON*.\nMessages with links will be deleted (if I am an admin). Admins and the bot owner are exempt.'
        );
        return;
      }
      case 'off': {
        await ctx.settings.update(ctx.chatId, { antilink: { ...antilink, enabled: false } });
        await ctx.reply('✅ Anti-link is now *OFF* for this group.');
        return;
      }
      case 'status': {
        const domains =
          antilink.allowedDomains.length > 0
            ? antilink.allowedDomains.map((d) => `• ${d}`).join('\n')
            : '(none)';
        await ctx.reply(
          [
            `🔗 *Anti-link status*`,
            `Enabled: ${antilink.enabled ? '✅ yes' : '❌ no'}`,
            `Admins exempt: ${antilink.exemptAdmins ? 'yes' : 'no'}`,
            `Warning: ${antilink.warnMessage}`,
            ``,
            `Allowed domains:`,
            domains,
          ].join('\n')
        );
        return;
      }
      case 'allow': {
        const action = (ctx.command.args[1] ?? '').toLowerCase();
        const domain = (ctx.command.args[2] ?? '').toLowerCase().replace(/^www\./, '');
        if (action === 'list') {
          const domains =
            antilink.allowedDomains.length > 0
              ? antilink.allowedDomains.map((d) => `• ${d}`).join('\n')
              : '(empty)';
          await ctx.reply(`Allowed domains:\n${domains}`);
          return;
        }
        if (!/^[a-z0-9][a-z0-9.-]{2,100}\.[a-z]{2,24}$/.test(domain)) {
          await ctx.reply(`Example: ${ctx.config.prefix}antilink allow add example.com`);
          return;
        }
        if (action === 'add') {
          if (antilink.allowedDomains.includes(domain)) {
            await ctx.reply(`${domain} is already allowed.`);
            return;
          }
          await ctx.settings.update(ctx.chatId, {
            antilink: { ...antilink, allowedDomains: [...antilink.allowedDomains, domain].slice(0, 200) },
          });
          await ctx.reply(`✅ Links to ${domain} (and its subdomains) are now allowed.`);
          return;
        }
        if (action === 'remove') {
          const next = antilink.allowedDomains.filter((d) => d !== domain);
          await ctx.settings.update(ctx.chatId, { antilink: { ...antilink, allowedDomains: next } });
          await ctx.reply(
            next.length === antilink.allowedDomains.length
              ? `${domain} was not on the list.`
              : `✅ Removed ${domain} from the allowed list.`
          );
          return;
        }
        await ctx.reply(`Usage: ${ctx.config.prefix}antilink allow add|remove|list <domain>`);
        return;
      }
      default: {
        await ctx.reply(
          [
            `*Anti-link usage*`,
            `${ctx.config.prefix}antilink on`,
            `${ctx.config.prefix}antilink off`,
            `${ctx.config.prefix}antilink status`,
            `${ctx.config.prefix}antilink allow add example.com`,
            `${ctx.config.prefix}antilink allow remove example.com`,
            `${ctx.config.prefix}antilink allow list`,
          ].join('\n')
        );
      }
    }
  },
};
