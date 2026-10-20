/**
 * .groupinfo — display information about the current group.
 */
export default {
  name: 'groupinfo',
  aliases: ['ginfo'],
  category: 'general',
  description: 'Show group information (name, description, members, admins).',
  usage: '.groupinfo',
  groupOnly: true,
  cooldown: 10,
  async execute(ctx) {
    const meta = ctx.groupMetadata;
    if (!meta) {
      await ctx.reply('Could not fetch group information right now. Please try again.');
      return;
    }

    const admins = (meta.participants ?? []).filter(
      (p) => p.admin === 'admin' || p.admin === 'superadmin'
    );

    const lines = [
      `╭─ *Group Info*`,
      `│ 📛 Name: ${meta.subject ?? 'unknown'}`,
      `│ 👥 Members: ${(meta.participants ?? []).length}`,
      `│ 🛡 Admins: ${admins.length}`,
    ];
    if (meta.owner) {
      lines.push(`│ 👑 Owner: @${String(meta.owner).split(':')[0].split('@')[0]}`);
    }
    if (meta.desc) {
      lines.push('│');
      lines.push('│ 📝 Description:');
      for (const chunk of meta.desc.slice(0, 800).match(/.{1,700}/g) ?? []) {
        lines.push(`│ ${chunk}`);
      }
    }
    lines.push('╰────────────────');

    const mentions = meta.owner ? [meta.owner] : [];
    await ctx.sock.sendMessage(ctx.chatId, { text: lines.join('\n'), mentions }, { quoted: ctx.message });
  },
};
