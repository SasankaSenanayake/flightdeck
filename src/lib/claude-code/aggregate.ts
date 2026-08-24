import {
  addTokens,
  costOf,
  totalTokens,
  ZERO_TOKENS,
  type TokenCounts,
} from '@/lib/pricing';
import { loadUsageRecords, type UsageRecord } from './parser';

export type DayBucket = {
  date: string;
  cost: number;
  tokens: TokenCounts;
  requests: number;
  byModel: Record<string, { cost: number; tokens: number }>;
};

export type Breakdown = { name: string; cost: number; tokens: number; requests: number };

export type SessionSummary = {
  sessionId: string;
  project: string;
  branch: string | null;
  start: string;
  end: string;
  durationMs: number;
  requests: number;
  cost: number;
  tokens: number;
  models: string[];
};

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function emptyBreakdown(name: string): Breakdown {
  return { name, cost: 0, tokens: 0, requests: 0 };
}

export function buildClaudeCodeReport(now = Date.now()) {
  const records = loadUsageRecords();

  const days = new Map<string, DayBucket>();
  const projects = new Map<string, Breakdown>();
  const models = new Map<string, Breakdown>();
  const efforts = new Map<string, number>();
  const sessions = new Map<string, SessionSummary>();

  let totalCost = 0;
  let tokens: TokenCounts = ZERO_TOKENS;
  let sidechainRequests = 0;
  let window5h = 0;
  let window5hCost = 0;
  let window7d = 0;
  let window7dCost = 0;

  for (const r of records) {
    const date = r.ts.slice(0, 10);
    if (!date) continue;
    const cost = costOf(r.tokens, r.model, date);
    const tok = totalTokens(r.tokens);
    const modelKey = r.model ?? 'unknown';

    totalCost += cost;
    tokens = addTokens(tokens, r.tokens);
    if (r.sidechain) sidechainRequests += 1;

    const age = now - Date.parse(r.ts);
    if (age >= 0 && age <= FIVE_HOURS_MS) {
      window5h += tok;
      window5hCost += cost;
    }
    if (age >= 0 && age <= WEEK_MS) {
      window7d += tok;
      window7dCost += cost;
    }

    let day = days.get(date);
    if (!day) {
      day = { date, cost: 0, tokens: ZERO_TOKENS, requests: 0, byModel: {} };
      days.set(date, day);
    }
    day.cost += cost;
    day.tokens = addTokens(day.tokens, r.tokens);
    day.requests += 1;
    const dm = (day.byModel[modelKey] ??= { cost: 0, tokens: 0 });
    dm.cost += cost;
    dm.tokens += tok;

    for (const [map, key] of [
      [projects, r.project],
      [models, modelKey],
    ] as const) {
      let b = map.get(key);
      if (!b) {
        b = emptyBreakdown(key);
        map.set(key, b);
      }
      b.cost += cost;
      b.tokens += tok;
      b.requests += 1;
    }

    if (r.effort) efforts.set(r.effort, (efforts.get(r.effort) ?? 0) + 1);

    if (r.sessionId) {
      let s = sessions.get(r.sessionId);
      if (!s) {
        s = {
          sessionId: r.sessionId,
          project: r.project,
          branch: r.branch,
          start: r.ts,
          end: r.ts,
          durationMs: 0,
          requests: 0,
          cost: 0,
          tokens: 0,
          models: [],
        };
        sessions.set(r.sessionId, s);
      }
      if (r.ts < s.start) s.start = r.ts;
      if (r.ts > s.end) s.end = r.ts;
      s.requests += 1;
      s.cost += cost;
      s.tokens += tok;
      if (r.model && !s.models.includes(r.model)) s.models.push(r.model);
    }
  }

  for (const s of sessions.values()) {
    s.durationMs = Math.max(0, Date.parse(s.end) - Date.parse(s.start));
  }

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const activeDays = daily.length;
  const today = new Date(now).toISOString().slice(0, 10);
  const todayBucket = days.get(today);

  const cacheReadShare =
    totalTokens(tokens) > 0 ? tokens.cacheRead / totalTokens(tokens) : 0;

  return {
    generatedAt: new Date(now).toISOString(),
    totals: {
      uniqueRequests: records.length,
      cost: totalCost,
      tokens,
      totalTokens: totalTokens(tokens),
      activeDays,
      sessions: sessions.size,
      sidechainRequests,
      avgCostPerActiveDay: activeDays ? totalCost / activeDays : 0,
      cacheReadShare,
      firstSeen: daily[0]?.date ?? null,
      lastSeen: daily[daily.length - 1]?.date ?? null,
    },
    today: {
      date: today,
      cost: todayBucket?.cost ?? 0,
      tokens: todayBucket ? totalTokens(todayBucket.tokens) : 0,
      requests: todayBucket?.requests ?? 0,
    },
    /**
     * Burn indicators, NOT plan quota. Real subscription limits are enforced
     * server-side and are not exposed to any local client, so these are
     * consumption in the trailing window and nothing more.
     */
    burn: {
      last5h: { tokens: window5h, cost: window5hCost },
      last7d: { tokens: window7d, cost: window7dCost },
    },
    daily,
    byProject: [...projects.values()].sort((a, b) => b.cost - a.cost),
    byModel: [...models.values()].sort((a, b) => b.cost - a.cost),
    byEffort: [...efforts.entries()]
      .map(([name, requests]) => ({ name, requests }))
      .sort((a, b) => b.requests - a.requests),
    sessions: [...sessions.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, 40),
  };
}
