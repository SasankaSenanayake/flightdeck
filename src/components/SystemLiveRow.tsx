'use client';

import { useMemo } from 'react';
import { Card, Gauge, Legend } from './ui';
import { ChartFrame, TimeSeries } from './charts';
import { useLive, useRolling } from '@/lib/useLive';
import { bytes, clockTime, clockTimeSec, pct } from '@/lib/format';

type Snapshot = {
  at: string;
  cpu: { busy: number; cpuUser: number; cpuSys: number } | null;
  memory: { used: number; wired: number; pressurePct: number } | null;
  disk: { free: number; usedPct: number } | null;
};

/**
 * The "Live" 2s chart + "Utilization" gauges — the most glanceable pair of
 * System cards. Extracted so the Overview tab can surface them right under
 * Plan limits while the dedicated System tab keeps them in place; both mounts
 * share the same SWR cache key, so there's no duplicate polling.
 */
export function SystemLiveRow() {
  const { data } = useLive<Snapshot>('/api/system', 2000);

  const point = useMemo(
    () =>
      data
        ? {
            ts: Date.parse(data.at),
            cpu: data.cpu?.busy ?? null,
            mem: data.memory?.pressurePct ?? null,
          }
        : undefined,
    [data?.at], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const live = useRolling(point, 150);

  const cpu = data?.cpu ?? null;
  const mem = data?.memory ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card
        title="Live"
        subtitle="2-second poll"
        className="lg:col-span-2"
        right={data ? <span className="num">{clockTime(Date.parse(data.at))}</span> : null}
      >
        <div className="mb-3">
          <Legend
            items={[
              { name: 'CPU', color: 'var(--series-1)', value: cpu ? pct(cpu.busy) : '—' },
              { name: 'Memory', color: 'var(--series-2)', value: mem ? pct(mem.pressurePct) : '—' },
            ]}
          />
        </div>
        <ChartFrame>
          <div className="min-w-[320px]">
            <TimeSeries
              data={live as unknown as Record<string, unknown>[]}
              xKey="ts"
              height={180}
              animate={false}
              series={[
                { key: 'cpu', name: 'CPU', color: 'var(--series-1)' },
                { key: 'mem', name: 'Memory', color: 'var(--series-2)' },
              ]}
              yFormatter={(v) => `${Math.round(v)}%`}
              valueFormatter={(v) => pct(v, 1)}
              labelFormatter={(l) => clockTimeSec(Number(l))}
            />
          </div>
        </ChartFrame>
        {live.length < 3 && <p className="mt-2 text-[11px] text-ink-3">Collecting samples…</p>}
      </Card>

      <Card title="Utilization">
        <div className="flex items-start justify-around gap-2">
          <Gauge
            value={cpu?.busy ?? null}
            label="CPU"
            detail={cpu ? `usr ${Math.round(cpu.cpuUser)} · sys ${Math.round(cpu.cpuSys)}` : undefined}
            color="var(--series-1)"
          />
          <Gauge
            value={mem?.pressurePct ?? null}
            label="Memory"
            detail={mem ? `${bytes(mem.wired)} wired` : undefined}
            color="var(--series-2)"
          />
          <Gauge
            value={data?.disk?.usedPct ?? null}
            label="Disk"
            detail={data?.disk ? `${bytes(data.disk.free)} free` : undefined}
            color="var(--series-7)"
          />
        </div>
      </Card>
    </div>
  );
}
