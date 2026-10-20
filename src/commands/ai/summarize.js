/**
 * .summarize — summarize a long message or the quoted message using the AI
 * backend. Also works with inline text.
 *
 * Examples:
 *   .summarize <reply to a long message>
 *   .summarize <long text pasted here>
 */
import { askAndReply, textFromArgsOrQuote } from './_shared.js';

export default {
  name: 'summarize',
  aliases: ['summary', 'sum'],
  category: 'ai',
  description: 'Summarize a long message or quoted text.',
  usage: '.summarize <text>  (or reply to a message)',
  cooldown: 5,
  async execute(ctx) {
    if (!ctx.config.ai.enabled) {
      await ctx.reply('AI is disabled on this bot, so summarization is unavailable.');
      return;
    }

    const text = textFromArgsOrQuote(ctx).slice(0, 2000);
    if (!text) {
      await ctx.reply(
        `Usage: ${ctx.config.prefix}summarize <text>\nOr reply to a message with ${ctx.config.prefix}summarize`
      );
      return;
    }

    const prompt =
      'Summarize the following message in 1-3 short lines. ' +
      'Reply with ONLY the summary.\n\n' +
      text;

    await askAndReply(ctx, prompt);
  },
};
