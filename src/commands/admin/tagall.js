/**
 * .tagall [message] — mention every group member with an optional message.
 *
 * Safety rails (PRD FR-4):
 *   - admin/owner only (enforced centrally + double-checked here)
 *   - participants come from LIVE group metadata, never user input
 *   - the bot excludes itself
 *   - per-group cooldown prevents abuse
 *   - mentions are chunked into batches so huge groups cannot produce a
 *     single gigantic spam message
 */
import { enforceGroupCooldown } from '../../handler.js';
import { config } from '../../config.js';
import { participantIds, mentionOf } from '../../utils/group.js';

export default {
  name: 'tagall',
  aliases: ['everyone', 'all'],
  category: 'admin',
  description: 'Mention all group members (admin only).',
  usage: '.tagall [message]',
  groupOnly: true,
  adminOnly: true,
  cooldown: 0, // per-group cooldown handled below
  async execute(ctx) {
    // Per-group cooldown to prevent mention-spam loops.
    const cd = enforceGroupCooldown(ctx.chatId, config.limits.tagallCooldownSec);
    if (cd.onCooldown) {
      await ctx.reply(`⏳ .tagall is on cooldown for this group — wait ${cd.remainingSec}s.`);
      return;
    }

    const meta = ctx.groupMetadata;
    if (!meta) {
      await ctx.reply('Could not fetch the current member list. Please try again.');
      return;
    }

    // Live metadata participants, excluding the bot itself.
    const botForms = [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean);
    const members = participantIds(meta, { exclude: botForms });
    if (members.length === 0) {
      await ctx.reply('No members to mention.');
      return;
    }

    const custom = ctx.command.argText.trim().slice(0, 500);
    const header = custom !== '' ? `📢 *${custom}*` : '📢 *Tagging all group members:*';

    const batchSize = Math.min(250, config.limits.tagallBatchSize);
    for (let i = 0; i < members.length; i += batchSize) {
      const batch = members.slice(i, i + batchSize);
      const mentionsText = batch.map((jid) => mentionOf(jid)).join(' ');
      const part =
        members.length > batchSize ? `\n_(batch ${Math.floor(i / batchSize) + 1})_` : '';
      await ctx.sock.sendMessage(
        ctx.chatId,
        { text: `${header}${part}\n${mentionsText}`, mentions: batch },
        i === 0 ? { quoted: ctx.message } : undefined
      );
    }
    ctx.log?.info?.({ members: members.length }, 'tagall executed');
  },
};
