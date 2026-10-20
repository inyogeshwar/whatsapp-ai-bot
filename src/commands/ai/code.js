/**
 * .code <request> — ask the AI to write a code snippet.
 *
 * Examples:
 *   .code python program to reverse a string
 *   .code javascript debounce function
 *
 * Kept deliberately small: the reply is trimmed to a safe length and the
 * model is told to answer with just the code + a one-line note.
 */
import { askAndReply } from './_shared.js';

export default {
  name: 'code',
  aliases: ['dev'],
  category: 'ai',
  description: 'Ask AI to write a short code snippet.',
  usage: '.code <language> <what you need>',
  cooldown: 8,
  async execute(ctx) {
    if (!ctx.config.ai.enabled) {
      await ctx.reply('AI is disabled on this bot, so .code is unavailable.');
      return;
    }

    const request = ctx.command.argText.trim().slice(0, 1000);
    if (!request) {
      await ctx.reply(`Usage: ${ctx.config.prefix}code <language> <what you need>\nExample: ${ctx.config.prefix}code python reverse a list`);
      return;
    }

    const prompt =
      'You are a concise coding assistant. Answer with the code only, then a ' +
      'single short line of explanation. No long intro, no markdown fences, ' +
      'no apologies.\n\nRequest: ' +
      request;

    await askAndReply(ctx, prompt);
  },
};
