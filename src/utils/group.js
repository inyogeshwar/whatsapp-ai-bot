/**
 * utils/group.js — helpers for reading group metadata safely.
 *
 * In Baileys v7, group participant IDs are typically LIDs (…@lid) and every
 * ID-bearing field has a paired PN field. Checks here therefore always compare
 * against BOTH the participant id and its alternate form.
 */
import { sameUser, matchesAny, normalizeJid } from './jid.js';

/** All admin JIDs of a group ('admin' and 'superadmin'). */
export function adminJids(metadata) {
  const participants = metadata?.participants ?? [];
  return participants
    .filter((p) => p?.admin === 'admin' || p?.admin === 'superadmin')
    .map((p) => p.id)
    .filter(Boolean);
}

/**
 * Find a participant entry by any of its JID forms (id, lid, phoneNumber).
 * @returns {{ id: string, admin: string|null, ... } | undefined}
 */
export function findParticipant(metadata, ...jids) {
  const wanted = jids.filter(Boolean);
  if (wanted.length === 0) return undefined;
  const participants = metadata?.participants ?? [];
  return participants.find((p) => {
    if (!p) return false;
    const forms = [p.id, p.lid, p.phoneNumber].filter(Boolean);
    return wanted.some((jid) => matchesAny(jid, forms));
  });
}

/** True when the given user (any JID form) is a group admin. */
export function isParticipantAdmin(metadata, ...jids) {
  const participant = findParticipant(metadata, ...jids);
  return Boolean(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
}

/** True when the given user is a regular member (present but not admin). */
export function isParticipantMember(metadata, ...jids) {
  const p = findParticipant(metadata, ...jids);
  return Boolean(p) && !p.admin;
}

/** True when both identifiers refer to the same participant entry. */
export function sameParticipant(a, b) {
  return sameUser(a, b);
}

/** Human-readable mention for a participant JID ("@15551234567"). */
export function mentionOf(jid) {
  const user = String(jid ?? '').split(':')[0].split('@')[0];
  return user ? `@${user}` : '@unknown';
}

/** Participant JIDs excluding a set of JIDs (used to exclude the bot). */
export function participantIds(metadata, { exclude = [] } = {}) {
  const participants = metadata?.participants ?? [];
  return participants
    .map((p) => p?.id)
    .filter((id) => Boolean(id) && !matchesAny(id, exclude))
    .map((id) => normalizeJid(id));
}
