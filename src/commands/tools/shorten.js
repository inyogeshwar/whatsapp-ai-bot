/**
 * .shorten <url> — shorten a long URL using the keyless TinyURL API.
 *
 * Only http/https URLs are accepted. The bot never follows the short link;
 * it merely displays it.
 */
import { getText, isHttpUrl } from '../../utils/http.js';

export default {
  name: 'shorten',
  aliases: ['short', 'tiny'],
  category: 'tools',
  description: 'Shorten a long link.',
  usage: '.shorten <url>',
  cooldown: 5,
  async execute(ctx) {
    if (!ctx.config.web.enabled) {
      await ctx.reply('Web features are disabled on this bot.');
      return;
    }

    const url = ctx.command.argText.trim().split(/\s+/)[0];
    if (!url || !isHttpUrl(url)) {
      await ctx.reply(`Usage: ${ctx.config.prefix}shorten <url>\nExample: ${ctx.config.prefix}shorten https://example.com/a/very/long/path`);
      return;
    }

    const short = await getText(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      { timeoutMs: ctx.config.web.timeoutMs }
    );
    const result = short?.trim();
    if (!result || !isHttpUrl(result)) {
      await ctx.reply('❌ Could not shorten that link right now. Try again shortly.');
      return;
    }
    await ctx.reply(`🔗 ${result}`);
  },
};
