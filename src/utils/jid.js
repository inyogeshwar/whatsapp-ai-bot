/**
 * utils/jid.js — safe JID handling for Baileys v7.
 *
 * In Baileys v7 every user has TWO identity forms:
 *   - PN JID  (phone number):  15551234567@s.whatsapp.net
 *   - LID JID (linked id):     123456789012345@lid
 * Both may also carry a device suffix ("15551234567:2@s.whatsapp.net").
 * Comparing JIDs with === or splitting strings is therefore unsafe —
 * always go through these helpers.
 */
import {
  jidDecode,
  jidNormalizedUser,
  areJidsSameUser,
  isJidGroup,
  isJidNewsletter,
  isJidBroadcast,
  isLidUser,
} from '@whiskeysockets/baileys';

/** True when the JID is a group chat ("...@g.us"). */
export function isGroupJid(jid) {
  return typeof jid === 'string' && isJidGroup(jid);
}

/** True for status/broadcast lists and newsletters — chats the bot ignores. */
export function isSystemJid(jid) {
  if (typeof jid !== 'string') return true;
  return isJidBroadcast(jid) || isJidNewsletter(jid);
}

/**
 * Compare two JIDs belonging to the SAME identity form, ignoring device
 * suffixes. Never compare raw JID strings — use this.
 */
export function sameUser(a, b) {
  if (!a || !b) return false;
  try {
    return areJidsSameUser(a, b);
  } catch {
    return false;
  }
}

/**
 * Compare an identifier against a list, tolerating both PN and LID forms.
 * @param {string} candidate JID to test
 * @param {string[]} forms one or more JIDs for the same account (PN + LID + alts)
 */
export function matchesAny(candidate, forms) {
  if (!candidate || !Array.isArray(forms)) return false;
  return forms.filter(Boolean).some((form) => sameUser(candidate, form));
}

/** Strip the device suffix and return the bare user part, or null. */
export function jidUser(jid) {
  try {
    return jidDecode(jid)?.user ?? null;
  } catch {
    return null;
  }
}

/** Normalize a JID (drop device suffix), or return the input unchanged on failure. */
export function normalizeJid(jid) {
  if (typeof jid !== 'string' || jid === '') return jid;
  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

/** True when the JID is a LID (opaque linked-identity JID). */
export function isLid(jid) {
  try {
    return isLidUser(jid);
  } catch {
    return false;
  }
}

/**
 * The user portion shown to humans ("15551234567"). Safe for logs and menus —
 * it is the identifier WhatsApp itself displays in groups.
 */
export function displayUser(jid) {
  return jidUser(jid) ?? 'unknown';
}

/**
 * Resolve the sender's identity from a message key, keeping both forms.
 * Groups address senders via `participant`; DMs via `remoteJid`.
 * v7 adds `participantAlt` / `remoteJidAlt` carrying the paired PN/LID form.
 */
export function senderFromKey(key) {
  if (!key) return { id: null, altId: null };
  const isGroup = isGroupJid(key.remoteJid);
  const id = isGroup ? key.participant ?? key.remoteJid : key.remoteJid;
  const altId = isGroup ? key.participantAlt ?? null : key.remoteJidAlt ?? null;
  return { id: id ?? null, altId: altId ?? null };
}
