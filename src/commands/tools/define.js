/**
 * .define <word> — English dictionary meaning using the keyless
 * dictionaryapi.dev free API.
 */
import { getJson } from '../../utils/http.js';

export default {
  name: 'define',
  aliases: ['dict', 'meaning'],
  category: 'tools',
  description: 'Look up the meaning of an English word.',
  usage: '.define <word>',
  cooldown: 5,
  async execute(ctx) {
    if (!ctx.config.web.enabled) {
      await ctx.reply('Web features are disabled on this bot.');
      return;
    }

    const word = ctx.command.argText.trim().split(/\s+/)[0]?.slice(0, 50);
    if (!word || !/^[a-zA-Z'-]+$/.test(word)) {
      await ctx.reply(`Usage: ${ctx.config.prefix}define <english word>`);
      return;
    }

    const data = await getJson(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      { timeoutMs: ctx.config.web.timeoutMs }
    );
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) {
      await ctx.reply(`🔍 No dictionary entry found for *${word}*.`);
      return;
    }

    const lines = [`📖 *${entry.word}*${entry.phonetic ? `  ${entry.phonetic}` : ''}`];
    let shown = 0;
    for (const meaning of entry.meanings ?? []) {
      const def = meaning.definitions?.[0];
      if (!def) continue;
      lines.push('');
      lines.push(`_${meaning.partOfSpeech}_`);
      lines.push(`• ${String(def.definition).slice(0, 300)}`);
      if (def.example) lines.push(`  e.g. ${String(def.example).slice(0, 200)}`);
      shown += 1;
      if (shown >= 3) break; // keep the reply short
    }

    await ctx.reply(lines.join('\n'));
  },
};
