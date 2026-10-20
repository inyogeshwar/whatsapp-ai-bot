/**
 * commands/ai/_shared.js — one shared AI service + common reply helper.
 *
 * Every AI-backed command (.ai, .translate, .summarize, .code, .explain) uses
 * this so we create exactly ONE HTTP client per process and keep the
 * "AI disabled / unreachable" messaging consistent.
 */
import { createAiService } from '../../services/ai-service.js';
import { extractText } from '../../message-parser.js';

let aiService = null;

/** Lazily created once per process. */
export function getAi() {
  if (!aiService) aiService = createAiService();
  return aiService;
}

/** Reset the cached service (tests only). */
export function _resetAiForTests() {
  aiService = null;
}

/**
 * Run an AI prompt with a typing indicator and reply with the result.
 * Returns true when the AI answered, false when it reported an error.
 */
export async function askAndReply(ctx, prompt) {
  try {
    await ctx.sock.sendPresenceUpdate('composing', ctx.chatId);
  } catch {
    /* presence is optional */
  }

  const result = await getAi().ask(ctx.senderId, prompt);

  try {
    await ctx.sock.sendPresenceUpdate('paused', ctx.chatId);
  } catch {
    /* presence is optional */
  }

  await ctx.reply(result.ok ? result.text : result.userMessage);
  return result.ok;
}

/** Text from the command args, or from the message the user replied to. */
export function textFromArgsOrQuote(ctx) {
  const inline = ctx.command.argText.trim();
  if (inline) return inline;
  if (ctx.quoted?.content) return extractText(ctx.quoted.content).trim();
  return '';
}
