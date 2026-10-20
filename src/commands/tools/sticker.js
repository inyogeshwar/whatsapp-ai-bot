/**
 * .sticker / .s — turn an image into a WhatsApp sticker (WebP).
 *
 * How it works (no extra packages):
 *   - source: the image you reply to, OR an image URL passed as an argument
 *   - conversion: `sharp` (already installed as a Baileys dependency) resizes
 *     to the WhatsApp sticker canvas (512×512, contain) and encodes WebP
 *   - send: a native { sticker } payload — Baileys handles the rest
 *
 * Static images only. Animated/video stickers need ffmpeg and are out of scope
 * here on purpose.
 */
import sharp from 'sharp';
import { getBuffer, isHttpUrl } from '../../utils/http.js';

/** Best-effort download of the image the user replied to. */
async function fetchQuotedImage(ctx) {
  const quoted = ctx.quoted;
  if (!quoted?.content) return null;

  const imageMessage = quoted.content.imageMessage ?? null;
  if (!imageMessage) return null;

  try {
    const stream = await ctx.sock.downloadMediaMessage({
      key: quoted.key,
      message: quoted.content,
    });
    if (!stream) return null;
    return Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
  } catch {
    return null;
  }
}

export default {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: 'tools',
  description: 'Make a sticker from a replied image or an image URL.',
  usage: '.sticker (reply to an image)  ·  .sticker <image url>',
  cooldown: 5,
  async execute(ctx) {
    const arg = ctx.command.argText.trim();
    let source = null;

    if (arg && isHttpUrl(arg)) {
      const fetched = await getBuffer(arg, {
        timeoutMs: ctx.config.web.timeoutMs,
        maxBytes: ctx.config.sticker.maxSizeBytes,
      });
      if (fetched) source = fetched.buffer;
      if (!source) {
        await ctx.reply('❌ Could not download that image URL. Check the link and try again.');
        return;
      }
    } else {
      source = await fetchQuotedImage(ctx);
      if (!source) {
        await ctx.reply(
          `Reply to an image with ${ctx.config.prefix}sticker, or send an image URL:\n${ctx.config.prefix}sticker https://example.com/pic.jpg`
        );
        return;
      }
    }

    if (source.length > ctx.config.sticker.maxSizeBytes) {
      await ctx.reply('❌ That image is too large to convert. Try a smaller one.');
      return;
    }

    try {
      const webp = await sharp(source, { animated: false })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 80 })
        .toBuffer();

      await ctx.sock.sendMessage(
        ctx.chatId,
        { sticker: webp, mimetype: 'image/webp' },
        { quoted: ctx.message }
      );
    } catch {
      await ctx.reply('❌ I could not convert that image into a sticker.');
    }
  },
};
