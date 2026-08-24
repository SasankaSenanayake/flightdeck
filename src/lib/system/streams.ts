import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Long-lived sampling subprocesses.
 *
 * Creating a process costs ~200ms on this machine — the commands themselves are
 * effectively free, so spawn overhead completely dominates a 2s poll (four
 * spawns measured at ~690ms, and batching them into one `sh -c` saves nothing
 * because the cost is per process created, not per Node call).
 *
 * `iostat`, `vm_stat` and `netstat` all accept an interval argument and stream a
 * row per second off kernel counters at ~0% CPU. Starting each once and reading
 * the newest row takes the hot path to zero spawns and sub-millisecond reads.
 */
abstract class StreamSampler<T> {
  private proc: ChildProcess | null = null;
  private buf = '';
  private restartDelay = 1000;
  private stopped = false;
  protected latest: T | null = null;
  protected rowIndex = 0;

  protected abstract command(): [string, string[]];
  /** Return the parsed sample, or null for headers and rows to ignore. */
  protected abstract parseRow(line: string): T | null;
  /** Sample is considered stale after this long without an update. */
  protected staleAfterMs = 15_000;
  protected updatedAt = 0;

  start(): void {
    if (this.proc || this.stopped) return;
    const [cmd, args] = this.command();
    let p: ChildProcess;
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      this.scheduleRestart();
      return;
    }
    this.proc = p;
    p.stdout?.setEncoding('utf8');
    p.stdout?.on('data', (chunk: string) => this.ingest(chunk));
    const down = () => {
      this.proc = null;
      this.rowIndex = 0;
      this.buf = '';
      this.scheduleRestart();
    };
    p.on('exit', down);
    p.on('error', down);
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }

  private scheduleRestart() {
    if (this.stopped) return;
    const delay = this.restartDelay;
    this.restartDelay = Math.min(delay * 2, 60_000);
    setTimeout(() => this.start(), delay).unref?.();
  }

  private ingest(chunk: string) {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      let parsed: T | null = null;
      try {
        parsed = this.parseRow(line);
      } catch {
        parsed = null;
      }
      if (parsed !== null) {
        this.latest = parsed;
        this.updatedAt = Date.now();
        this.restartDelay = 1000; // output proves the process is healthy
      }
    }
  }

  get(): T | null {
    this.start();
    if (!this.latest) return null;
    if (Date.now() - this.updatedAt > this.staleAfterMs) return null;
    return this.latest;
  }
}

/** Rows of plain numbers; headers are anything that isn't. */
function numericRow(line: string): number[] | null {
  const t = line.trim().split(/\s+/);
  if (t.length < 3) return null;
  if (!t.every((x) => /^-?\d+(\.\d+)?$/.test(x))) return null;
  return t.map(Number);
}

// ------------------------------------------------------------------ iostat

export type CpuSample = {
  cpuUser: number;
  cpuSys: number;
  cpuIdle: number;
  load1: number;
  load5: number;
  load15: number;
  /** Combined disk throughput; iostat does not split read from write. */
  diskMBs: number;
  diskTps: number;
};

class IostatSampler extends StreamSampler<CpuSample> {
  protected command(): [string, string[]] {
    return ['iostat', ['-w', '1']];
  }
  protected parseRow(line: string): CpuSample | null {
    const n = numericRow(line);
    if (!n || n.length < 9) return null;
    // The first row is a since-boot average, not a live sample.
    if (this.rowIndex++ === 0) return null;
    const L = n.length;
    // Columns: <KB/t tps MB/s> per disk, then us sy id, then 1m 5m 15m.
    const disk = n.slice(0, L - 6);
    let mbs = 0;
    let tps = 0;
    for (let i = 0; i + 2 < disk.length; i += 3) {
      tps += disk[i + 1] || 0;
      mbs += disk[i + 2] || 0;
    }
    return {
      cpuUser: n[L - 6],
      cpuSys: n[L - 5],
      cpuIdle: n[L - 4],
      load1: n[L - 3],
      load5: n[L - 2],
      load15: n[L - 1],
      diskMBs: mbs,
      diskTps: tps,
    };
  }
}

// ----------------------------------------------------------------- vm_stat

export type MemSample = {
  freeBytes: number;
  wiredBytes: number;
  compressedBytes: number;
  fileBackedBytes: number;
};

class VmStatSampler extends StreamSampler<MemSample> {
  private cols: string[] | null = null;
  private pageSize = 16384;

  protected command(): [string, string[]] {
    return ['vm_stat', ['1']];
  }

  protected parseRow(line: string): MemSample | null {
    // "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
    const ps = line.match(/page size of (\d+) bytes/);
    if (ps) {
      this.pageSize = Number(ps[1]);
      return null;
    }
    const n = numericRow(line);
    if (!n) {
      // Column header — capture it so indices aren't hardcoded.
      const t = line.trim().split(/\s+/);
      if (t.includes('free') && t.includes('wired')) this.cols = t;
      return null;
    }
    if (!this.cols) return null;
    if (this.rowIndex++ === 0) return null; // first row mixes since-boot counters

    const at = (name: string) => {
      const i = this.cols!.indexOf(name);
      return i >= 0 && i < n.length ? n[i] * this.pageSize : 0;
    };
    return {
      freeBytes: at('free') + at('specul'),
      wiredBytes: at('wired'),
      // "cmprssor" is pages occupied by the compressor; "cmprssed" is what is
      // stored inside it. Occupancy is the figure that consumes real memory.
      compressedBytes: at('cmprssor'),
      fileBackedBytes: at('file-backed'),
    };
  }
}

// ---------------------------------------------------------------- netstat

export type NetSample = { rxBps: number; txBps: number };

class NetstatSampler extends StreamSampler<NetSample> {
  protected command(): [string, string[]] {
    return ['netstat', ['-w', '1']];
  }
  protected parseRow(line: string): NetSample | null {
    const n = numericRow(line);
    // packets errs bytes | packets errs bytes | colls
    if (!n || n.length < 7) return null;
    if (this.rowIndex++ === 0) return null;
    // netstat -w already reports per-interval deltas, so these are rates.
    return { rxBps: n[2], txBps: n[5] };
  }
}

const g = globalThis as unknown as {
  __sIostat?: IostatSampler;
  __sVmstat?: VmStatSampler;
  __sNetstat?: NetstatSampler;
};

export const cpuStream = (g.__sIostat ??= new IostatSampler());
export const memStream = (g.__sVmstat ??= new VmStatSampler());
export const netStream = (g.__sNetstat ??= new NetstatSampler());

export function startStreams(): void {
  cpuStream.start();
  memStream.start();
  netStream.start();
}

export function stopStreams(): void {
  cpuStream.stop();
  memStream.stop();
  netStream.stop();
}
