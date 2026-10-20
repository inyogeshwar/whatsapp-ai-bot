/**
 * .weather <city> — current weather for a city using the keyless Open-Meteo API.
 *
 * Two calls:
 *   1. geocoding-api.open-meteo.com → lat/lon + a display name
 *   2. api.open-meteo.com/v1/forecast → current conditions
 *
 * No API key, no signup. Only the city name the user typed leaves the machine.
 */
import { getJson } from '../../utils/http.js';

/** WMO weather interpretation codes → short human labels. */
const WEATHER_CODES = {
  0: '☀️ Clear sky',
  1: '🌤 Mainly clear',
  2: '⛅ Partly cloudy',
  3: '☁️ Overcast',
  45: '🌫 Fog',
  48: '🌫 Depositing rime fog',
  51: '🌦 Light drizzle',
  53: '🌦 Moderate drizzle',
  55: '🌦 Dense drizzle',
  56: '🌦 Freezing drizzle',
  57: '🌦 Freezing drizzle',
  61: '🌧 Slight rain',
  63: '🌧 Moderate rain',
  65: '🌧 Heavy rain',
  66: '🌧 Freezing rain',
  67: '🌧 Freezing rain',
  71: '🌨 Slight snow',
  73: '🌨 Moderate snow',
  75: '🌨 Heavy snow',
  77: '🌨 Snow grains',
  80: '🌦 Rain showers',
  81: '🌦 Rain showers',
  82: '⛈ Violent rain showers',
  85: '🌨 Snow showers',
  86: '🌨 Heavy snow showers',
  95: '⛈ Thunderstorm',
  96: '⛈ Thunderstorm with hail',
  99: '⛈ Thunderstorm with heavy hail',
};

export default {
  name: 'weather',
  aliases: ['mausam', 'w'],
  category: 'tools',
  description: 'Show current weather for a city.',
  usage: '.weather <city>',
  cooldown: 8,
  async execute(ctx) {
    if (!ctx.config.web.enabled) {
      await ctx.reply('Web features are disabled on this bot.');
      return;
    }

    const city = ctx.command.argText.trim().slice(0, 80);
    if (!city) {
      await ctx.reply(`Usage: ${ctx.config.prefix}weather <city>\nExample: ${ctx.config.prefix}weather Delhi`);
      return;
    }

    const timeoutMs = ctx.config.web.timeoutMs;

    const geo = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      { timeoutMs }
    );
    const place = geo?.results?.[0];
    if (!place) {
      await ctx.reply(`🔍 Could not find a place called *${city}*. Try a bigger nearby city.`);
      return;
    }

    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      timezone: 'auto',
    });
    const wx = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`, { timeoutMs });
    const current = wx?.current;
    if (!current) {
      await ctx.reply('❌ Weather service is not responding right now. Try again shortly.');
      return;
    }

    const label = WEATHER_CODES[current.weather_code] ?? '🌡 Unknown';
    const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');

    const lines = [
      `🌍 *${placeName}*`,
      `${label}`,
      `🌡 Temp: *${current.temperature_2m}°C* (feels ${current.apparent_temperature}°C)`,
      `💧 Humidity: ${current.relative_humidity_2m}%`,
      `💨 Wind: ${current.wind_speed_10m} km/h`,
    ];
    await ctx.reply(lines.join('\n'));
  },
};
