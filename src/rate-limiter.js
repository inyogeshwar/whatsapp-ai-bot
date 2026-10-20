/**
 * rate-limiter.js — sliding-window rate limiting and cooldowns.
 *
 * Implemented in ~60 lines with no dependencies so behavior is transparent
 * and unit-testable. Memory is bounded: stale buckets are pruned lazily and
 * the tracker refuses to grow past `maxKeys` (oldest evicted first).
 */

const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  /**
   * @param {number} limit      allowed hits per window
   * @param {number} windowSec  window length in seconds
   * @param {number} [maxKeys]  memory bound for distinct keys
   */
  constructor(limit, windowSec, maxKeys = DEFAULT_MAX_KEYS) {
    this.limit = limit;
    this.windowMs = Math.max(1, windowSec) * 1000;
    this.maxKeys = maxKeys;
    /** @type {Map<string, number[]>} key → timestamps (ms) */
    this.hits = new Map();
  }

  /**
   * Record one hit for `key`.
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
   */
  consume(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.hits.get(key);

    if (timestamps) {
      // Drop expired hits, keep insertion order.
      timestamps = timestamps.filter((t) => t > cutoff);
    } else {
      if (this.hits.size >= this.maxKeys) {
        // Evict oldest entries to stay bounded.
        const evictCount = Math.max(1, Math.floor(this.maxKeys * 0.1));
        let evicted = 0;
        for (const k of this.hits.keys()) {
          this.hits.delete(k);
          if (++evicted >= evictCount) break;
        }
      }
      timestamps = [];
    }

    if (timestamps.length >= this.limit) {
      const oldest = timestamps[0];
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      this.hits.set(key, timestamps);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, remaining: this.limit - timestamps.length, retryAfterMs: 0 };
  }

  /** Check without recording a hit. */
  peek(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    return { remaining: Math.max(0, this.limit - timestamps.length) };
  }

  /** Forget a key (used by tests and admin resets). */
  reset(key) {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }
}

export class CooldownTracker {
  /** @param {number} maxKeys memory bound */
  constructor(maxKeys = DEFAULT_MAX_KEYS) {
    this.maxKeys = maxKeys;
    /** @type {Map<string, number>} key → ready-at timestamp (ms) */
    this.readyAt = new Map();
  }

  /**
   * Start (or check) a cooldown for `key`.
   * @param {string} key
   * @param {number} seconds
   * @returns {{ onCooldown: boolean, remainingSec: number }}
   */
  checkAndStart(key, seconds) {
    const now = Date.now();
    const until = this.readyAt.get(key);
    if (until && until > now) {
      return { onCooldown: true, remainingSec: Math.ceil((until - now) / 1000) };
    }
    if (this.readyAt.size >= this.maxKeys) {
      // Evict expired entries first, then oldest.
      for (const [k, t] of this.readyAt) {
        if (t <= now) this.readyAt.delete(k);
      }
      while (this.readyAt.size >= this.maxKeys) {
        const first = this.readyAt.keys().next().value;
        this.readyAt.delete(first);
      }
    }
    this.readyAt.set(key, now + Math.max(0, seconds) * 1000);
    return { onCooldown: false, remainingSec: 0 };
  }

  /** Forget a key. */
  reset(key) {
    if (key === undefined) this.readyAt.clear();
    else this.readyAt.delete(key);
  }
}

/**
 * Bounded recently-seen set (message IDs, event keys) with TTL-based expiry —
 * used for dedupe and duplicate-welcome suppression.
 */
export class RecentSet {
  constructor(ttlMs = 10 * 60 * 1000, maxEntries = 5000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    /** @type {Map<string, number>} value → expiry */
    this.entries = new Map();
  }

  /** Returns true when the value was already present (and refreshes it). */
  has(value) {
    const now = Date.now();
    const expiry = this.entries.get(value);
    if (expiry !== undefined && expiry > now) return true;
    if (expiry !== undefined) this.entries.delete(value);
    if (this.entries.size >= this.maxEntries) {
      // Evict oldest 10%.
      const evictCount = Math.max(1, Math.floor(this.maxEntries * 0.1));
      let evicted = 0;
      for (const k of this.entries.keys()) {
        this.entries.delete(k);
        if (++evicted >= evictCount) break;
      }
    }
    this.entries.set(value, now + this.ttlMs);
    return false;
  }

  /** Add without checking (marking as seen). */
  add(value) {
    this.has(value);
  }

  get size() {
    return this.entries.size;
  }

  /** Forget every entry (tests / pipeline resets). */
  reset() {
    this.entries.clear();
  }
}

export default RateLimiter;
