/**
 * commands/register.js — statically imports every command module and
 * registers it into the given registry.
 *
 * Static imports (rather than filesystem scanning) mean: cross-platform
 * behavior, immediate startup errors for broken modules, and a list a
 * beginner can read top-to-bottom to see every command the bot has.
 */
import ping from './general/ping.js';
import alive from './general/alive.js';
import menu from './general/menu.js';
import owner from './general/owner.js';
import groupinfo from './general/groupinfo.js';
import admins from './general/admins.js';
import rules from './general/rules.js';
import quote from './general/quote.js';
import uptime from './general/uptime.js';

import tagall from './admin/tagall.js';
import antilink from './admin/antilink.js';
import del from './admin/delete.js';
import welcome from './admin/welcome.js';
import goodbye from './admin/goodbye.js';
import kick from './admin/kick.js';
import promote from './admin/promote.js';
import demote from './admin/demote.js';
import group from './admin/group.js';
import setname from './admin/setname.js';
import setdesc from './admin/setdesc.js';

import ai from './ai/ai.js';
import translate from './ai/translate.js';
import summarize from './ai/summarize.js';
import code from './ai/code.js';
import explain from './ai/explain.js';

import qr from './tools/qr.js';
import sticker from './tools/sticker.js';
import weather from './tools/weather.js';
import calc from './tools/calc.js';
import define from './tools/define.js';
import shorten from './tools/shorten.js';

import joke from './fun/joke.js';
import fact from './fun/fact.js';

/** Every command module in the bot. */
export const ALL_COMMANDS = [
  // general
  ping,
  alive,
  menu,
  owner,
  groupinfo,
  admins,
  rules,
  quote,
  uptime,
  // admin
  tagall,
  antilink,
  del,
  welcome,
  goodbye,
  kick,
  promote,
  demote,
  group,
  setname,
  setdesc,
  // tools
  sticker,
  qr,
  weather,
  calc,
  define,
  shorten,
  // fun
  joke,
  fact,
  // ai (shown in menu only when AI is enabled)
  ai,
  translate,
  summarize,
  code,
  explain,
];

/** Register all commands into a CommandRegistry instance. */
export function registerAllCommands(registry) {
  for (const command of ALL_COMMANDS) {
    registry.register(command);
  }
  return registry;
}

export default registerAllCommands;
