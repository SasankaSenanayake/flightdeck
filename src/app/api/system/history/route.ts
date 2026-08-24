import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Row = {
  ts: number;
  cpu_user: number | null;
  cpu_sys: number | null;
  cpu_idle: number | null;
  load1: number | null;
  mem_used: number | null;
  mem_total: number | null;
  net_rx_bps: number | null;
  net_tx_bps: number | null;
  disk_read_mbs: number | null;
  battery_pct: number | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hours = Math.min(Math.max(Number(url.searchParams.get('hours')) || 24, 1), 720);
  const maxPoints = Math.min(Math.max(Number(url.searchParams.get('points')) || 150, 10), 1000);
  const since = Date.now() - hours * 3600_000;

  try {
    const rows = getDb()
      .prepare(
        `SELECT ts, cpu_user, cpu_sys, cpu_idle, load1, mem_used, mem_total,
                net_rx_bps, net_tx_bps, disk_read_mbs, battery_pct
         FROM system_samples WHERE ts >= ? ORDER BY ts ASC`,
      )
      .all(since) as Row[];

    // Downsample by striding so the payload stays small on long ranges.
    const stride = Math.max(1, Math.ceil(rows.length / maxPoints));
    const lastIdx = rows.length - 1;
    // Anchor the last row so the chart's right edge always matches the
    // latest live snapshot shown elsewhere on the page.
    const series = rows
      .filter((_, i) => i % stride === 0 || i === lastIdx)
      .map((r) => ({
        ts: r.ts,
        cpuBusy: r.cpu_idle === null ? null : Math.max(0, 100 - r.cpu_idle),
        load1: r.load1,
        memPct: r.mem_used && r.mem_total ? (r.mem_used / r.mem_total) * 100 : null,
        memUsed: r.mem_used,
        netRx: r.net_rx_bps,
        netTx: r.net_tx_bps,
        diskMBs: r.disk_read_mbs,
        battery: r.battery_pct,
      }));

    return NextResponse.json({ hours, count: rows.length, stride, series });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to read history' },
      { status: 500 },
    );
  }
}
