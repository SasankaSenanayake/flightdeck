import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { cpuStream, memStream, netStream, startStreams, type CpuSample } from './streams';

const run = promisify(execFile);

/**
 * Spawning a process costs ~200ms here regardless of the command, so anything
 * on the 2s path must come from a stream (see streams.ts) or a cache. Only
 * slow-moving values are allowed to spawn, and each is cached well past the
 * poll interval.
 */
async function sh(cmd: string, args: string[], timeout = 4000): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

/** Cache a spawning call for `ttl` ms; never let two run concurrently. */
function cached<T>(ttl: number, fn: () => Promise<T>): () => Promise<T | null> {
  let value: T | null = null;
  let at = 0;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (value !== null && Date.now() - at < ttl) return value;
    if (!inflight) {
      inflight = fn().finally(() => {
        inflight = null;
      });
    }
    try {
      value = await inflight;
      at = Date.now();
      return value;
    } catch {
      return value; // serve the stale value rather than nothing
    }
  };
}

// ---------------------------------------------------------------- static host

export type HostInfo = {
  model: string;
  cpu: string;
  cores: number;
  memTotal: number;
  pageSize: number;
  hostname: string;
};

let hostCache: HostInfo | null = null;

export async function hostInfo(): Promise<HostInfo> {
  if (hostCache) return hostCache;
  const out = await sh('sysctl', [
    '-n', 'hw.model', 'machdep.cpu.brand_string', 'hw.memsize', 'hw.ncpu', 'hw.pagesize',
  ]);
  const [model, cpu, mem, ncpu, page] = out.trim().split('\n');
  hostCache = {
    model: model || 'unknown',
    cpu: cpu || 'unknown',
    cores: Number(ncpu) || os.cpus().length,
    memTotal: Number(mem) || os.totalmem(),
    pageSize: Number(page) || 4096,
    hostname: os.hostname(),
  };
  return hostCache;
}

// --------------------------------------------------------------------- memory

export type MemoryInfo = {
  total: number;
  used: number;
  free: number;
  wired: number;
  compressed: number;
  cached: number;
  pressurePct: number;
} | null;

export function memory(total: number): MemoryInfo {
  const m = memStream.get();
  if (!m) return null;
  // Match Activity Monitor's notion of "used": everything not free and not
  // reclaimable file cache.
  const used = Math.max(0, total - m.freeBytes - m.fileBackedBytes);
  return {
    total,
    used,
    free: m.freeBytes,
    wired: m.wiredBytes,
    compressed: m.compressedBytes,
    cached: m.fileBackedBytes,
    pressurePct: total ? (used / total) * 100 : 0,
  };
}

// ----------------------------------------------------------------------- disk

export type DiskInfo = { total: number; used: number; free: number; usedPct: number };

const diskCached = cached<DiskInfo>(60_000, async () => {
  const out = await sh('df', ['-k', '/System/Volumes/Data']);
  const line = out.split('\n')[1];
  if (!line) throw new Error('no df output');
  const t = line.trim().split(/\s+/);
  const total = (Number(t[1]) || 0) * 1024;
  const used = (Number(t[2]) || 0) * 1024;
  const free = (Number(t[3]) || 0) * 1024;
  // Match how macOS reports capacity: used / (used + available). Total includes
  // space reserved for the OS that df never offers you.
  const usable = used + free;
  return { total, used, free, usedPct: usable ? (used / usable) * 100 : 0 };
});

// -------------------------------------------------------------------- battery

export type BatteryInfo = {
  percent: number | null;
  charging: boolean;
  acPower: boolean;
  cycleCount: number | null;
  healthPct: number | null;
  temperatureC: number | null;
  timeRemaining: string | null;
};

const batteryCached = cached<BatteryInfo>(30_000, async () => {
  const [pm, io] = await Promise.all([
    sh('pmset', ['-g', 'batt']),
    sh('ioreg', ['-r', '-c', 'AppleSmartBattery', '-d', '1']),
  ]);
  const pct = pm.match(/(\d+)%/);
  const remain = pm.match(/(\d+:\d\d)\s+remaining/);
  const num = (key: string) => {
    const m = io.match(new RegExp(`"${key}"\\s*=\\s*(-?\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const temp = num('Temperature');
  return {
    percent: pct ? Number(pct[1]) : null,
    charging: /\bcharging\b/.test(pm) && !/not charging/.test(pm),
    acPower: /AC Power/.test(pm),
    cycleCount: num('CycleCount'),
    healthPct: num('MaxCapacity'),
    temperatureC: temp !== null ? temp / 100 : null,
    timeRemaining: remain ? remain[1] : null,
  };
});

// ------------------------------------------------------------------ processes

export type ProcInfo = { pid: number; cpu: number; mem: number; rss: number; name: string };

const processesCached = cached<ProcInfo[]>(5000, async () => {
  const out = await sh('ps', ['-Ao', 'pid,pcpu,pmem,rss,comm', '-r']);
  const rows: ProcInfo[] = [];
  for (const line of out.split('\n').slice(1)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 5) continue;
    const full = t.slice(4).join(' ');
    // Prefer the .app bundle name over the helper binary path.
    const app = full.match(/\/([^/]+)\.app\//);
    rows.push({
      pid: Number(t[0]),
      cpu: Number(t[1]),
      mem: Number(t[2]),
      rss: (Number(t[3]) || 0) * 1024,
      name: app ? app[1] : full.split('/').pop() || full,
    });
    if (rows.length >= 12) break;
  }
  return rows;
});

// -------------------------------------------------------------------- snapshot

export type SystemSnapshot = {
  at: string;
  host: HostInfo;
  cpu: (CpuSample & { busy: number }) | null;
  memory: MemoryInfo;
  network: { rxBps: number | null; txBps: number | null };
  disk: DiskInfo | null;
  battery: BatteryInfo | null;
  processes: ProcInfo[];
  uptimeSec: number;
  /** False until every stream has produced its first live row. */
  streamsReady: boolean;
};

export async function snapshot(): Promise<SystemSnapshot> {
  startStreams();
  const host = await hostInfo();
  const io = cpuStream.get();
  const net = netStream.get();
  const mem = memory(host.memTotal);
  const [dsk, batt, procs] = await Promise.all([diskCached(), batteryCached(), processesCached()]);

  return {
    at: new Date().toISOString(),
    host,
    cpu: io ? { ...io, busy: Math.max(0, 100 - io.cpuIdle) } : null,
    memory: mem,
    network: { rxBps: net?.rxBps ?? null, txBps: net?.txBps ?? null },
    disk: dsk,
    battery: batt,
    processes: procs ?? [],
    uptimeSec: os.uptime(),
    streamsReady: Boolean(io && net && mem),
  };
}
