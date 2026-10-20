/**
 * .menu / .help — categorized command menu.
 * Commands whose requirements are not met in the current chat are marked;
 * the AI command is hidden entirely unless AI is enabled and reachable.
 */
export default {
  name: 'menu',
  aliases: ['help'],
  category: 'general',
  description: 'List every available command.',
  usage: '.menu',
  cooldown: 5,
  async execute(ctx) {
    const groups = ctx.registry.byCategory();
    const lines = [`╭─ *${ctx.config.botName}* ─ menu`];

    const categoryTitles = {
      general: '🔧 General',
      tools: '🧰 Tools',
      fun: '🎉 Fun',
      admin: '🛡 Group Administration',
      ai: '🤖 AI',
    };

    for (const [category, commands] of groups) {
      // Hide the whole AI category unless it is enabled.
      if (category === 'ai' && !ctx.config.ai.enabled) continue;

      const visible = [];
      for (const command of commands) {
        visible.push(command);
      }
      if (visible.length === 0) continue;

      lines.push(`│`);
      lines.push(`│ ${categoryTitles[category] ?? category}`);
      for (const command of visible) {
        const alias = command.aliases.length > 0 ? ` (${command.aliases.map((a) => ctx.config.prefix + a).join(', ')})` : '';
        lines.push(`│  ${ctx.config.prefix}${command.name}${alias}`);
        lines.push(`│     ${command.description}`);
      }
    }

    lines.push('╰────────────────');
    lines.push(`Use ${ctx.config.prefix}<command> — e.g. ${ctx.config.prefix}ping`);
    lines.push(`Admin commands require group admin rights or the bot owner.`);
    await ctx.reply(lines.join('\n'));
  },
};
