/**
 * .fact — send a random interesting fact (offline list first, API fallback).
 */
import { getJson } from '../../utils/http.js';

const LOCAL_FACTS = [
  'Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than its year.',
  'Bananas are berries, but strawberries are not.',
  'The Eiffel Tower can grow about 15 cm taller in summer as the iron expands.',
  'Sharks existed before trees did.',
  'Your brain uses roughly 20% of the oxygen your body consumes.',
  'There are more possible chess games than atoms in the observable universe.',
  'Wombat poop is cube-shaped.',
  'The first computer bug was an actual moth found in a Harvard Mark II in 1947.',
];

export default {
  name: 'fact',
  aliases: ['facts', 'gyan'],
  category: 'fun',
  description: 'Send a random interesting fact.',
  usage: '.fact',
  cooldown: 4,
  async execute(ctx) {
    if (ctx.config.web.enabled) {
      const data = await getJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', {
        timeoutMs: ctx.config.web.timeoutMs,
      });
      if (data?.text) {
        await ctx.reply(`💡 ${String(data.text).slice(0, 500)}`);
        return;
      }
    }
    const pick = LOCAL_FACTS[Math.floor(Math.random() * LOCAL_FACTS.length)];
    await ctx.reply(`💡 ${pick}`);
  },
};
