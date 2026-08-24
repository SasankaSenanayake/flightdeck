import { getDb } from '@/lib/db';
import { hostInfo, snapshot } from './metrics';
import { startStreams } from './streams';

const SAMPLE_INTERVAL_MS = 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const g = globalThis as unknown as { __collector?: NodeJS.Timeout };

async function sample() {
  try {
    const s = await snapshot();
    // Nothing worth recording until the streams have produced a live row.
    if (!s.memory) return;
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO system_samples
         (ts, cpu_user, cpu_sys, cpu_idle, load1, mem_used, mem_total, mem_wired,
          mem_compressed, net_rx_bps, net_tx_bps, disk_read_mbs, disk_write_mbs,
          disk_used, disk_total, battery_pct, battery_temp_c)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        Date.now(),
        s.cpu?.cpuUser ?? null,
        s.cpu?.cpuSys ?? null,
        s.cpu?.cpuIdle ?? null,
        s.cpu?.load1 ?? null,
        s.memory.used,
        s.memory.total,
        s.memory.wired,
        s.memory.compressed,
        s.network.rxBps,
        s.network.txBps,
        s.cpu?.diskMBs ?? null,
        null,
        s.disk?.used ?? null,
        s.disk?.total ?? null,
        s.battery?.percent ?? null,
        s.battery?.temperatureC ?? null,
      );
    getDb().prepare('DELETE FROM system_samples WHERE ts < ?').run(Date.now() - RETENTION_MS);
  } catch {
    // A failed sample must never take the server down.
  }
}

export function startCollector() {
  if (g.__collector) return;
  startStreams();
  void hostInfo();
  g.__collector = setInterval(sample, SAMPLE_INTERVAL_MS);
  g.__collector.unref?.();
  setTimeout(() => void sample(), 3000).unref?.();
}
