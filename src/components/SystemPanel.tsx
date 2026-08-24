'use client';

import { useMemo } from 'react';
import { Card, Legend, StatTile } from './ui';
import { ChartFrame, TimeSeries } from './charts';
import { SystemLiveRow } from './SystemLiveRow';
import { SystemStatTiles } from './SystemStatTiles';
import { useLive, useRolling } from '@/lib/useLive';
import { bps, bytes, clockTime, clockTimeSec, duration, pct } from '@/lib/format';

type Snapshot = {
  at: string;
  host: { model: string; cpu: string; cores: number; memTotal: number; hostname: string };
  cpu: { busy: number; cpuUser: number; cpuSys: number; load1: number; diskMBs: number; diskTps: number } | null;
  // memory/disk/battery are null until their sampler has produced a row
  memory: { total: number; used: number; wired: number; compressed: number; pressurePct: number } | null;
  network: { rxBps: number | null; txBps: number | null; rxTotal: number; txTotal: number };
  disk: { total: number; used: number; free: number; usedPct: number } | null;
  battery: {
    percent: number | null; charging: boolean; acPower: boolean;
    cycleCount: number | null; healthPct: number | null; temperatureC: number | null; timeRemaining: string | null;
  } | null;
  streamsReady: boolean;
  processes: { pid: number; cpu: number; mem: number; rss: number; name: string }[];
  uptimeSec: number;
};

type History = { series: { ts: number; cpuBusy: number | null; memPct: number | null; netRx: number | null; netTx: number | null }[] };

/** `showLiveRow` lets the Overview tab render Live+Utilization elsewhere on
 * the page (right under Plan limits) without this panel duplicating them. */
export function SystemPanel({
  showLiveRow = true,
  showStatTiles = true,
}: { showLiveRow?: boolean; showStatTiles?: boolean } = {}) {
  const { data, error } = useLive<Snapshot>('/api/system', 2000);
  const { data: hist } = useLive<History>('/api/system/history?hours=24', 60_000);

  // Network throughput keeps its own rolling window here — only the CPU/Memory
  // live chart and utilization gauges moved out to SystemLiveRow.
  const netPoint = useMemo(
    () => (data ? { ts: Date.parse(data.at), rx: data.network.rxBps, tx: data.network.txBps } : undefined),
    [data?.at], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const live = useRolling(netPoint, 150);

  if (error) {
    return (
      <Card title="System">
        <p className="text-sm text-critical">Could not read system metrics: {String(error.message ?? error)}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {showStatTiles && <SystemStatTiles />}

      {showLiveRow && <SystemLiveRow />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Network throughput" subtitle="Live, all interfaces except loopback">
          <div className="mb-3">
            <Legend
              items={[
                { name: 'Down', color: 'var(--series-3)', value: bps(data?.network.rxBps) },
                { name: 'Up', color: 'var(--series-4)', value: bps(data?.network.txBps) },
              ]}
            />
          </div>
          <ChartFrame>
            <div className="min-w-[320px]">
              <TimeSeries
                data={live as unknown as Record<string, unknown>[]}
                xKey="ts"
                height={160}
                animate={false}
                series={[
                  { key: 'rx', name: 'Down', color: 'var(--series-3)' },
                  { key: 'tx', name: 'Up', color: 'var(--series-4)' },
                ]}
                yFormatter={(v) => bytes(v, 0)}
                valueFormatter={(v) => bps(v)}
                labelFormatter={(l) => clockTimeSec(Number(l))}
              />
            </div>
          </ChartFrame>
          <p className="num mt-2 text-[11px] text-ink-3">
            Since boot: {bytes(data?.network.rxTotal)} down · {bytes(data?.network.txTotal)} up
          </p>
        </Card>

        <Card title="Top processes" subtitle="By CPU">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[300px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="pb-2 font-medium">Process</th>
                  <th className="pb-2 text-right font-medium">CPU</th>
                  <th className="pb-2 text-right font-medium">Memory</th>
                </tr>
              </thead>
              <tbody>
                {(data?.processes ?? []).slice(0, 10).map((p) => (
                  <tr key={p.pid} className="border-b border-line/60 last:border-0">
                    <td className="max-w-[220px] truncate py-1.5 text-ink" title={p.name}>
                      {p.name}
                    </td>
                    <td className="num py-1.5 text-right text-ink-2">{p.cpu.toFixed(1)}%</td>
                    <td className="num py-1.5 text-right text-ink-2">{bytes(p.rss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card
        title="Last 24 hours"
        subtitle="Sampled every 60s and persisted"
        right={hist ? <span className="num">{hist.series.length} samples</span> : null}
      >
        {hist && hist.series.length > 2 ? (
          <>
            <div className="mb-3">
              <Legend
                items={[
                  { name: 'CPU', color: 'var(--series-1)' },
                  { name: 'Memory', color: 'var(--series-2)' },
                ]}
              />
            </div>
            <ChartFrame>
              <div className="min-w-[420px]">
                <TimeSeries
                  data={hist.series as unknown as Record<string, unknown>[]}
                  xKey="ts"
                  height={180}
                  series={[
                    { key: 'cpuBusy', name: 'CPU', color: 'var(--series-1)' },
                    { key: 'memPct', name: 'Memory', color: 'var(--series-2)' },
                  ]}
                  yFormatter={(v) => `${Math.round(v)}%`}
                  valueFormatter={(v) => pct(v, 1)}
                  labelFormatter={(l) => clockTime(Number(l))}
                />
              </div>
            </ChartFrame>
          </>
        ) : (
          <p className="text-xs text-ink-3">
            History builds as the collector runs — the first points appear within a minute or two.
          </p>
        )}
        {data && (
          <p className="num mt-3 text-[11px] text-ink-3">
            {data.host.model} · {data.host.cpu} · {data.host.cores} cores · {bytes(data.host.memTotal)} · up{' '}
            {duration(data.uptimeSec * 1000)}
          </p>
        )}
      </Card>
    </div>
  );
}
