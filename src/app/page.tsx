'use client';

import { useState } from 'react';
import { AntigravityPanel } from '@/components/AntigravityPanel';
import { ClaudeApiPanel } from '@/components/ClaudeApiPanel';
import { ClaudeCodePanel } from '@/components/ClaudeCodePanel';
import { NowCard } from '@/components/NowCard';
import { WeatherCard } from '@/components/WeatherCard';
import { PlanUsageCard } from '@/components/PlanUsageCard';
import { SystemLiveRow } from '@/components/SystemLiveRow';
import { SystemPanel } from '@/components/SystemPanel';
import { SystemStatTiles } from '@/components/SystemStatTiles';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useLive } from '@/lib/useLive';
import { bytes, pct, usd } from '@/lib/format';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'claude-code', label: 'Claude Code' },
  { key: 'claude-api', label: 'Claude API' },
  { key: 'system', label: 'System' },
  { key: 'antigravity', label: 'Antigravity' },
] as const;

type Tab = (typeof TABS)[number]['key'];

function HeadlineRow() {
  const { data: cc } = useLive<{ today: { cost: number }; totals: { cost: number } }>('/api/claude-code', 60_000);
  const { data: sys } = useLive<{
    // null until the sampling streams produce their first row
    memory: { pressurePct: number; used: number } | null;
    cpu: { busy: number } | null;
  }>('/api/system', 2000);
  const { data: api } = useLive<{ configured: boolean; totals?: { billedCost: number | null; estimatedCost: number } }>(
    '/api/claude-api?days=30',
    60_000,
  );
  const { data: plan } = useLive<
    | { available: false }
    | { available: true; session: { pct: number }; weekly: { pct: number } }
  >('/api/plan-usage', 60_000);

  const items = [
    {
      label: 'Session used',
      value: plan?.available ? pct(plan.session.pct) : '—',
      sub: plan?.available ? `${pct(plan.weekly.pct)} weekly` : undefined,
      color: plan?.available && plan.session.pct >= 90 ? 'var(--critical)' : plan?.available && plan.session.pct >= 70 ? 'var(--warning)' : 'var(--series-1)',
    },
    { label: 'Claude Code today', value: usd(cc?.today.cost ?? null), color: 'var(--series-2)' },
    {
      label: 'API this month',
      value: api?.configured ? usd(api.totals?.billedCost ?? api.totals?.estimatedCost ?? 0) : '—',
      color: 'var(--series-3)',
    },
    { label: 'CPU', value: sys?.cpu ? pct(sys.cpu.busy) : '—', color: 'var(--series-1)' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-line bg-surface-1 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: i.color }} />
            <span className="truncate text-[11px] text-ink-3">{i.label}</span>
          </div>
          <div className="num mt-1 text-lg font-semibold text-ink">{i.value}</div>
          {i.sub && <div className="num text-[11px] text-ink-3">{i.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Flightdeck</h1>
          <p className="mt-0.5 text-xs text-ink-3">Claude usage, machine health, and Antigravity activity</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="mb-6">
        <HeadlineRow />
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`shrink-0 cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-s1 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 ${
              tab === t.key
                ? 'border-s1 text-ink'
                : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-2">Today</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <NowCard />
              <WeatherCard />
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-2">Claude Code</h2>
            <div className="space-y-4">
              <PlanUsageCard />
              <SystemStatTiles />
              <SystemLiveRow />
              <ClaudeCodePanel showPlanUsage={false} />
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-2">System</h2>
            <SystemPanel showLiveRow={false} showStatTiles={false} />
          </section>
        </div>
      )}
      {tab === 'claude-code' && <ClaudeCodePanel />}
      {tab === 'claude-api' && <ClaudeApiPanel />}
      {tab === 'system' && <SystemPanel />}
      {tab === 'antigravity' && <AntigravityPanel />}
    </main>
  );
}
