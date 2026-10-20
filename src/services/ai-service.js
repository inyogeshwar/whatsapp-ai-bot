/**
 * services/ai-service.js — optional local AI.
 *
 * Two providers behind one seam:
 *   - `OllamaProvider`        → Ollama's native /api/chat
 *   - `OpenAIProvider`        → OpenAI-compatible /v1/chat/completions
 *     (FreeLLMAPI, LM Studio, vLLM, llama.cpp --api, OpenAI itself)
 *
 * Design rules (PRD FR-8):
 *   - Disabled by default; the bot never depends on this service being up.
 *   - Only the text of the EXPLICIT `.ai` invocation is sent — never chat
 *     history, never group metadata, never config or credentials.
 *   - Strict timeouts, bounded input/output, per-user rate limits.
 *   - Honest errors: when the service is down we say so — we never invent
 *     an answer.
 */
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { sanitizeForPrompt, truncate } from '../utils/text.js';
import { RateLimiter } from '../rate-limiter.js';

const log = createLogger('ai');

/** Per-user AI rate limiter (stricter than regular commands). */
const userLimiter = new RateLimiter(config.ai.rateLimit, config.ai.rateWindowSec);

/**
 * Ollama HTTP adapter.
 */
export class OllamaProvider {
  constructor({ baseUrl, timeoutMs }) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.name = 'ollama';
  }

  /** GET /api/tags → list of local models (or throws). */
  async listModels() {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 8000)),
    });
    if (!response.ok) throw new Error(`Ollama responded with HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.models) ? data.models.map((m) => m?.name).filter(Boolean) : [];
  }

  /** POST /api/chat → assistant reply text (or throws). */
  async chat(model, question, { maxOutput }) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        // ONLY the user's question — no history, no system prompt secrets.
        messages: [{ role: 'user', content: question }],
        stream: false,
        options: { num_predict: maxOutput },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Ollama responded with HTTP ${response.status}`);
    }
    const data = await response.json();
    const content = data?.message?.content;
    return typeof content === 'string' ? content : '';
  }
}

/**
 * OpenAI-compatible adapter for gateways like FreeLLMAPI.
 *
 * Speaks the standard /v1 REST protocol:
 *   GET  {baseUrl}/v1/models
 *   POST {baseUrl}/v1/chat/completions
 * The API key is sent as a bearer token and NEVER logged.
 */
export class OpenAIProvider {
  constructor({ baseUrl, apiKey, timeoutMs }) {
    // Tolerate a trailing slash or a baseUrl that already includes /v1.
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.name = 'openai';
  }

  get headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** GET /v1/models → list of usable model ids (or throws). */
  async listModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      method: 'GET',
      headers: this.headers,
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 8000)),
    });
    if (!response.ok) throw new Error(`AI gateway responded with HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.data)) return [];
    return data.data
      .map((m) => m?.id)
      .filter((id) => typeof id === 'string' && id !== '')
      // Gateways (FreeLLMAPI) mark unusable catalog entries with
      // available:false — never recommend those to the operator.
      .filter((_, index) => data.data[index]?.available !== false);
  }

  /** POST /v1/chat/completions → assistant reply text (or throws). */
  async chat(model, question, { maxOutput }) {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model,
        // ONLY the user's question — no history, no system prompt secrets.
        messages: [{ role: 'user', content: question }],
        max_tokens: maxOutput,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      // Surface the gateway's own (already sanitized) error message when present.
      let detail = '';
      try {
        const errorBody = await response.json();
        detail = typeof errorBody?.error?.message === 'string' ? ` — ${errorBody.error.message}` : '';
      } catch {
        /* body not JSON */
      }
      throw new Error(`AI gateway responded with HTTP ${response.status}${detail}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }
}

export class AiService {
  constructor({ provider, settings }) {
    this.provider = provider;
    this.settings = settings; // { enabled, model, maxInput, maxOutput, rateLimit, ... }
    this.lastProbe = { ok: false, models: [], checkedAt: 0 };
  }

  get enabled() {
    return Boolean(this.settings.enabled);
  }

  /**
   * Probe availability + model presence (cached for 60 s to avoid hammering).
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async isAvailable() {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    const now = Date.now();
    if (this.lastProbe.ok && now - this.lastProbe.checkedAt < 60_000) return { ok: true };

    try {
      const models = await this.provider.listModels();
      const wanted = this.settings.model.toLowerCase();
      const hasModel = models.some(
        (name) => name.toLowerCase() === wanted || name.toLowerCase().startsWith(`${wanted}:`)
      );
      this.lastProbe = { ok: hasModel, models, checkedAt: now };
      if (!hasModel) {
        log.warn({ model: this.settings.model }, 'ai.model_missing');
        return { ok: false, reason: 'model_missing' };
      }
      return { ok: true };
    } catch (error) {
      this.lastProbe = { ok: false, models: [], checkedAt: now };
      log.warn({ err: error?.message, url: this.settings.baseUrl }, 'ai.unavailable');
      return { ok: false, reason: 'unreachable' };
    }
  }

  /**
   * Answer one question for one user. Returns a discriminated result —
   * never throws, never fabricates content.
   * @returns {Promise<{ ok: true, text: string } | { ok: false, userMessage: string }>}
   */
  async ask(userJid, rawQuestion) {
    if (!this.enabled) {
      return { ok: false, userMessage: 'AI is disabled on this bot.' };
    }

    const question = sanitizeForPrompt(rawQuestion, this.settings.maxInput);
    if (question.length === 0) {
      return { ok: false, userMessage: 'Please provide a question, e.g. `.ai What is Node.js?`' };
    }

    const limit = userLimiter.consume(`ai:${userJid}`);
    if (!limit.allowed) {
      const wait = Math.ceil(limit.retryAfterMs / 1000);
      return { ok: false, userMessage: `⏳ AI rate limit: try again in ${wait}s.` };
    }

    const availability = await this.isAvailable();
    if (!availability.ok) {
      if (availability.reason === 'model_missing') {
        return {
          ok: false,
          userMessage:
            this.provider.name === 'ollama'
              ? `The AI model "${this.settings.model}" is not installed. Run: ollama pull ${this.settings.model}`
              : `The AI model "${this.settings.model}" is not available on ${this.settings.baseUrl}. Run .ai models to see what's usable, then set AI_MODEL in .env.`,
        };
      }
      if (availability.reason === 'unreachable') {
        return {
          ok: false,
          userMessage: `The AI service at ${this.settings.baseUrl} is not reachable. ${
            this.provider.name === 'ollama'
              ? 'Is Ollama running? (ollama serve)'
              : 'Is the AI gateway (e.g. FreeLLMAPI) running?'
          }`,
        };
      }
      return { ok: false, userMessage: 'AI is disabled on this bot.' };
    }

    try {
      const answer = await this.provider.chat(this.settings.model, question, {
        maxOutput: this.settings.maxOutput,
      });
      const text = truncate(answer.trim(), 4000);
      if (text === '') {
        return { ok: false, userMessage: 'The AI model returned an empty answer. Try rephrasing.' };
      }
      return { ok: true, text };
    } catch (error) {
      log.warn({ err: error?.message }, 'ai.request_failed');
      return {
        ok: false,
        userMessage: 'The AI request failed or timed out. Please try again shortly.',
      };
    }
  }
}

/** Build the process-wide AI service from config. */
export function createAiService() {
  const provider =
    config.ai.provider === 'openai'
      ? new OpenAIProvider({
          baseUrl: config.ai.baseUrl,
          apiKey: config.ai.apiKey,
          timeoutMs: config.ai.timeoutMs,
        })
      : new OllamaProvider({
          baseUrl: config.ai.baseUrl,
          timeoutMs: config.ai.timeoutMs,
        });
  return new AiService({ provider, settings: config.ai });
}

export default createAiService;
