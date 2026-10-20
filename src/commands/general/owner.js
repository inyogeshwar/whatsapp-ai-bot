/**
 * .owner — display the configured owner.
 * Shows exactly what is configured in .env — never a hardcoded number and
 * never anything unrelated to the operator's own configuration.
 */
export default {
  name: 'owner',
  aliases: ['creator'],
  category: 'general',
  description: 'Show the bot owner.',
  usage: '.owner',
  cooldown: 10,
  async execute(ctx) {
    const ownerName = ctx.config.ownerName || 'Not configured';
    const ownerJid = ctx.config.ownerJid;
    // Only the user portion of the configured JID is shown (the operator
    // chose to configure it); nothing else is exposed.
    const contact = ownerJid ? `@${ownerJid.split('@')[0].split(':')[0]}` : 'not set';
    const text = [
      `╭─ *Bot Owner*`,
      `│ 👤 ${ownerName}`,
      `│ 📞 ${contact}`,
      ownerJid
        ? `│ ℹ️ Set BOT_OWNER_JID in the bot's .env file.`
        : `│ ⚠️ No owner configured — set BOT_OWNER_JID in .env.`,
      '╰────────────────',
    ].join('\n');
    const mentions = ownerJid ? [ownerJid] : [];
    await ctx.sock.sendMessage(ctx.chatId, { text, mentions }, { quoted: ctx.message });
  },
};
