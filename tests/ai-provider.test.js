/**
 * tests/ai-provider.test.js — offline tests for the AI provider adapters.
 *
 * No network access: `fetch` is stubbed on globalThis. Verifies that the
 * OpenAI-compatible adapter (FreeLLMAPI / LM Studio / vLLM) speaks the
 * /v1 protocol correctly, sends the API key as a bearer token, sends ONLY
 * the user's question, and that unusable catalog entries are filtered out.
 */
const { test, beforeEach, afterEach } = await import('node:test');
const assert = await import('node:assert/strict');

const { OpenAIProvider, OllamaProvider } = await import('../src/services/ai-service.js');

/** Capture fetch calls and return a canned response. */
function stubFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      async json() {
        return responseBody;
      },
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── OpenAIProvider ─────────────────────────────────────────────────────────────

test('OpenAIProvider: normalizes baseUrl (trailing slash and /v1 suffix)', () => {
  assert.equal(new OpenAIProvider({ baseUrl: 'http://x:31415/', apiKey: '' }).baseUrl, 'http://x:31415');
  assert.equal(new OpenAIProvider({ baseUrl: 'http://x:31415/v1', apiKey: '' }).baseUrl, 'http://x:31415');
  assert.equal(new OpenAIProvider({ baseUrl: 'http://x:31415/v1/', apiKey: '' }).baseUrl, 'http://x:31415');
});

test('OpenAIProvider.listModels: GET /v1/models with bearer key, filters available:false', async () => {
  const calls = stubFetch({
    data: [
      { id: 'gemini-3.5-flash', available: true },
      { id: 'stale-model', available: false },
      { id: 'no-flag-model' },
      { id: '' },
      null,
    ],
  });
  const provider = new OpenAIProvider({
    baseUrl: 'http://127.0.0.1:31415',
    apiKey: 'secret-key',
    timeoutMs: 5000,
  });
  const models = await provider.listModels();

  assert.equal(calls[0].url, 'http://127.0.0.1:31415/v1/models');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-key');
  assert.deepEqual(models, ['gemini-3.5-flash', 'no-flag-model']);
});

test('OpenAIProvider.listModels: omits Authorization header when no key set', async () => {
  const calls = stubFetch({ data: [{ id: 'm1' }] });
  const provider = new OpenAIProvider({ baseUrl: 'http://x:1', apiKey: '', timeoutMs: 5000 });
  await provider.listModels();
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('OpenAIProvider.chat: POST /v1/chat/completions, only the question is sent', async () => {
  const calls = stubFetch({ choices: [{ message: { content: 'Hi there!' } }] });
  const provider = new OpenAIProvider({
    baseUrl: 'http://127.0.0.1:31415',
    apiKey: 'k',
    timeoutMs: 5000,
  });
  const answer = await provider.chat('gemini-3.5-flash', 'What is Node.js?', { maxOutput: 500 });

  assert.equal(answer, 'Hi there!');
  const { url, init } = calls[0];
  assert.equal(url, 'http://127.0.0.1:31415/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer k');

  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gemini-3.5-flash');
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 500);
  // Privacy rule: exactly one message, the user's question — no history.
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'What is Node.js?');
});

test('OpenAIProvider.chat: non-OK response throws with the gateway error message', async () => {
  stubFetch(
    { error: { message: 'model_not_found upstream' } },
    { ok: false, status: 404 }
  );
  const provider = new OpenAIProvider({ baseUrl: 'http://x:1', apiKey: 'k', timeoutMs: 5000 });
  await assert.rejects(
    () => provider.chat('gone-model', 'q', { maxOutput: 100 }),
    /HTTP 404 — model_not_found upstream/
  );
});

test('OpenAIProvider.chat: malformed body yields empty string (never garbage)', async () => {
  stubFetch({ choices: [] });
  const provider = new OpenAIProvider({ baseUrl: 'http://x:1', apiKey: 'k', timeoutMs: 5000 });
  const answer = await provider.chat('m', 'q', { maxOutput: 100 });
  assert.equal(answer, '');
});

// ── OllamaProvider (regression) ────────────────────────────────────────────────

test('OllamaProvider.chat: speaks /api/chat, no auth header', async () => {
  const calls = stubFetch({ message: { content: 'ollama says hi' } });
  const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', timeoutMs: 5000 });
  const answer = await provider.chat('llama3.2', 'hi?', { maxOutput: 100 });

  assert.equal(answer, 'ollama says hi');
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/chat');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.options.num_predict, 100);
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi?' }]);
});

test('OllamaProvider.listModels: maps /api/tags names', async () => {
  stubFetch({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:8b' }, {}] });
  const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', timeoutMs: 5000 });
  assert.deepEqual(await provider.listModels(), ['llama3.2:latest', 'qwen3:8b']);
});
