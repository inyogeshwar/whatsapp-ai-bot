/**
 * .explain <topic or text> — ask the AI to explain something simply.
 *
 * Examples:
 *   .explain quantum entanglement in simple words
 *   .explain <reply to a confusing message>
 */
import { askAndReply, textFromArgsOrQuote } from './_shared.js';

export default {
  name: 'explain',
  aliases: ['eli5'],
  category: 'ai',
  description: 'Ask AI to explain a topic or message in simple words.',
  usage: '.explain <topic>  (or reply to a message)',
  cooldown: 6,
  async execute(ctx) {
    if (!ctx.config.ai.enabled) {
      await ctx.reply('AI is disabled on this bot, so .explain is unavailable.');
      return;
    }

    const text = textFromArgsOrQuote(ctx).slice(0, 1500);
    if (!text) {
      await ctx.reply(`Usage: ${ctx.config.prefix}explain <topic>\nOr reply to a message with ${ctx.config.prefix}explain`);
      return;
    }

    const prompt =
      'Explain the following in very simple language, as if to a curious ' +
      'beginner. Use at most 6 short lines. No jargon unless you define it.\n\n' +
      text;

    await askAndReply(ctx, prompt);
  },
};
