/**
 * message-parser.js — single source of truth for turning a raw Baileys
 * WAMessage into text, command parts, mentions and quoted targets.
 *
 * Pure functions only (no socket access) so they are trivially unit-testable.
 */
import { extractMessageContent, getContentType } from '@whiskeysockets/baileys';
import { isGroupJid } from './utils/jid.js';

/**
 * Extract the user-visible text from any supported message shape:
 * plain conversation, extended text (replies/long text), media captions
 * (image/video/document/gif/audio) and wrapped formats (ephemeral, viewOnce,
 * edited, device-wrapped). Returns '' for anything without text.
 */
export function extractText(message) {
  if (!message || typeof message !== 'object') return '';
  let content;
  try {
    content = extractMessageContent(message) ?? message;
  } catch {
    content = message;
  }
  if (!content || typeof content !== 'object') return '';

  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    content.templateButtonReplyMessage?.selectedDisplayText ??
    '';

  return typeof text === 'string' ? text : '';
}

/** The message type name ('extendedTextMessage', …) or null. */
export function messageType(message) {
  try {
    return getContentType(message ?? undefined) ?? null;
  } catch {
    return null;
  }
}

/** True for protocol messages (revoke, admin change…) the bot never commands. */
export function isProtocolMessage(message) {
  return messageType(message) === 'protocolMessage';
}

/**
 * Parse a command line into its parts.
 *   parseCommand('.kick @user now', '.') →
 *   { prefix: '.', name: 'kick', args: ['@user', 'now'], argText: '@user now' }
 * Returns null when the text is not a command with the given prefix.
 */
export function parseCommand(text, prefix = '.') {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const body = trimmed.slice(prefix.length).trim();
  if (body === '') return null;
  const [rawName, ...args] = body.split(/\s+/);
  const name = rawName.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
  return {
    prefix,
    name,
    args,
    argText: args.join(' '),
    raw: trimmed,
  };
}

/** Mentioned JIDs from contextInfo (bounded, deduplicated). */
export function extractMentions(message, max = 500) {
  const contextInfo =
    message?.extendedTextMessage?.contextInfo ??
    message?.imageMessage?.contextInfo ??
    message?.videoMessage?.contextInfo ??
    message?.documentMessage?.contextInfo ??
    message?.conversation?.contextInfo;
  const mentioned = contextInfo?.mentionedJid;
  if (!Array.isArray(mentioned)) return [];
  return [...new Set(mentioned.filter((jid) => typeof jid === 'string' && jid !== ''))].slice(0, max);
}

/**
 * Reconstruct a quoted (replied-to) message into a { key, content } pair that
 * can be passed to sendMessage({ delete: key }) or used as `quoted:`.
 * The key is built from trusted contextInfo fields (stanzaId/participant) that
 * WhatsApp itself provides — never from user-serialized input.
 */
export function extractQuoted(message, chatId) {
  const contextInfo =
    message?.extendedTextMessage?.contextInfo ??
    message?.imageMessage?.contextInfo ??
    message?.videoMessage?.contextInfo ??
    message?.documentMessage?.contextInfo ??
    null;
  const quotedContent = contextInfo?.quotedMessage;
  if (!quotedContent || !contextInfo?.stanzaId) return null;

  const isGroup = isGroupJid(chatId);
  const key = {
    remoteJid: chatId ?? null,
    id: contextInfo.stanzaId,
    // In groups the original author must be referenced for delete/reply.
    participant: isGroup ? contextInfo.participant ?? null : null,
    fromMe: false,
  };
  return { key, content: quotedContent, participant: contextInfo.participant ?? null };
}

/** Basic sanity filter for incoming WAMessage objects. */
export function isProcessableMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!message.key || typeof message.key !== 'object') return false;
  if (typeof message.key.remoteJid !== 'string' || message.key.remoteJid === '') return false;
  if (typeof message.key.id !== 'string' || message.key.id === '') return false;
  return Boolean(message.message);
}
