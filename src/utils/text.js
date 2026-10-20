/**
 * utils/text.js — text utilities: URL detection, domain whitelisting,
 * safe template substitution and length bounding.
 */

/**
 * Conservative URL detector covering the common shapes people paste in chat:
 * https://…, http://…, ftp://…, and bare domains like "example.com/path".
 * Deliberately skips things like "file.v2" single-label dotted words with
 * short TLDs unless they carry a known scheme. Keep in sync with tests.
 */
const URL_REGEX =
  /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+|(?<![@\w./-])(?:[a-z0-9][a-z0-9-]{0,62}\.)+[a-z]{2,24}(?:\/[^\s<>"']*)?/gi;

/** Extract every URL found in a piece of text (deduplicated, bounded). */
export function findUrls(text, max = 50) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const matches = text.match(URL_REGEX) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)\]}]+$/, '')))].slice(0, max);
}

/**
 * Extract the registrable-ish domain from a URL for whitelist comparison.
 * "https://m.example.com/x" → "m.example.com" (lowercased, no port/www).
 */
export function domainOf(url) {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * True when a URL's domain matches any allowed domain.
 * Matching is suffix-based on domain labels so "example.com" also allows
 * "sub.example.com", but never "notexample.com".
 */
export function isDomainAllowed(url, allowedDomains) {
  const domain = domainOf(url);
  if (!domain) return false;
  const list = Array.isArray(allowedDomains) ? allowedDomains : [];
  return list.some((raw) => {
    const allowed = String(raw).toLowerCase().replace(/^www\./, '').trim();
    if (allowed === '') return false;
    return domain === allowed || domain.endsWith(`.${allowed}`);
  });
}

/** True when EVERY detected URL is whitelisted (or no URL exists at all). */
export function allUrlsAllowed(text, allowedDomains) {
  const urls = findUrls(text);
  if (urls.length === 0) return true;
  return urls.every((url) => isDomainAllowed(url, allowedDomains));
}

/**
 * Substitute {placeholders} safely. Unknown placeholders are left as-is so
 * template authors see their typos; values are stringified and bounded.
 * Supported by the bot: {user} {group} (extra vars passed by callers).
 */
export function fillTemplate(template, vars, maxValueLength = 100) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{([a-z0-9_]+)\}/gi, (whole, name) => {
    const value = vars?.[name];
    if (value === undefined || value === null) return whole;
    return String(value).slice(0, maxValueLength);
  });
}

/** Bound a piece of text to a maximum length, appending an ellipsis. */
export function truncate(text, max = 4000) {
  if (typeof text !== 'string') return '';
  if (max < 4) return text.slice(0, max);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Collapse whitespace and bound length — used before sending user text to AI. */
export function sanitizeForPrompt(text, max = 2000) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Format milliseconds as a human string for .ping (e.g. "142 ms", "1.24 s"). */
export function formatMs(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Format seconds of uptime as "3h 25m 10s"-style text. */
export function formatUptime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}
