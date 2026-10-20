/**
 * Shared logic for member-management commands (.kick, .promote, .demote).
 *
 * Targets are resolved ONLY from WhatsApp-provided metadata (mentions or the
 * replied-to message) — a user-typed JID string is never trusted.
 */
import { resolveTarget } from '../../utils/message.js';
import { findParticipant } from '../../utils/group.js';
import { sameUser } from '../../utils/jid.js';

/**
 * Perform a participant action with all safety checks.
 * @param {object} ctx
 * @param {'remove'|'promote'|'demote'} action
 * @returns {Promise<string>} user-facing result message
 */
export async function runParticipantAction(ctx, action) {
  const target = resolveTarget(ctx);
  if (!target) {
    const example =
      action === 'remove' ? 'kick' : action === 'promote' ? 'promote' : 'demote';
    return `Please mention a member or reply to their message, e.g.\n${ctx.config.prefix}${example} @user`;
  }

  // The target must currently be a member of THIS group (live metadata).
  const participant = findParticipant(ctx.groupMetadata, ...target.allJids);
  if (!participant) {
    return 'That user is not a member of this group (anymore).';
  }

  // The bot itself must never be the target of these actions.
  const botForms = [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean);
  if (botForms.some((form) => sameUser(form, participant.id))) {
    return 'I will not perform this action on myself.';
  }

  const display = `@${String(participant.id).split(':')[0].split('@')[0]}`;

  if (action === 'remove' && participant.admin) {
    return 'Use .demote on administrators first; .kick only removes regular members.';
  }
  if (action === 'promote' && participant.admin) {
    return 'That user is already an administrator.';
  }
  if (action === 'demote' && !participant.admin) {
    return 'That user is not an administrator.';
  }

  try {
    await ctx.sock.groupParticipantsUpdate(ctx.chatId, [participant.id], action);
  } catch (error) {
    ctx.logger?.warn?.({ err: error?.message, action }, 'participant action failed');
    return `❌ The ${action} action failed. Check that I am an admin and outrank the target.`;
  }

  const verbs = { remove: 'removed from the group', promote: 'promoted to admin', demote: 'demoted' };
  const line = `✅ ${display} has been ${verbs[action]}.`;
  try {
    await ctx.sock.sendMessage(ctx.chatId, { text: line, mentions: [participant.id] });
  } catch {
    await ctx.reply(line);
  }
  return null; // already replied
}
