/**
 * .promote @user — promote a member to group admin.
 */
import { runParticipantAction } from './_participant-actions.js';

export default {
  name: 'promote',
  aliases: [],
  category: 'admin',
  description: 'Promote a member to group administrator (admin only).',
  usage: '.promote @user (or reply to the user)',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 5,
  async execute(ctx) {
    const error = await runParticipantAction(ctx, 'promote');
    if (error) await ctx.reply(error);
  },
};
