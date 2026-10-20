/**
 * services/metadata-cache.js — tiny TTL cache for group metadata.
 *
 * Baileys recommends a `cachedGroupMetadata` provider to avoid hammering
 * WhatsApp with groupMetadata queries on every message. Entries expire after
 * a short TTL so admin changes are picked up quickly, and the cache is
 * bounded so it cannot grow without limit.
 */
const TTL_MS = 60 * 1000; // 60 s freshness — good balance for moderation
const MAX_ENTRIES = 500;

/** @type {Map<string, { meta: object, expires: number }>} */
const cache = new Map();

/** Read cached metadata (stale entries are treated as absent). */
export function getCachedMetadata(groupJid) {
  const entry = cache.get(groupJid);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    cache.delete(groupJid);
    return undefined;
  }
  return entry.meta;
}

/** Store metadata for a group. */
export function setCachedMetadata(groupJid, meta) {
  if (!groupJid || !meta) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(groupJid, { meta, expires: Date.now() + TTL_MS });
}

/**
 * Fetch metadata through the cache; never throws.
 * @returns {Promise<object|null>}
 */
export async function fetchMetadata(sock, groupJid) {
  const cached = getCachedMetadata(groupJid);
  if (cached) return cached;
  try {
    const meta = await sock.groupMetadata(groupJid);
    setCachedMetadata(groupJid, meta);
    return meta;
  } catch {
    return null;
  }
}

/** Invalidate one group or the whole cache (call after moderation actions). */
export function invalidateMetadata(groupJid) {
  if (groupJid) cache.delete(groupJid);
  else cache.clear();
}

export default { getCachedMetadata, setCachedMetadata, fetchMetadata, invalidateMetadata };
