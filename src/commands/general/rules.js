/**
 * .rules — read and (for admins/owner) set the group rules.
 *
 *   .rules               → show current rules
 *   .rules set <text>    → set rules (admin/owner only)
 *   .rules clear         → remove rules (admin/owner only)
 */
export default {
  name: 'rules',
  aliases: ['rule'],
  category: 'general',
  description: 'Show or configure the group rules.',
  usage: '.rules [.rules set <text> | .rules clear]',
  groupOnly: true,
  adminOnly: false, // reading is open; writing is gated below (admins only)
  cooldown: 5,
  async execute(ctx) {
    const settings = ctx.settings.get(ctx.chatId);
    const sub = (ctx.command.args[0] ?? '').toLowerCase();

    // ── Write operations: admin/owner only ───────────────────────────
    if (sub === 'set' || sub === 'clear') {
      if (!ctx.isSenderAdmin && !ctx.isOwner) {
        await ctx.reply('Only group administrators can change the group rules.');
        return;
      }
      if (sub === 'clear') {
        await ctx.settings.update(ctx.chatId, { rules: '' });
        await ctx.reply('✅ Group rules cleared.');
        return;
      }
      const text = ctx.command.argText.replace(/^set\s+/i, '').trim();
      if (text === '') {
        await ctx.reply(`Example: ${ctx.config.prefix}rules set 1. Be respectful. 2. No spam.`);
        return;
      }
      await ctx.settings.update(ctx.chatId, { rules: text.slice(0, 4000) });
      await ctx.reply('✅ Group rules saved.');
      return;
    }

    // ── Read ─────────────────────────────────────────────────────────
    if (settings.rules) {
      await ctx.reply(`📜 *Group rules*\n\n${settings.rules}`);
    } else {
      await ctx.reply(
        `No rules configured for this group.\nGroup admins can set them with:\n${ctx.config.prefix}rules set 1. Be respectful. 2. No spam.`
      );
    }
  },
};
