/**
 * permissions.js — central authorization for every command.
 *
 * Identity rules for Baileys v7:
 *   - Users have BOTH a PN JID (…@s.whatsapp.net) and a LID (…@lid),
 *     optionally with a device suffix (":2").
 *   - Group metadata participant IDs are usually LIDs; the paired PN lives in
 *     `lid`/`phoneNumber` fields.
 *   - Owner status comes ONLY from validated env config — never from a display
 *     name, contact card, command argument, or anything inside a message.
 */
import { matchesAny, sameUser, isGroupJid, senderFromKey } from './utils/jid.js';
import { isParticipantAdmin } from './utils/group.js';
import { createLogger } from './logger.js';

const log = createLogger('permissions');

/** True when the JID is a group chat. */
export function isGroup(jid) {
  return isGroupJid(jid);
}

/**
 * Resolve the sender's JID forms from a message key.
 * @returns {{ id: string|null, altId: string|null, forms: string[] }}
 */
export function resolveSender(message) {
  const { id, altId } = senderFromKey(message?.key);
  return { id, altId, forms: [id, altId].filter(Boolean) };
}

/** True when the sender is a group administrator (checks both JID forms). */
export function isGroupAdmin(groupMetadata, senderId, senderAltId = null) {
  if (!groupMetadata || !senderId) return false;
  return isParticipantAdmin(groupMetadata, senderId, senderAltId);
}

/** True when the bot itself is a group administrator (checks all bot forms). */
export function isBotGroupAdmin(groupMetadata, botForms = []) {
  if (!groupMetadata || botForms.length === 0) return false;
  return isParticipantAdmin(groupMetadata, ...botForms);
}

/**
 * True when the sender is the configured bot owner.
 *
 * Compares against BOTH configured forms and, when available, resolves the
 * configured PN → LID through Baileys' mapping store so a PN-configured owner
 * is recognized even when messages arrive addressed by LID. The mapping lookup
 * is best-effort; failures fall back to direct form comparison.
 */
export async function isOwner(sock, senderForms, config) {
  const ownerJid = config?.ownerJid;
  if (!ownerJid || senderForms.length === 0) return false;

  const forms = [ownerJid, ...senderForms];
  if (matchesAny(ownerJid, senderForms)) return true;

  // Bridge PN → LID (or LID → cached PN) when the signal repository knows it.
  // Both directions are mapped: the sender AND the configured owner are
  // resolved so a PN-configured owner is recognized when messages arrive
  // addressed by LID (and vice versa), as long as Baileys has the mapping.
  try {
    const lidMapping = sock?.signalRepository?.lidMapping;
    if (lidMapping) {
      const bridge = async (form) => {
        if (typeof form !== 'string') return null;
        if (form.includes('@s.whatsapp.net')) {
          return typeof lidMapping.getLIDForPN === 'function'
            ? await lidMapping.getLIDForPN(form)
            : null;
        }
        if (form.includes('@lid')) {
          return typeof lidMapping.getPNForLID === 'function'
            ? await lidMapping.getPNForLID(form)
            : null;
        }
        return null;
      };

      const ownerMapped = await bridge(ownerJid);
      if (ownerMapped && matchesAny(ownerMapped, senderForms)) return true;

      for (const form of senderForms) {
        const mapped = await bridge(form);
        if (!mapped) continue;
        if (matchesAny(ownerJid, [mapped])) return true;
        forms.push(mapped);
      }
    }
  } catch {
    // Best-effort only — fall through to the direct comparison result.
  }
  return false;
}

/**
 * Resolve command targets from mentions and/or the quoted message using only
 * WhatsApp-provided metadata. Returns [] when nothing valid is targeted.
 */
export function resolveTargets({ mentionedJid = [], quoted = null, groupMetadata = null }) {
  const targets = [];
  for (const jid of mentionedJid) {
    if (typeof jid === 'string' && jid !== '') targets.push({ jid, source: 'mention' });
  }
  if (targets.length === 0 && quoted?.participant) {
    targets.push({ jid: quoted.participant, source: 'reply' });
  }
  return targets;
}

/** True when a quoted message exists. */
export function hasQuoted(quoted) {
  return Boolean(quoted && quoted.key && quoted.key.id);
}

/**
 * Central access gate — called by handler.js BEFORE any command executes.
 * Returns { ok: true } or { ok: false, userMessage, reason }.
 *
 * @param {object} ctx      command context (see utils/message.js)
 * @param {object} command  the command module being invoked
 * @param {object} sock     live socket (for owner LID bridging)
 */
export async function evaluateAccess(ctx, command, sock) {
  const deny = (userMessage, reason) => {
    log.warn({ command: command.name, reason, chat: ctx.isGroup ? 'group' : 'private' }, 'command denied');
    return { ok: false, userMessage, reason };
  };

  if (command.ownerOnly && !ctx.isOwner) {
    return deny('Only the bot owner can use this command.', 'owner_only');
  }
  if (command.groupOnly && !ctx.isGroup) {
    return deny('This command can only be used in a group.', 'group_only');
  }
  if (command.adminOnly) {
    const owner = ctx.isOwner || (await isOwner(sock, [ctx.senderId, ctx.senderAltId].filter(Boolean), ctx.config));
    if (!ctx.isSenderAdmin && !owner) {
      return deny('This command is for group administrators only.', 'admin_only');
    }
  }
  if (command.botAdminOnly && !ctx.isBotAdmin) {
    return deny(
      'I need to be a group administrator for this. Promote me first (.promote @bot).',
      'bot_admin_only'
    );
  }
  return { ok: true };
}

/** Same-user comparison re-exported for commands that need it. */
export { sameUser };
