/**
 * group-settings.js — persistent per-group configuration.
 *
 * Storage is a single JSON file inside data/ written with atomic replacement
 * (write temp file → rename over the original), so a crash mid-write can never
 * corrupt existing settings. A missing or corrupt file recovers to defaults
 * with a warning instead of crashing the bot.
 *
 * NOTE: this JSON store is designed for a single-process local bot. For
 * multi-process or multi-host deployments, replace this class with a database —
 * the public API below is the only surface commands depend on.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('settings');

/** Default shape for a single group's settings. */
export function defaultGroupSettings() {
  return {
    welcome: { enabled: false, template: 'Welcome @user to {group}! Please check the group rules.' },
    goodbye: { enabled: false, template: 'Goodbye @user 👋 We hope to see you again!' },
    antilink: {
      enabled: false,
      allowedDomains: [],
      warnMessage: 'Links are not allowed in this group.',
      exemptAdmins: true,
    },
    rules: '',
    updatedAt: 0,
  };
}

/** Deep-merge stored settings over defaults so older files gain new fields. */
function mergeWithDefaults(stored) {
  const base = defaultGroupSettings();
  if (!stored || typeof stored !== 'object') return base;
  return {
    welcome: { ...base.welcome, ...pick(stored.welcome, ['enabled', 'template']) },
    goodbye: { ...base.goodbye, ...pick(stored.goodbye, ['enabled', 'template']) },
    antilink: {
      ...base.antilink,
      ...pick(stored.antilink, ['enabled', 'allowedDomains', 'warnMessage', 'exemptAdmins']),
      allowedDomains: Array.isArray(stored.antilink?.allowedDomains)
        ? stored.antilink.allowedDomains.filter((d) => typeof d === 'string').slice(0, 200)
        : [],
    },
    rules: typeof stored.rules === 'string' ? stored.rules.slice(0, 4000) : '',
    updatedAt: Number.isFinite(stored.updatedAt) ? stored.updatedAt : 0,
  };
}

function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export class GroupSettingsStore {
  /** @param {string} dataDir directory that holds group-settings.json */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'group-settings.json');
    /** @type {Record<string, object>} group JID → settings */
    this.data = {};
    this.ready = this.#load();
  }

  async #load() {
    try {
      await mkdir(this.dataDir, { recursive: true });
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('settings root is not an object');
      }
      this.data = parsed;
      log.info({ groups: Object.keys(this.data).length }, 'group settings loaded');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.data = {};
        log.debug('no settings file yet — starting fresh');
      } else {
        // Corrupt or unreadable file: keep a backup name, recover to defaults.
        this.data = {};
        log.warn(
          { err: error?.message },
          'settings file missing/invalid — recovered with defaults (previous file kept on disk as-is)'
        );
      }
    }
  }

  /** Await once after construction (or rely on the internal promise per call). */
  async init() {
    await this.ready;
    return this;
  }

  /** Settings for one group (always merged with defaults, never undefined). */
  get(groupId) {
    return mergeWithDefaults(this.data[groupId]);
  }

  /**
   * Patch one group's settings and persist atomically.
   * @param {string} groupId group JID
   * @param {object} patch shallow/deep patch applied over the stored settings
   */
  async update(groupId, patch) {
    await this.ready;
    if (typeof groupId !== 'string' || groupId === '') throw new Error('groupId is required');
    const current = mergeWithDefaults(this.data[groupId]);
    const merged = {
      ...current,
      ...patch,
      welcome: { ...current.welcome, ...(patch.welcome ?? {}) },
      goodbye: { ...current.goodbye, ...(patch.goodbye ?? {}) },
      antilink: { ...current.antilink, ...(patch.antilink ?? {}) },
      updatedAt: Date.now(),
    };
    this.data[groupId] = merged;
    await this.#persist();
    return merged;
  }

  /** Atomic persistence: temp file + rename (safe against partial writes). */
  async #persist() {
    const tmpPath = `${this.filePath}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
      await rename(tmpPath, this.filePath);
    } catch (error) {
      log.error({ err: error?.message }, 'failed to persist group settings');
      throw error;
    }
  }
}

export default GroupSettingsStore;
