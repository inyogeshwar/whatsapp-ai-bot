/**
 * .kick @user — remove a member (admin only, bot must be admin).
 */
import { runParticipantAction } from './_participant-actions.js';

export default {
  name: 'kick',
  aliases: ['remove'],
  category: 'admin',
  description: 'Remove a member from the group (admin only).',
  usage: '.kick @user (or reply to the user)',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  cooldown: 5,
  async execute(ctx) {
    const error = await runParticipantAction(ctx, 'remove');
    if (error) await ctx.reply(error);
  },
};
