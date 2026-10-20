/**
 * .translate <lang> <text> — translate text into any language using the AI
 * backend. Works in DM and groups. If no text is given, the user's quoted
 * message is translated instead.
 *
 * Examples:
 *   .translate hindi Hello, how are you?
 *   .translate spanish <reply to a message>
 */
import { askAndReply, textFromArgsOrQuote } from './_shared.js';

export default {
  name: 'translate',
  aliases: ['tr'],
  category: 'ai',
  description: 'Translate text into another language.',
  usage: '.translate <language> <text>',
  cooldown: 5,
  async execute(ctx) {
    if (!ctx.config.ai.enabled) {
      await ctx.reply('AI is disabled on this bot, so translation is unavailable.');
      return;
    }

    const argText = ctx.command.argText.trim();
    const [targetLang, ...rest] = argText.split(/\s+/);
    let text = rest.join(' ').trim();

    // Fall back to the quoted message when no inline text is provided.
    if (!text) text = textFromArgsOrQuote({ ...ctx, command: { argText: '' } });

    if (!targetLang || !text) {
      await ctx.reply(
        `Usage: ${ctx.config.prefix}translate <language> <text>\n` +
          `Example: ${ctx.config.prefix}translate hindi Good morning`
      );
      return;
    }

    const prompt =
      `Translate the following text into ${targetLang}. ` +
      `Reply with ONLY the translation, no explanation, no quotes.\n\n${text}`;

    await askAndReply(ctx, prompt);
  },
};
