/**
 * .demote @user — demote an administrator to regular member.
 */
import { runParticipantAction } from './_participant-actions.js';

export default {
  name: 'demote',
  aliases: [],
  category: 'admin',
  description: 'Demote a group administrator (admin only).',
  usage: '.demote @user (or reply to the user)',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 5,
  async execute(ctx) {
    const error = await runParticipantAction(ctx, 'demote');
    if (error) await ctx.reply(error);
  },
};
