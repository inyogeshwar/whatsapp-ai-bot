/**
 * command-registry.js — registry of command modules with alias support.
 *
 * Every command module default-exports a metadata object; the registry
 * validates the shape at registration time so a broken command fails loudly
 * at startup, not silently at 3 a.m.
 */
import { createLogger } from './logger.js';

const log = createLogger('registry');

const REQUIRED_FIELDS = ['name', 'category', 'description', 'execute'];

/** Thrown for invalid command modules. */
export class InvalidCommandError extends Error {}

export class CommandRegistry {
  constructor() {
    /** @type {Map<string, object>} name/alias (lowercase) → command module */
    this.byName = new Map();
    /** @type {Set<object>} unique command modules */
    this.commands = new Set();
  }

  /** Validate and register a command module. */
  register(command) {
    if (!command || typeof command !== 'object') {
      throw new InvalidCommandError('Command must be an object');
    }
    for (const field of REQUIRED_FIELDS) {
      if (command[field] === undefined || command[field] === null) {
        throw new InvalidCommandError(`Command is missing required field "${field}"`);
      }
    }
    if (typeof command.execute !== 'function') {
      throw new InvalidCommandError(`Command "${command.name}" execute must be a function`);
    }
    const name = String(command.name).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
      throw new InvalidCommandError(`Command name "${command.name}" contains invalid characters`);
    }
    const aliases = Array.isArray(command.aliases)
      ? command.aliases.map((a) => String(a).toLowerCase())
      : [];

    for (const key of [name, ...aliases]) {
      if (this.byName.has(key)) {
        throw new InvalidCommandError(`Duplicate command name or alias: "${key}"`);
      }
    }

    const normalized = {
      aliases: [],
      category: 'general',
      usage: '',
      groupOnly: false,
      adminOnly: false,
      botAdminOnly: false,
      ownerOnly: false,
      cooldown: 3,
      ...command,
      name,
      // Aliases are re-attached only for menu display; lookup uses the map.
      aliases: aliases.filter((a) => a !== name),
    };

    this.byName.set(name, normalized);
    for (const alias of normalized.aliases) this.byName.set(alias, normalized);
    this.commands.add(normalized);
    log.debug({ command: name, aliases: normalized.aliases }, 'command registered');
    return normalized;
  }

  /** Look up a command by canonical name or alias (case-insensitive). */
  get(name) {
    if (typeof name !== 'string') return null;
    return this.byName.get(name.toLowerCase()) ?? null;
  }

  /** Every unique command, grouped by category, sorted for menus. */
  byCategory() {
    const groups = new Map();
    for (const command of this.commands) {
      if (!groups.has(command.category)) groups.set(command.category, []);
      groups.get(command.category).push(command);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }

  get size() {
    return this.commands.size;
  }
}

export default CommandRegistry;
