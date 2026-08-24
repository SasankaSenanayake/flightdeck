'use client';

import { BarRow, Card, Empty, Note, StatTile } from './ui';
import { ChartFrame, MiniBars, TimeSeries } from './charts';
import { useLive } from '@/lib/useLive';
import { relativeTime, shortDate } from '@/lib/format';

type Report = {
  installed: boolean;
  quota:
    | { available: true; tier: string | null }
    | { available: false; reason: string; message: string };
  totals: {
    trajectories: number; projects: number; ideSessions: number;
    ideUptimeHours: number; firstSeen: string | null; lastSeen: string | null;
  };
  daily: { date: string; trajectories: number; ideUptimeHours: number }[];
  byProject: { name: string; trajectories: number; repo: string | null }[];
  recent: { id: string | null; title: string | null; updatedAt: number | null; project: string | null; branch: string | null }[];
  availableModels: string[];
  dataNote: string;
};

export function AntigravityPanel() {
  const { data, isLoading } = useLive<Report>('/api/antigravity', 60_000);

  if (isLoading || !data) {
    return (
      <Card title="Antigravity">
        <p className="text-sm text-ink-3">Reading local IDE state…</p>
      </Card>
    );
  }
  if (!data.installed) {
    return (
      <Card title="Antigravity">
        <Empty title="Not installed" body="No Antigravity state was found in ~/Library/Application Support." />
      </Card>
    );
  }

  const maxProject = Math.max(...data.byProject.map((p) => p.trajectories), 0);
  const recentDaily = data.daily.slice(-30);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Agent sessions" value={String(data.totals.trajectories)} hint={`across ${data.totals.projects} projects`} accent="var(--series-3)" />
        <StatTile label="IDE runs" value={String(data.totals.ideSessions)} hint={`${data.totals.ideUptimeHours.toFixed(0)}h total uptime`} />
        <StatTile label="Last activity" value={data.totals.lastSeen ? shortDate(data.totals.lastSeen) : '—'} hint={data.totals.firstSeen ? `since ${shortDate(data.totals.firstSeen)}` : undefined} />
        <StatTile
          label="Live quota"
          value={data.quota.available ? (data.quota.tier ?? 'available') : 'unavailable'}
          hint={data.quota.available ? 'from Cloud Code' : data.quota.reason.replace(/_/g, ' ')}
          tone={data.quota.available ? 'good' : 'default'}
        />
      </div>

      {!data.quota.available && (
        <Card title="Quota lookup">
          <Empty title="No live quota" body={data.quota.message} />
          <Note>
            Antigravity keeps no token or credit counts on disk, so the only route to real numbers is
            the same undocumented Cloud Code endpoint the IDE polls itself. It is disabled by default;
            everything below is recovered from local state regardless.
          </Note>
        </Card>
      )}

      <Card title="IDE uptime" subtitle="Reconstructed from Cloud Code heartbeats" right={<span className="num">{recentDaily.length} days</span>}>
        {recentDaily.length > 1 ? (
          <ChartFrame>
            <div className="min-w-[420px]">
              <TimeSeries
                data={recentDaily as unknown as Record<string, unknown>[]}
                xKey="date"
                height={170}
                area
                series={[{ key: 'ideUptimeHours', name: 'Uptime', color: 'var(--series-3)' }]}
                yFormatter={(v) => `${Math.round(v)}h`}
                valueFormatter={(v) => `${v.toFixed(1)} h`}
                labelFormatter={(l) => shortDate(String(l))}
              />
            </div>
          </ChartFrame>
        ) : (
          <Empty title="Not enough log history" />
        )}
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-ink-2">Agent sessions started</p>
          <MiniBars
            data={recentDaily as unknown as Record<string, unknown>[]}
            xKey="date"
            yKey="trajectories"
            color="var(--series-4)"
            valueFormatter={(v) => `${v} session${v === 1 ? '' : 's'}`}
            labelFormatter={(l) => shortDate(String(l))}
          />
        </div>
        <Note>{data.dataNote}</Note>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By project">
          {data.byProject.slice(0, 8).map((p) => (
            <BarRow
              key={p.name}
              label={p.name}
              value={String(p.trajectories)}
              max={maxProject}
              color="var(--series-3)"
              sublabel={p.repo ?? undefined}
            />
          ))}
        </Card>

        <Card title="Recent agent sessions">
          <ul className="space-y-2">
            {data.recent.slice(0, 8).map((t, i) => (
              <li key={t.id ?? i} className="border-b border-line/60 pb-2 last:border-0 last:pb-0">
                <p className="line-clamp-2 text-xs text-ink" title={t.title ?? ''}>
                  {t.title ?? 'Untitled session'}
                </p>
                <p className="num mt-0.5 text-[11px] text-ink-3">
                  {t.project ?? 'unknown'}
                  {t.branch ? ` · ${t.branch}` : ''} · {relativeTime(t.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {data.availableModels.length > 0 && (
        <Card title="Models available to this account">
          <div className="flex flex-wrap gap-1.5">
            {data.availableModels.map((m) => (
              <span key={m} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-2">
                {m}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
