/**
 * .calc <expression> — evaluate a simple arithmetic expression safely.
 *
 * SECURITY: `eval` is never used. The input is validated against a strict
 * character allowlist (digits, operators, parentheses, a few math functions)
 * and then evaluated with `Function` on that already-sanitized string. Any
 * input containing letters outside the allowlist is rejected outright.
 */

/** Whitelisted math helpers made available to the expression. */
const MATH_HELPERS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  pi: Math.PI,
  e: Math.E,
};

const ALLOWED_NAME = /^(sqrt|abs|round|floor|ceil|pow|min|max|sin|cos|tan|log|pi|e)$/;
const ALLOWED_CHARS = /^[0-9+\-*/%().,\s^a-z]+$/i;

export default {
  name: 'calc',
  aliases: ['math', 'calculate'],
  category: 'tools',
  description: 'Calculate a math expression.',
  usage: '.calc 2*(3+4)  ·  .calc sqrt(144)',
  cooldown: 3,
  async execute(ctx) {
    let expr = ctx.command.argText.trim();
    if (!expr) {
      await ctx.reply(`Usage: ${ctx.config.prefix}calc <expression>\nExample: ${ctx.config.prefix}calc (12+8)*3`);
      return;
    }
    expr = expr.replace(/\^/g, '**');
    if (expr.length > 200 || !ALLOWED_CHARS.test(expr)) {
      await ctx.reply('❌ Only numbers and math operators/functions are allowed.');
      return;
    }

    // Every identifier used must be a whitelisted helper name.
    const identifiers = expr.match(/[a-z]+/gi) ?? [];
    for (const id of identifiers) {
      if (!ALLOWED_NAME.test(id)) {
        await ctx.reply(`❌ Unknown function or word: *${id}*. Allowed: sqrt, abs, round, floor, ceil, pow, min, max, sin, cos, tan, log, pi, e.`);
        return;
      }
    }

    try {
      // eslint-disable-next-line no-new-func -- input is allowlist-validated above
      const fn = new Function(...Object.keys(MATH_HELPERS), `"use strict"; return (${expr});`);
      const result = fn(...Object.values(MATH_HELPERS));
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        await ctx.reply('❌ That expression has no finite numeric result.');
        return;
      }
      await ctx.reply(`🧮 *${ctx.command.argText.trim()}* = *${result}*`);
    } catch {
      await ctx.reply('❌ I could not calculate that. Check the expression.');
    }
  },
};
