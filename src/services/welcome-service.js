/**
 * services/welcome-service.js — welcome and goodbye messages.
 *
 * Listens to `group-participants.update`, handles multiple participants per
 * event, renders per-group templates with safe placeholder substitution, and
 * suppresses duplicate notifications. Group metadata failures degrade to a
 * fallback group name — never a crash.
 */
import { createLogger } from '../logger.js';
import { fillTemplate } from '../utils/text.js';
import { normalizeJid } from '../utils/jid.js';
import { mentionOf } from '../utils/group.js';
import { RecentSet } from '../rate-limiter.js';
import { fetchMetadata } from './metadata-cache.js';

const log = createLogger('welcome');

/** De-dupe: the same group+action+participant is announced at most once. */
const announced = new RecentSet(10 * 60 * 1000, 10_000);

/**
 * Build and send a welcome/goodbye message for a participant.
 * @returns {Promise<'sent'|'disabled'|'duplicate'|'failed'>}
 */
async function announce(sock, settingsStore, groupId, participantJid, kind) {
  const dedupeKey = `${groupId}:${kind}:${participantJid}`;
  if (announced.has(dedupeKey)) return 'duplicate';

  const settings = settingsStore.get(groupId);
  const feature = settings?.[kind];
  if (!feature?.enabled) return 'disabled';

  announced.add(dedupeKey);

  let groupName = 'this group';
  try {
    const metadata = await fetchMetadata(sock, groupId);
    if (metadata?.subject) groupName = metadata.subject;
  } catch {
    // Metadata unavailable (bot may have just left, or a network hiccup) —
    // fall back to the generic name.
  }

  const mention = mentionOf(participantJid);
  const body = fillTemplate(feature.template, { user: mention, group: groupName }, 200);
  const text = `${body}`.slice(0, 2000);

  try {
    await sock.sendMessage(groupId, { text, mentions: [normalizeJid(participantJid)] });
    log.info({ group: groupId, kind }, 'welcome-service notification sent');
    return 'sent';
  } catch (error) {
    log.warn({ err: error?.message, kind }, 'welcome-service failed to send');
    return 'failed';
  }
}

/**
 * Attach the group-participants listener to a socket.
 * Handles: add → welcome, remove → goodbye (kicks and leaves alike).
 * Promote/demote events are ignored by design.
 */
export function attachWelcomeService(sock, { settingsStore } = {}) {
  if (!settingsStore) {
    log.warn('welcome service disabled: no settings store provided');
    return;
  }

  sock.ev.on('group-participants.update', (event) => {
    // One event may carry several participants — handle each independently.
    handleEvent(sock, settingsStore, event).catch((error) => {
      log.error({ err: error?.message }, 'welcome-service event failure');
    });
  });
  log.debug('welcome service attached');
}

async function handleEvent(sock, settingsStore, event) {
  const { id: groupId, participants, action } = event ?? {};
  if (!groupId || !Array.isArray(participants) || participants.length === 0) return;
  if (action !== 'add' && action !== 'remove') return;

  // Bound the work per event (very large groups can produce big batches).
  const bounded = participants.slice(0, 100);
  for (const participant of bounded) {
    const jid = typeof participant === 'string' ? participant : participant?.id;
    if (!jid) continue;

    // Never send the bot its own goodbye when it is removed from a group.
    const botForms = [sock.user?.id, sock.user?.lid].filter(Boolean);
    const normalized = String(jid).split(':')[0];
    if (botForms.some((form) => String(form).split(':')[0] === normalized)) continue;

    await announce(sock, settingsStore, groupId, jid, action === 'add' ? 'welcome' : 'goodbye');
  }
}

export { announce as _announceForTests };
export default { attachWelcomeService };
