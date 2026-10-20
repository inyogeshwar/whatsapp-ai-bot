/**
 * .qr <text or url> — render the given text/URL as a QR code image.
 *
 * Uses the bundled `qrcode` package (already a dependency) so there is no
 * network call and no third-party service seeing the content.
 */
import QRCode from 'qrcode';

export default {
  name: 'qr',
  aliases: ['qrcode'],
  category: 'tools',
  description: 'Turn text or a link into a QR code image.',
  usage: '.qr <text or url>',
  cooldown: 5,
  async execute(ctx) {
    const text = ctx.command.argText.trim();
    if (!text) {
      await ctx.reply(`Usage: ${ctx.config.prefix}qr <text or url>\nExample: ${ctx.config.prefix}qr https://example.com`);
      return;
    }
    const payload = text.slice(0, 1000);

    try {
      const buffer = await QRCode.toBuffer(payload, {
        type: 'png',
        width: 640,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      await ctx.sock.sendMessage(
        ctx.chatId,
        {
          image: buffer,
          caption: `🔳 QR code for:\n${payload.length > 120 ? `${payload.slice(0, 120)}…` : payload}`,
          mimetype: 'image/png',
        },
        { quoted: ctx.message }
      );
    } catch {
      await ctx.reply('❌ Could not generate that QR code. Try shorter text.');
    }
  },
};
