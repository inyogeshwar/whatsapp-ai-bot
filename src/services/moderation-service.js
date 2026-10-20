/**
 * services/moderation-service.js — anti-link enforcement.
 *
 * Policy (per PRD FR-6):
 *   - Runs for every group message that contains a URL (command or not).
 *   - Skips the configured owner and (by default) group admins.
 *   - Skips URLs whose domain is on the group's allowlist.
 *   - Deletes the offending message ONLY when the bot is a group admin.
 *   - Sends at most ONE warning per message (deduplicated by message id).
 *   - Never kicks, never bans, never loops.
 *   - All failures are caught and logged — moderation must not break the
 *     message pipeline.
 */
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { findUrls, isDomainAllowed } from '../utils/text.js';
import { senderFromKey } from '../utils/jid.js';
import { isParticipantAdmin } from '../utils/group.js';
import { isOwner } from '../permissions.js';
import { fetchMetadata, invalidateMetadata } from './metadata-cache.js';
import { RecentSet } from '../rate-limiter.js';

const log = createLogger('moderation');

/** Message ids we already actioned (prevents duplicate warnings/deletes). */
const actionedIds = new RecentSet(30 * 60 * 1000, 10_000);

/**
 * Check one group message for link violations and act when configured.
 * @param {object} sock    live socket
 * @param {WAMessage} message
 * @param {string} text    extracted text/caption (may be '')
 * @param {object} [store] group settings store (defaults to runtime store)
 */
export async function checkAntiLink(sock, message, text, store = null) {
  const settingsStore = store ?? getRuntimeStore();
  if (!settingsStore) return { action: 'skipped' };

  const chatId = message?.key?.remoteJid;
  if (!chatId || !text) return { action: 'skipped' };

  const settings = settingsStore.get(chatId);
  const anti = settings.antilink;
  if (!anti?.enabled) return { action: 'skipped' };

  const urls = findUrls(text);
  if (urls.length === 0) return { action: 'skipped' };

  // All URLs whitelisted → allowed.
  if (urls.every((url) => isDomainAllowed(url, anti.allowedDomains))) {
    return { action: 'allowed', urls };
  }

  const dedupeKey = `${chatId}:${message.key.id}`;
  if (actionedIds.has(dedupeKey)) return { action: 'duplicate' };

  // Identity of the sender (both JID forms for LID-safe admin checks).
  const { id: senderId, altId } = senderFromKey(message.key);

  // Owner is always exempt.
  if (await isOwner(sock, [senderId, altId].filter(Boolean), config)) {
    return { action: 'exempt', reason: 'owner' };
  }

  // Admin exemption requires metadata — fetch lazily, only now.
  const metadata = await fetchMetadata(sock, chatId);
  if (anti.exemptAdmins && metadata && isParticipantAdmin(metadata, senderId, altId)) {
    return { action: 'exempt', reason: 'admin' };
  }

  actionedIds.add(dedupeKey);

  const botIsAdmin = metadata
    ? isParticipantAdmin(metadata, sock.user?.id, sock.user?.lid)
    : false;

  let deleted = false;
  if (botIsAdmin) {
    try {
      // Use the REAL message key provided by WhatsApp — never user input.
      await sock.sendMessage(chatId, { delete: message.key });
      deleted = true;
      invalidateMetadata(chatId);
    } catch (error) {
      log.error({ err: error?.message, group: chatId }, 'moderation.action_failed: delete');
    }
  }

  let warned = false;
  const warnText = typeof anti.warnMessage === 'string' && anti.warnMessage.trim() !== ''
    ? anti.warnMessage.trim().slice(0, 500)
    : 'Links are not allowed in this group.';
  if (!deleted) {
    // Bot lacks admin rights: warn (and tell admins what to do) instead.
    try {
      await sock.sendMessage(
        chatId,
        { text: `⚠️ ${warnText}\n(I could not delete the message because I am not an admin.)` },
        { quoted: message }
      );
      warned = true;
    } catch {
      /* ignore */
    }
  } else {
    try {
      await sock.sendMessage(
        chatId,
        { text: `⚠️ ${warnText}` },
        { quoted: undefined }
      );
      warned = true;
    } catch {
      /* ignore */
    }
  }

  log.info(
    { group: chatId, deleted, warned, urlCount: urls.length },
    'moderation.antilink_action'
  );
  return { action: deleted ? 'deleted' : 'warned', urls };
}

// The runtime store is injected to keep this module test-friendly.
let runtimeStore = null;
function getRuntimeStore() {
  return runtimeStore;
}

/** Called once at startup with the GroupSettingsStore instance. */
export function setModerationStore(store) {
  runtimeStore = store;
}

/** Tests only. */
export function _resetModerationState() {
  actionedIds.reset();
  runtimeStore = null;
}

export default { checkAntiLink, setModerationStore };
