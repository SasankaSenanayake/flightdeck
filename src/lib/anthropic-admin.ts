import { cacheGet, cacheSet } from '@/lib/db';
import { addTokens, costOf, totalTokens, ZERO_TOKENS, type TokenCounts } from '@/lib/pricing';

const BASE = 'https://api.anthropic.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

export class AdminKeyMissing extends Error {}
export class AdminAuthFailed extends Error {}

function key(): string {
  const k = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!k) throw new AdminKeyMissing('ANTHROPIC_ADMIN_KEY is not set');
  return k;
}

async function get(path: string, params: URLSearchParams): Promise<Record<string, unknown>> {
  const url = `${BASE}${path}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'x-api-key': key(),
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new AdminAuthFailed(
      'Admin API rejected the key (401/403). It must be an Admin key (sk-ant-admin…), not a regular API key.',
    );
  }
  if (!res.ok) {
    throw new Error(`Admin API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Follow `next_page` to completion.
 *
 * With bucket_width=1d the API caps a page at 31 buckets, so any range longer
 * than a month silently truncates without this.
 */
async function paginate(
  path: string,
  params: URLSearchParams,
  maxPages = 12,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let page: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const p = new URLSearchParams(params);
    if (page) p.set('page', page);
    const body = await get(path, p);
    out.push(...((body.data as Record<string, unknown>[]) ?? []));
    if (!body.has_more) break;
    page = (body.next_page as string) ?? null;
    if (!page) break;
  }
  return out;
}

type UsageResult = {
  model: string | null;
  api_key_id: string | null;
  workspace_id: string | null;
  service_tier: string | null;
  uncached_input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  server_tool_use?: { web_search_requests?: number };
};

type Bucket = { starting_at: string; ending_at: string; results: UsageResult[] };

/** Admin API result → the same token shape the local transcript parser emits. */
function normalize(r: UsageResult): TokenCounts {
  return {
    uncachedInput: r.uncached_input_tokens ?? 0,
    output: r.output_tokens ?? 0,
    cacheRead: r.cache_read_input_tokens ?? 0,
    cacheWrite5m: r.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    cacheWrite1h: r.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}

export type AdminReport = {
  configured: true;
  days: number;
  generatedAt: string;
  totals: {
    tokens: TokenCounts;
    totalTokens: number;
    estimatedCost: number;
    billedCost: number | null;
    webSearches: number;
  };
  daily: { date: string; tokens: number; estimatedCost: number; billedCost: number | null }[];
  byModel: { name: string; tokens: number; estimatedCost: number }[];
  byApiKey: { name: string; tokens: number; estimatedCost: number }[];
  byWorkspace: { name: string; tokens: number; estimatedCost: number }[];
  costReportAvailable: boolean;
};

export async function fetchAdminReport(days = 30): Promise<AdminReport> {
  const cacheKey = `admin:${days}`;
  const cached = cacheGet(cacheKey, CACHE_TTL_MS) as AdminReport | null;
  if (cached) return cached;

  const startingAt = new Date(Date.now() - days * 86_400_000).toISOString();

  const usageParams = new URLSearchParams({ starting_at: startingAt, bucket_width: '1d', limit: '31' });
  for (const g of ['model', 'api_key_id', 'workspace_id']) usageParams.append('group_by[]', g);

  const buckets = (await paginate('/v1/organizations/usage_report/messages', usageParams)) as unknown as Bucket[];

  // Billed dollars are authoritative; the token report only gives us tokens.
  let costByDay = new Map<string, number>();
  let costReportAvailable = false;
  try {
    const costParams = new URLSearchParams({ starting_at: startingAt, bucket_width: '1d', limit: '31' });
    const costBuckets = await paginate('/v1/organizations/cost_report', costParams);
    for (const b of costBuckets as unknown as { starting_at: string; results: { amount?: string | number }[] }[]) {
      const date = b.starting_at.slice(0, 10);
      let sum = 0;
      for (const r of b.results ?? []) sum += Number(r.amount ?? 0);
      costByDay.set(date, (costByDay.get(date) ?? 0) + sum);
    }
    costReportAvailable = true;
  } catch {
    costByDay = new Map();
  }

  let tokens = ZERO_TOKENS;
  let estimatedCost = 0;
  let webSearches = 0;
  const daily: AdminReport['daily'] = [];
  const models = new Map<string, { tokens: number; estimatedCost: number }>();
  const keys = new Map<string, { tokens: number; estimatedCost: number }>();
  const spaces = new Map<string, { tokens: number; estimatedCost: number }>();

  for (const b of buckets) {
    const date = b.starting_at.slice(0, 10);
    let dayTokens = 0;
    let dayCost = 0;
    for (const r of b.results ?? []) {
      const t = normalize(r);
      const c = costOf(t, r.model, date);
      const n = totalTokens(t);
      tokens = addTokens(tokens, t);
      estimatedCost += c;
      dayTokens += n;
      dayCost += c;
      webSearches += r.server_tool_use?.web_search_requests ?? 0;

      for (const [map, name] of [
        [models, r.model ?? 'unknown'],
        [keys, r.api_key_id ?? 'console/oauth'],
        [spaces, r.workspace_id ?? 'default'],
      ] as const) {
        const e = map.get(name) ?? { tokens: 0, estimatedCost: 0 };
        e.tokens += n;
        e.estimatedCost += c;
        map.set(name, e);
      }
    }
    daily.push({
      date,
      tokens: dayTokens,
      estimatedCost: dayCost,
      billedCost: costByDay.has(date) ? costByDay.get(date)! : null,
    });
  }

  const rank = (m: Map<string, { tokens: number; estimatedCost: number }>) =>
    [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.estimatedCost - a.estimatedCost);

  const billedTotal = costReportAvailable
    ? [...costByDay.values()].reduce((a, b) => a + b, 0)
    : null;

  const report: AdminReport = {
    configured: true,
    days,
    generatedAt: new Date().toISOString(),
    totals: {
      tokens,
      totalTokens: totalTokens(tokens),
      estimatedCost,
      billedCost: billedTotal,
      webSearches,
    },
    daily,
    byModel: rank(models),
    byApiKey: rank(keys),
    byWorkspace: rank(spaces),
    costReportAvailable,
  };

  cacheSet(cacheKey, report);
  return report;
}
