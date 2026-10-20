/**
 * .quote — send a random motivational/wise quote. No AI needed.
 */
const QUOTES = [
  '“The secret of getting ahead is getting started.” — Mark Twain',
  '“It always seems impossible until it is done.” — Nelson Mandela',
  '“Discipline is choosing between what you want now and what you want most.” — Abraham Lincoln',
  '“Success is not final, failure is not fatal: it is the courage to continue that counts.” — Winston Churchill',
  '“Do not watch the clock. Do what it does — keep going.” — Sam Levenson',
  '“The best way to predict the future is to create it.” — Peter Drucker',
  '“Small steps every day beat big leaps once in a while.”',
  '“Your only limit is the one you set yourself.”',
  '“Consistency is harder when no one is watching — that is where it counts.”',
  '“Fall seven times, stand up eight.” — Japanese proverb',
];

export default {
  name: 'quote',
  aliases: ['motivate', 'shayari'],
  category: 'general',
  description: 'Send a random motivational quote.',
  usage: '.quote',
  cooldown: 3,
  async execute(ctx) {
    const pick = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    await ctx.reply(pick);
  },
};
