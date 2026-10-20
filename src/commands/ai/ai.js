/**
 * .ai <question> — optional AI chat (Ollama or an OpenAI-compatible gateway
 * such as FreeLLMAPI / LM Studio).
 *
 * Disabled by default (AI_ENABLED=false). The bot works normally without it.
 * Only the explicitly typed question is sent to the model.
 */
import { createAiService } from '../../services/ai-service.js';

/** Lazily created once per process. */
let aiService = null;
function getAi() {
  if (!aiService) aiService = createAiService();
  return aiService;
}

export default {
  name: 'ai',
  aliases: ['ask', 'gpt'],
  category: 'ai',
  description: 'Ask the configured AI model a question.',
  usage: '.ai <your question>  ·  .ai models',
  cooldown: 5, // per-user AI limits are enforced inside the service too
  async execute(ctx) {
    if (!ctx.config.ai.enabled) {
      await ctx.reply(
        'AI is disabled on this bot.\nTo enable it: set AI_ENABLED=true, AI_PROVIDER=ollama (or openai), AI_MODEL=<model> in .env. For OpenAI-compatible gateways also set AI_BASE_URL and AI_API_KEY.'
      );
      return;
    }

    // `.ai models` — list usable models (helps pick AI_MODEL).
    if (ctx.command.argText.trim().toLowerCase() === 'models') {
      try {
        const models = await getAi().provider.listModels();
        const shown = models.slice(0, 40);
        await ctx.reply(
          models.length === 0
            ? 'No models reported by the AI service.'
            : `Models on ${ctx.config.ai.baseUrl}:\n${shown.join('\n')}${
                models.length > shown.length ? `\n…and ${models.length - shown.length} more` : ''
              }`
        );
      } catch {
        await ctx.reply(`Could not reach the AI service at ${ctx.config.ai.baseUrl}.`);
      }
      return;
    }

    const question = ctx.command.argText.trim();
    if (question === '') {
      await ctx.reply(`Example: ${ctx.config.prefix}ai What is Node.js?`);
      return;
    }

    // Show a composing indicator (expires automatically after ~10 s).
    try {
      await ctx.sock.sendPresenceUpdate('composing', ctx.chatId);
    } catch {
      /* optional */
    }

    const result = await getAi().ask(ctx.senderId, question);

    try {
      await ctx.sock.sendPresenceUpdate('paused', ctx.chatId);
    } catch {
      /* optional */
    }

    if (result.ok) {
      await ctx.reply(result.text);
    } else {
      await ctx.reply(result.userMessage);
    }
  },
};
