/**
 * Date-aware price table, $ per million tokens.
 *
 * Prices are resolved per-event-date because Sonnet 5 carries introductory
 * pricing through 2026-08-31 and reverts afterwards. Charting history across
 * that boundary with a flat constant would misprice every earlier bucket.
 */

export type Price = { input: number; output: number };

type PriceWindow = { from: string; price: Price };

/** Ordered oldest-first; the last window whose `from` <= date wins. */
const TABLE: Record<string, PriceWindow[]> = {
  'claude-fable-5': [{ from: '1970-01-01', price: { input: 10, output: 50 } }],
  'claude-mythos-5': [{ from: '1970-01-01', price: { input: 10, output: 50 } }],
  'claude-opus-5': [{ from: '1970-01-01', price: { input: 5, output: 25 } }],
  'claude-opus-4-8': [{ from: '1970-01-01', price: { input: 5, output: 25 } }],
  'claude-opus-4-7': [{ from: '1970-01-01', price: { input: 5, output: 25 } }],
  'claude-opus-4-6': [{ from: '1970-01-01', price: { input: 5, output: 25 } }],
  'claude-sonnet-5': [
    { from: '1970-01-01', price: { input: 2, output: 10 } }, // introductory
    { from: '2026-09-01', price: { input: 3, output: 15 } },
  ],
  'claude-sonnet-4-6': [{ from: '1970-01-01', price: { input: 3, output: 15 } }],
  'claude-sonnet-4-5': [{ from: '1970-01-01', price: { input: 3, output: 15 } }],
  'claude-haiku-4-5': [{ from: '1970-01-01', price: { input: 1, output: 5 } }],
};

/** Unknown models fall back to Sonnet-tier rather than silently costing $0. */
const FALLBACK: Price = { input: 3, output: 15 };

/** Cache multipliers, applied against the model's input price. */
export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_5M_MULT = 1.25;
export const CACHE_WRITE_1H_MULT = 2.0;

export function priceFor(model: string | null | undefined, isoDate: string): Price {
  if (!model) return FALLBACK;
  const windows = TABLE[model] ?? TABLE[model.replace(/-\d{8}$/, '')];
  if (!windows) return FALLBACK;
  const day = isoDate.slice(0, 10);
  let chosen = windows[0].price;
  for (const w of windows) if (w.from <= day) chosen = w.price;
  return chosen;
}

export function isKnownModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return Boolean(TABLE[model] ?? TABLE[model.replace(/-\d{8}$/, '')]);
}

/** Normalized token shape shared by the local transcript and the Admin API. */
export type TokenCounts = {
  uncachedInput: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

export const ZERO_TOKENS: TokenCounts = {
  uncachedInput: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    uncachedInput: a.uncachedInput + b.uncachedInput,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

export function totalTokens(t: TokenCounts): number {
  return t.uncachedInput + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
}

/** Cost in USD for one set of token counts attributed to `model` on `isoDate`. */
export function costOf(t: TokenCounts, model: string | null | undefined, isoDate: string): number {
  const p = priceFor(model, isoDate);
  const dollars =
    t.uncachedInput * p.input +
    t.output * p.output +
    t.cacheRead * p.input * CACHE_READ_MULT +
    t.cacheWrite5m * p.input * CACHE_WRITE_5M_MULT +
    t.cacheWrite1h * p.input * CACHE_WRITE_1H_MULT;
  return dollars / 1_000_000;
}
