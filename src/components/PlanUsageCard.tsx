'use client';

import { Card, Gauge, Note } from './ui';
import { ChartFrame, TimeSeries } from './charts';
import { useLive } from '@/lib/useLive';
import { relativeTime, shortDate } from '@/lib/format';

type Report =
  | { available: false }
  | {
      available: true;
      updatedAt: string;
      session: { pct: number; sampledAt: string };
      weekly: { pct: number; sampledAt: string };
      history: { t: number; session: number; weekly: number }[];
    };

function gaugeColor(pct: number) {
  if (pct >= 90) return 'var(--critical)';
  if (pct >= 70) return 'var(--warning)';
  return 'var(--series-1)';
}

export function PlanUsageCard() {
  const { data, isLoading } = useLive<Report>('/api/plan-usage?days=14', 60_000);

  if (isLoading || !data) {
    return (
      <Card title="Plan limits" subtitle="Pro / Max account usage">
        <p className="text-sm text-ink-3">Reading the Claude desktop app&rsquo;s usage cache…</p>
      </Card>
    );
  }

  if (!data.available) {
    return (
      <Card title="Plan limits" subtitle="Pro / Max account usage">
        <p className="text-sm text-ink-2">
          No usage cache found. Open the Claude desktop app at least once — it records these
          percentages itself, roughly every 15 minutes while running.
        </p>
      </Card>
    );
  }

  const staleMins = (Date.now() - Date.parse(data.updatedAt)) / 60_000;
  // Normal cadence is ~15 min while the desktop app is open and active, so
  // anything past 20 is a real signal the app has gone idle or was closed —
  // not a dashboard polling problem, since this API reads the file fresh
  // on every request.
  const staleTone = staleMins > 120 ? 'critical' : staleMins > 20 ? 'warning' : 'default';

  return (
    <Card
      title="Plan limits"
      subtitle="Real account quota, from the Claude desktop app"
      right={
        <span
          className="num"
          style={staleTone !== 'default' ? { color: `var(--${staleTone})` } : undefined}
        >
          updated {relativeTime(data.updatedAt)}
        </span>
      }
    >
      {staleTone !== 'default' && (
        <p className="mb-3 text-xs" style={{ color: `var(--${staleTone})` }}>
          Stale — the Claude desktop app hasn&rsquo;t written a new sample in over{' '}
          {staleTone === 'critical' ? '2 hours' : '20 minutes'}. It likely went idle or was closed;
          these numbers stop moving until it&rsquo;s active again.
        </p>
      )}
      <div className="flex items-center justify-center gap-8 py-2 sm:justify-start">
        <Gauge value={data.session.pct} label="Session" detail="rolling ~5h window" color={gaugeColor(data.session.pct)} />
        <Gauge value={data.weekly.pct} label="Weekly · all models" detail="resets Sunday" color={gaugeColor(data.weekly.pct)} />
      </div>

      {data.history.length > 3 && (
        <div className="mt-2">
          <ChartFrame>
            <div className="min-w-[420px]">
              <TimeSeries
                data={data.history as unknown as Record<string, unknown>[]}
                xKey="t"
                height={170}
                area={false}
                series={[
                  { key: 'session', name: 'Session', color: 'var(--series-1)' },
                  { key: 'weekly', name: 'Weekly', color: 'var(--series-7)' },
                ]}
                yFormatter={(v) => `${v}%`}
                valueFormatter={(v) => `${v}%`}
                labelFormatter={(l) => shortDate(new Date(Number(l)).toISOString())}
              />
            </div>
          </ChartFrame>
        </div>
      )}

      <Note>
        These percentages come from the Claude desktop app&rsquo;s own local cache of your account
        quota — the same numbers behind Settings → Usage — not from Claude Code&rsquo;s transcripts.
        The session window is a rolling ~5 hours, so an exact countdown isn&rsquo;t reconstructable
        from samples alone; the weekly window was observed resetting on Sundays. Requires the
        desktop app to have run at some point — it stops updating while closed.
      </Note>
    </Card>
  );
}
