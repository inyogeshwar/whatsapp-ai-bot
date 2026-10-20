/**
 * utils/message.js — sending helpers and the command context builder.
 *
 * The context object ("ctx") is what every command receives. Building it in
 * one place keeps commands small and guarantees consistent permission data.
 */
import { config } from '../config.js';
import { extractMentions, extractQuoted } from '../message-parser.js';
import { senderFromKey, isGroupJid } from './jid.js';
import { isParticipantAdmin, findParticipant } from './group.js';
import { truncate } from './text.js';

/** Send a reply to the chat, quoting the invoking message. Never throws. */
export async function reply(sock, message, content) {
  const chatId = message?.key?.remoteJid;
  if (!chatId) return null;
  const payload = typeof content === 'string' ? { text: truncate(content) } : content;
  try {
    return await sock.sendMessage(chatId, payload, { quoted: message });
  } catch {
    // Fallback: plain message without quoting (quoted message may be too old).
    try {
      return await sock.sendMessage(chatId, payload);
    } catch {
      return null;
    }
  }
}

/** React to a message with an emoji ('' removes the reaction). Never throws. */
export async function react(sock, message, emoji) {
  try {
    return await sock.sendMessage(message.key.remoteJid, {
      react: { text: emoji, key: message.key },
    });
  } catch {
    return null;
  }
}

/**
 * The bot's own JID forms (main device + LID) for self-exclusion checks.
 */
export function botIdentity(sock) {
  const id = sock?.user?.id ?? null;
  const lid = sock?.user?.lid ?? null;
  return { id, lid, forms: [id, lid].filter(Boolean) };
}

/**
 * Build the reusable command context passed to command.execute(ctx).
 *
 * @param {object} params
 * @param {WASocket} params.sock
 * @param {WAMessage} params.message
 * @param {object} params.command   parsed command from message-parser
 * @param {object} params.registry  command registry (for cooldown metadata)
 * @param {import('../group-settings.js').GroupSettingsStore} params.settings
 * @param {object|null} params.groupMetadata cached/fetched group metadata
 */
export function buildContext({ sock, message, command, settings, groupMetadata }) {
  const chatId = message.key.remoteJid;
  const isGroup = isGroupJid(chatId);
  const { id: senderId, altId: senderAltId } = senderFromKey(message.key);
  const bot = botIdentity(sock);

  const isSenderAdmin = isGroup
    ? isParticipantAdmin(groupMetadata, senderId, senderAltId)
    : false;
  const isBotAdmin = isGroup ? isParticipantAdmin(groupMetadata, ...bot.forms) : false;
  const isBot = bot.forms.some((form) => form && senderId && form.split(':')[0] === String(senderId).split(':')[0]);

  const mentionedJid = extractMentions(message.message, config.limits.maxMentions);
  const quoted = extractQuoted(message.message, chatId);

  const ctx = {
    sock,
    message,
    chatId,
    senderId,
    senderAltId,
    isGroup,
    groupMetadata,
    participants: groupMetadata?.participants ?? [],
    isSenderAdmin,
    isBotAdmin,
    isBot,
    command,
    mentionedJid,
    quoted,
    settings,
    config,
    reply: (content) => reply(sock, message, content),
    react: (emoji) => react(sock, message, emoji),
  };

  // isOwner needs the signal repository (async PN→LID lookup); resolved lazily
  // by permissions.resolveOwner and stored here before dispatch.
  ctx.isOwner = false;
  return ctx;
}

/**
 * Resolve a moderation target from mentions or the quoted message.
 * Returns { jid, participant } or null. Uses ONLY WhatsApp-provided metadata —
 * never user-typed JIDs.
 */
export function resolveTarget(ctx) {
  const mentioned = ctx.mentionedJid.filter((jid) => jid !== ctx.sock?.user?.id);
  if (mentioned.length > 0) {
    const jid = mentioned[0];
    const entry = findParticipant(ctx.groupMetadata, jid);
    return { jid: entry?.id ?? jid, allJids: [jid, entry?.lid, entry?.phoneNumber].filter(Boolean) };
  }
  if (ctx.quoted?.participant) {
    const entry = findParticipant(ctx.groupMetadata, ctx.quoted.participant);
    return {
      jid: entry?.id ?? ctx.quoted.participant,
      allJids: [ctx.quoted.participant, entry?.lid, entry?.phoneNumber].filter(Boolean),
    };
  }
  return null;
}
