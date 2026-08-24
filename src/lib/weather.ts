import { cacheGet, cacheSet } from '@/lib/db';

const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a city's coordinates don't change
const WEATHER_TTL_MS = 15 * 60 * 1000;

export class WeatherNotConfigured extends Error {}

/** WMO weather codes (used by Open-Meteo) → short description + emoji. */
const WMO: Record<number, { text: string; emoji: string }> = {
  0: { text: 'Clear sky', emoji: '☀️' },
  1: { text: 'Mainly clear', emoji: '🌤️' },
  2: { text: 'Partly cloudy', emoji: '⛅' },
  3: { text: 'Overcast', emoji: '☁️' },
  45: { text: 'Fog', emoji: '🌫️' },
  48: { text: 'Depositing rime fog', emoji: '🌫️' },
  51: { text: 'Light drizzle', emoji: '🌦️' },
  53: { text: 'Drizzle', emoji: '🌦️' },
  55: { text: 'Dense drizzle', emoji: '🌦️' },
  56: { text: 'Freezing drizzle', emoji: '🌧️' },
  57: { text: 'Freezing drizzle', emoji: '🌧️' },
  61: { text: 'Light rain', emoji: '🌧️' },
  63: { text: 'Rain', emoji: '🌧️' },
  65: { text: 'Heavy rain', emoji: '🌧️' },
  66: { text: 'Freezing rain', emoji: '🌧️' },
  67: { text: 'Freezing rain', emoji: '🌧️' },
  71: { text: 'Light snow', emoji: '🌨️' },
  73: { text: 'Snow', emoji: '🌨️' },
  75: { text: 'Heavy snow', emoji: '🌨️' },
  77: { text: 'Snow grains', emoji: '🌨️' },
  80: { text: 'Rain showers', emoji: '🌦️' },
  81: { text: 'Rain showers', emoji: '🌦️' },
  82: { text: 'Violent rain showers', emoji: '⛈️' },
  85: { text: 'Snow showers', emoji: '🌨️' },
  86: { text: 'Snow showers', emoji: '🌨️' },
  95: { text: 'Thunderstorm', emoji: '⛈️' },
  96: { text: 'Thunderstorm, hail', emoji: '⛈️' },
  99: { text: 'Thunderstorm, hail', emoji: '⛈️' },
};

function describe(code: number) {
  return WMO[code] ?? { text: 'Unknown', emoji: '🌡️' };
}

type GeoResult = { lat: number; lon: number; name: string };

async function geocode(location: string): Promise<GeoResult> {
  const key = `geocode:${location.toLowerCase()}`;
  const cached = cacheGet(key, GEOCODE_TTL_MS) as GeoResult | null;
  if (cached) return cached;

  // Open-Meteo's `name` param matches a place name verbatim — it does not parse
  // "City, Country" itself. Split off a trailing country and translate common
  // names/abbreviations to an ISO 3166-1 alpha-2 code via `countryCode`, which
  // disambiguates places that share a name across countries (there are real
  // "Uxbridge"s in the UK, Massachusetts, and Ontario).
  const parts = location.split(',').map((s) => s.trim()).filter(Boolean);
  const cityQuery = parts[0] ?? location;
  const countryCode = parts.length > 1 ? countryToIso2(parts[parts.length - 1]) : null;

  const params = new URLSearchParams({ name: cityQuery, count: '1', language: 'en', format: 'json' });
  if (countryCode) params.set('countryCode', countryCode);

  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const body = (await res.json()) as { results?: { latitude: number; longitude: number; name: string; admin1?: string; country?: string }[] };
  let r = body.results?.[0];

  // The country filter can legitimately return nothing (a typo'd country, or
  // an unmapped one) — retry once without it rather than failing outright.
  if (!r && countryCode) {
    const retry = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: cityQuery, count: '1', language: 'en', format: 'json' })}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (retry.ok) r = ((await retry.json()) as { results?: typeof body.results }).results?.[0];
  }

  if (!r) throw new Error(`No location found for "${location}"`);
  const name = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
  const geo: GeoResult = { lat: r.latitude, lon: r.longitude, name };
  cacheSet(key, geo);
  return geo;
}

const COUNTRY_ISO2: Record<string, string> = {
  uk: 'GB', gb: 'GB', 'united kingdom': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
  'sri lanka': 'LK', lk: 'LK',
  canada: 'CA', ca: 'CA',
  australia: 'AU', au: 'AU',
  india: 'IN', in: 'IN',
  germany: 'DE', de: 'DE',
  france: 'FR', fr: 'FR',
  ireland: 'IE', ie: 'IE',
  'new zealand': 'NZ', nz: 'NZ',
  singapore: 'SG', sg: 'SG',
  uae: 'AE', 'united arab emirates': 'AE',
};

function countryToIso2(s: string): string | null {
  const key = s.trim().toLowerCase();
  // Check the map first: "uk" is a common informal usage but not a real ISO
  // 3166-1 code (the real one is "gb") — falling through to the bare-2-letter
  // guess below would send Open-Meteo the wrong code for exactly that input.
  if (COUNTRY_ISO2[key]) return COUNTRY_ISO2[key];
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return null;
}

export type WeatherReport = {
  configured: true;
  locationName: string;
  updatedAt: string;
  tempC: number;
  feelsLikeC: number;
  condition: string;
  emoji: string;
  isDay: boolean;
  humidity: number;
  windKph: number;
  highC: number;
  lowC: number;
};

export async function fetchWeatherReport(): Promise<WeatherReport> {
  const location = process.env.WEATHER_LOCATION?.trim();
  if (!location) throw new WeatherNotConfigured();

  const geo = await geocode(location);
  const cacheKey = `weather:${geo.lat},${geo.lon}`;
  const cached = cacheGet(cacheKey, WEATHER_TTL_MS) as WeatherReport | null;
  if (cached) return cached;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
  const body = (await res.json()) as {
    current: {
      temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number;
      wind_speed_10m: number; weather_code: number; is_day: number;
    };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
  };

  const { text, emoji } = describe(body.current.weather_code);
  const report: WeatherReport = {
    configured: true,
    locationName: geo.name,
    updatedAt: new Date().toISOString(),
    tempC: body.current.temperature_2m,
    feelsLikeC: body.current.apparent_temperature,
    condition: text,
    emoji,
    isDay: body.current.is_day === 1,
    humidity: body.current.relative_humidity_2m,
    windKph: body.current.wind_speed_10m,
    highC: body.daily.temperature_2m_max[0],
    lowC: body.daily.temperature_2m_min[0],
  };
  cacheSet(cacheKey, report);
  return report;
}
