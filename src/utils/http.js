/**
 * utils/http.js — tiny fetch helpers for public, keyless web APIs.
 *
 * Every command that talks to the internet goes through here so we get:
 *   - one shared timeout (config.web.timeoutMs)
 *   - one place that swallows network errors into a friendly message
 *   - a hard cap on response size so a hostile endpoint can't blow memory
 *
 * Nothing here logs URLs with secrets; callers pass already-safe endpoints.
 */

/** Fetch JSON with a timeout. Returns null instead of throwing on failure. */
export async function getJson(url, { timeoutMs = 15_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'whatsapp-ai-bot/1.0', ...headers },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 2_000_000) return null; // 2 MB guard
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a binary body (image, etc.) with a size cap. Returns null on failure. */
export async function getBuffer(url, { timeoutMs = 15_000, maxBytes = 5_000_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'whatsapp-ai-bot/1.0', ...headers },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxBytes) return null;
    const contentType = res.headers.get('content-type') ?? '';
    return { buffer, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch plain text (small responses only). Returns null on failure. */
export async function getText(url, { timeoutMs = 15_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'whatsapp-ai-bot/1.0', ...headers },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 500_000 ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON with a timeout. Returns parsed JSON or null. */
export async function postJson(url, body, { timeoutMs = 15_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'whatsapp-ai-bot/1.0', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when a string looks like an http(s) URL. */
export function isHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
