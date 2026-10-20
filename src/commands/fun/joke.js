/**
 * .joke — send a random joke (offline list first, keyless API fallback).
 *
 * The local list makes the command instant and immune to network failures.
 */
import { getJson } from '../../utils/http.js';

const LOCAL_JOKES = [
  'Teacher: "Why are you late?" Student: "Because of the sign." Teacher: "What sign?" Student: "The one that says School Ahead, Go Slow."',
  'Why do programmers prefer dark mode? Because light attracts bugs. 🐛',
  'I told my computer I needed a break… now it won\'t stop sending me KitKat ads.',
  'Why did the math book look sad? Because it had too many problems.',
  'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"',
  'Why don\'t scientists trust atoms? Because they make up everything.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why did the developer go broke? Because he used up all his cache.',
  'My wife said "Do you ever listen to me?" I said "Yes, but only during compiler errors."',
  'There are 10 kinds of people: those who understand binary and those who don\'t.',
];

export default {
  name: 'joke',
  aliases: ['jokes', 'hasao'],
  category: 'fun',
  description: 'Send a random joke.',
  usage: '.joke',
  cooldown: 4,
  async execute(ctx) {
    // Try a fresh online joke first when web is enabled; fall back locally.
    if (ctx.config.web.enabled) {
      const data = await getJson('https://official-joke-api.appspot.com/random_joke', {
        timeoutMs: ctx.config.web.timeoutMs,
      });
      if (data?.setup && data?.punchline) {
        await ctx.reply(`😂 ${data.setup}\n\n…${data.punchline}`);
        return;
      }
    }
    const pick = LOCAL_JOKES[Math.floor(Math.random() * LOCAL_JOKES.length)];
    await ctx.reply(`😂 ${pick}`);
  },
};
