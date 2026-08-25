'use client';

import { StatTile } from './ui';
import { useLive } from '@/lib/useLive';
import { bps, bytes, pct } from '@/lib/format';

type Snapshot = {
  at: string;
  host: { cores: number };
  cpu: { busy: number; load1: number } | null;
  memory: { total: number; used: number; pressurePct: number } | null;
  network: { rxBps: number | null; txBps: number | null };
  battery: {
    percent: number | null; acPower: boolean; cycleCount: number | null;
    temperatureC: number | null; timeRemaining: string | null;
  } | null;
};

type History = { series: { cpuBusy: number | null; memPct: number | null; netRx: number | null }[] };

/**
 * The Memory/CPU/Network/Battery stat-tile row. Extracted for the same reason
 * as SystemLiveRow: the Overview tab surfaces it under Plan limits, while the
 * dedicated System tab keeps it in its original spot — both mounts share the
 * same SWR cache key, so there's no duplicate polling.
 */
export function SystemStatTiles() {
  const { data } = useLive<Snapshot>('/api/system', 2000);
  // Last 2 hours at the 60s sample cadence — a short, glanceable trend, not
  // the full 24h history chart further down the page.
  const { data: hist } = useLive<History>('/api/system/history?hours=2', 60_000);
  const cpu = data?.cpu ?? null;
  const mem = data?.memory ?? null;
  const batt = data?.battery ?? null;
  const memTone = (mem?.pressurePct ?? 0) > 90 ? 'critical' : (mem?.pressurePct ?? 0) > 75 ? 'warning' : 'default';

  const series = hist?.series ?? [];
  const cpuSpark = series.map((s) => s.cpuBusy);
  const memSpark = series.map((s) => s.memPct);
  const netSpark = series.map((s) => s.netRx);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Memory used"
        value={mem ? bytes(mem.used) : '—'}
        hint={mem ? `${pct(mem.pressurePct)} of ${bytes(mem.total)}` : undefined}
        tone={memTone}
        accent="var(--series-2)"
        spark={memSpark}
      />
      <StatTile
        label="CPU busy"
        value={cpu ? pct(cpu.busy) : '—'}
        hint={cpu ? `load ${cpu.load1.toFixed(2)} · ${data?.host.cores ?? 0} cores` : 'starting sampler…'}
        accent="var(--series-1)"
        spark={cpuSpark}
      />
      <StatTile
        label="Network"
        value={data ? bps(data.network.rxBps) : '—'}
        hint={data ? `down · ${bps(data.network.txBps)} up` : undefined}
        accent="var(--series-3)"
        spark={netSpark}
      />
      <StatTile
        label="Battery"
        value={batt?.percent != null ? `${batt.percent}%` : '—'}
        hint={
          batt
            ? [
                batt.acPower ? 'AC power' : (batt.timeRemaining ?? 'on battery'),
                batt.cycleCount !== null ? `${batt.cycleCount} cycles` : null,
                batt.temperatureC !== null ? `${batt.temperatureC.toFixed(1)}°C` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        accent="var(--series-4)"
      />
    </div>
  );
}
