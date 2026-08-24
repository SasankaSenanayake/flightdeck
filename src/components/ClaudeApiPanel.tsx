'use client';

import { BarRow, Card, Empty, Legend, Note, StatTile } from './ui';
import { ChartFrame, TimeSeries } from './charts';
import { useLive } from '@/lib/useLive';
import { shortDate, tokens, usd } from '@/lib/format';

type Report =
  | { configured: false; reason: 'missing_key' | 'auth_failed' | 'error'; message?: string }
  | {
      configured: true;
      days: number;
      totals: { totalTokens: number; estimatedCost: number; billedCost: number | null; webSearches: number };
      daily: { date: string; tokens: number; estimatedCost: number; billedCost: number | null }[];
      byModel: { name: string; tokens: number; estimatedCost: number }[];
      byApiKey: { name: string; tokens: number; estimatedCost: number }[];
      byWorkspace: { name: string; tokens: number; estimatedCost: number }[];
      costReportAvailable: boolean;
    };

export function ClaudeApiPanel() {
  const { data, error, isLoading } = useLive<Report>('/api/claude-api?days=30', 60_000);

  if (isLoading || !data) {
    return (
      <Card title="Claude API">
        <p className="text-sm text-ink-3">Querying the Admin API…</p>
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="Claude API">
        <p className="text-sm text-critical">Request failed: {String(error.message ?? error)}</p>
      </Card>
    );
  }

  if (!data.configured) {
    const body =
      data.reason === 'missing_key'
        ? 'Add ANTHROPIC_ADMIN_KEY to .env.local and restart. It must be an Admin key (sk-ant-admin…) created by an org owner at console.anthropic.com — a regular API key cannot read usage reports.'
        : (data.message ?? 'The Admin API could not be reached.');
    return (
      <Card title="Claude API" subtitle="Paid API usage via the Admin API">
        <Empty title={data.reason === 'missing_key' ? 'Not configured' : 'Could not load usage'} body={body} />
      </Card>
    );
  }

  const hasUsage = data.totals.totalTokens > 0;
  const maxModel = Math.max(...data.byModel.map((m) => m.estimatedCost), 0);
  const maxKey = Math.max(...data.byApiKey.map((m) => m.estimatedCost), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={data.totals.billedCost !== null ? 'Billed (30d)' : 'Estimated (30d)'}
          value={usd(data.totals.billedCost ?? data.totals.estimatedCost)}
          hint={data.totals.billedCost !== null ? `est. ${usd(data.totals.estimatedCost)} from tokens` : 'cost report unavailable'}
          accent="var(--series-2)"
        />
        <StatTile label="Tokens (30d)" value={tokens(data.totals.totalTokens)} />
        <StatTile label="Models used" value={String(data.byModel.length)} hint={data.byModel[0]?.name?.replace(/^claude-/, '') ?? '—'} />
        <StatTile label="Web searches" value={String(data.totals.webSearches)} />
      </div>

      {!hasUsage ? (
        <Card title="Claude API" subtitle="Last 30 days">
          <Empty
            title="No API usage in this window"
            body="The Admin key is working — your organization simply has no Messages API usage in the last 30 days. Usage through Claude Code on a subscription is not billed through the API and appears in the Claude Code panel instead."
          />
        </Card>
      ) : (
        <>
          <Card title="Daily API cost" subtitle="Last 30 days">
            <div className="mb-3">
              <Legend
                items={[
                  { name: data.costReportAvailable ? 'Billed' : 'Estimated', color: 'var(--series-2)', value: usd(data.totals.billedCost ?? data.totals.estimatedCost) },
                ]}
              />
            </div>
            <ChartFrame>
              <div className="min-w-[420px]">
                <TimeSeries
                  data={data.daily as unknown as Record<string, unknown>[]}
                  xKey="date"
                  height={190}
                  series={[
                    data.costReportAvailable
                      ? { key: 'billedCost', name: 'Billed', color: 'var(--series-2)' }
                      : { key: 'estimatedCost', name: 'Estimated', color: 'var(--series-2)' },
                  ]}
                  yFormatter={(v) => usd(v, 0)}
                  valueFormatter={(v) => usd(v)}
                  labelFormatter={(l) => shortDate(String(l))}
                />
              </div>
            </ChartFrame>
            <Note>
              {data.costReportAvailable
                ? 'Dollars come from the organization cost report — these are real billed amounts.'
                : 'The cost report was unavailable, so these dollars are estimated from token counts at list prices.'}
            </Note>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="By model">
              {data.byModel.slice(0, 6).map((m) => (
                <BarRow
                  key={m.name}
                  label={m.name.replace(/^claude-/, '')}
                  value={usd(m.estimatedCost)}
                  max={maxModel}
                  color="var(--series-2)"
                  sublabel={tokens(m.tokens)}
                />
              ))}
            </Card>
            <Card title="By API key">
              {data.byApiKey.slice(0, 6).map((m) => (
                <BarRow
                  key={m.name}
                  label={m.name}
                  value={usd(m.estimatedCost)}
                  max={maxKey}
                  color="var(--series-7)"
                  sublabel={tokens(m.tokens)}
                />
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
