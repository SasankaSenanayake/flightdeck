'use client';

import { BarRow, Card, Legend, Note, StatTile } from './ui';
import { PlanUsageCard } from './PlanUsageCard';
import { ChartFrame, StackedBars } from './charts';
import { useLive } from '@/lib/useLive';
import { duration, pct, relativeTime, shortDate, tokens, usd } from '@/lib/format';

type Report = {
  totals: {
    uniqueRequests: number; cost: number; totalTokens: number; activeDays: number;
    sessions: number; sidechainRequests: number; avgCostPerActiveDay: number;
    cacheReadShare: number; firstSeen: string | null; lastSeen: string | null;
    tokens: { uncachedInput: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };
  };
  today: { date: string; cost: number; tokens: number; requests: number };
  burn: { last5h: { tokens: number; cost: number }; last7d: { tokens: number; cost: number } };
  daily: { date: string; cost: number; requests: number; byModel: Record<string, { cost: number; tokens: number }> }[];
  byProject: { name: string; cost: number; tokens: number; requests: number }[];
  byModel: { name: string; cost: number; tokens: number; requests: number }[];
  byEffort: { name: string; requests: number }[];
  sessions: {
    sessionId: string; project: string; branch: string | null; end: string;
    durationMs: number; requests: number; cost: number; tokens: number; models: string[];
  }[];
};

const MODEL_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

function modelLabel(id: string) {
  return id.replace(/^claude-/, '').replace(/-/g, ' ');
}

/** `showPlanUsage=false` lets the Overview tab render PlanUsageCard itself,
 * positioned above SystemLiveRow, instead of duplicating it here. */
export function ClaudeCodePanel({ showPlanUsage = true }: { showPlanUsage?: boolean } = {}) {
  const { data, error, isLoading } = useLive<Report>('/api/claude-code', 60_000);

  if (error) {
    return (
      <Card title="Claude Code">
        <p className="text-sm text-critical">Could not read transcripts: {String(error.message ?? error)}</p>
      </Card>
    );
  }
  if (isLoading || !data) {
    return (
      <Card title="Claude Code">
        <p className="text-sm text-ink-3">Reading local transcripts…</p>
      </Card>
    );
  }

  const t = data.totals;
  const modelKeys = data.byModel.slice(0, 4).map((m) => m.name);
  const chartData = data.daily.map((d) => {
    const row: Record<string, unknown> = { date: d.date };
    for (const k of modelKeys) row[k] = d.byModel[k]?.cost ?? 0;
    return row;
  });
  const maxProject = Math.max(...data.byProject.map((p) => p.cost), 0);

  return (
    <div className="space-y-4">
      {showPlanUsage && <PlanUsageCard />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Today" value={usd(data.today.cost)} hint={`${data.today.requests} requests · ${tokens(data.today.tokens)} tokens`} accent="var(--series-1)" />
        <StatTile label="Total equivalent value" value={usd(t.cost)} hint={`${t.activeDays} active days · ${usd(t.avgCostPerActiveDay)}/day`} />
        <StatTile label="Requests" value={t.uniqueRequests.toLocaleString()} hint={`${t.sessions} sessions · ${t.sidechainRequests} subagent`} />
        <StatTile label="Cache read share" value={pct(t.cacheReadShare * 100, 1)} hint={`${tokens(t.totalTokens)} tokens total`} accent="var(--series-3)" />
      </div>

      <Card
        title="Daily spend by model"
        subtitle="What this usage would have cost at API rates"
        right={t.firstSeen ? <span className="num">{shortDate(t.firstSeen)} – {shortDate(t.lastSeen ?? t.firstSeen)}</span> : null}
      >
        <div className="mb-3">
          <Legend items={modelKeys.map((k, i) => ({
            name: modelLabel(k),
            color: MODEL_COLORS[i],
            value: usd(data.byModel[i]?.cost),
          }))} />
        </div>
        <ChartFrame>
          <div className="min-w-[420px]">
            <StackedBars
              data={chartData}
              xKey="date"
              height={200}
              series={modelKeys.map((k, i) => ({ key: k, name: modelLabel(k), color: MODEL_COLORS[i] }))}
              yFormatter={(v) => usd(v, 0)}
              valueFormatter={(v) => usd(v)}
              labelFormatter={(l) => shortDate(String(l))}
            />
          </div>
        </ChartFrame>
        <Note>
          Estimated from local transcripts at current API list prices — this is what the same work would
          cost on the API, not a charge against your subscription. Deduplicated by request id; token
          counts are the ones Claude Code recorded.
        </Note>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By project" subtitle="Sessions grouped by repository root">
          <div>
            {data.byProject.slice(0, 8).map((p, i) => (
              <BarRow
                key={p.name}
                label={p.name}
                value={usd(p.cost)}
                max={maxProject}
                color={i === 0 ? 'var(--series-1)' : 'var(--series-7)'}
                sublabel={`${tokens(p.tokens)} · ${p.requests} req`}
              />
            ))}
          </div>
        </Card>

        <Card title="Trailing consumption" subtitle="Rolling windows">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Last 5 hours" value={tokens(data.burn.last5h.tokens)} hint={usd(data.burn.last5h.cost)} accent="var(--series-1)" />
            <StatTile label="Last 7 days" value={tokens(data.burn.last7d.tokens)} hint={usd(data.burn.last7d.cost)} accent="var(--series-2)" />
          </div>
          <Note>
            Raw token/cost consumption from these transcripts alone — Claude Code&rsquo;s own logs
            never see your actual plan limits, so this is not a percentage. For the real quota
            percentage, see &ldquo;Plan limits&rdquo; above, sourced from the Claude desktop app&rsquo;s
            account-synced usage cache.
          </Note>
          {data.byEffort.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium text-ink-2">Effort mix</p>
              <Legend items={data.byEffort.slice(0, 4).map((e, i) => ({
                name: e.name, color: MODEL_COLORS[i], value: `${e.requests}`,
              }))} />
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent sessions">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="pb-2 font-medium">Project</th>
                <th className="pb-2 font-medium">Branch</th>
                <th className="pb-2 text-right font-medium">Requests</th>
                <th className="pb-2 text-right font-medium">Tokens</th>
                <th className="pb-2 text-right font-medium">Duration</th>
                <th className="pb-2 text-right font-medium">Value</th>
                <th className="pb-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.slice(0, 12).map((s) => (
                <tr key={s.sessionId} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 text-ink">{s.project}</td>
                  <td className="max-w-[120px] truncate py-1.5 text-ink-3">{s.branch ?? '—'}</td>
                  <td className="num py-1.5 text-right text-ink-2">{s.requests}</td>
                  <td className="num py-1.5 text-right text-ink-2">{tokens(s.tokens)}</td>
                  <td className="num py-1.5 text-right text-ink-2">{duration(s.durationMs)}</td>
                  <td className="num py-1.5 text-right font-medium text-ink">{usd(s.cost)}</td>
                  <td className="num py-1.5 text-right text-ink-3">{relativeTime(s.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
