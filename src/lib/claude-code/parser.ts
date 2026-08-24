import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { type TokenCounts } from '@/lib/pricing';

export type UsageRecord = {
  /** Anthropic request id — the dedupe key. */
  rid: string;
  model: string | null;
  ts: string;
  sessionId: string | null;
  project: string;
  cwd: string | null;
  branch: string | null;
  effort: string | null;
  sidechain: boolean;
  tokens: TokenCounts;
};

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Every transcript under ~/.claude/projects, recursively.
 *
 * Subagent work is written to `<project>/<sessionId>/subagents/*.jsonl` rather
 * than the session transcript — on this machine that is 91 of 122 files. A
 * single-level scan silently drops all of their (billed) usage.
 */
function listTranscripts(): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(PROJECTS_DIR, 0);
  return out;
}

/**
 * Directories that hold projects rather than being one. A cwd of
 * `~/MyProjects/foo/apps/web` belongs to project `foo`, not `web`.
 */
const WORKSPACE_ROOTS = new Set([
  'MyProjects', 'Projects', 'Docker', 'dev', 'src', 'code', 'work', 'repos', 'git',
]);

/** Resolve a session cwd to its owning project, collapsing subdirectories. */
export function projectOf(cwd: string | undefined, filePath: string): string {
  let rel: string[];
  if (cwd) {
    rel = cwd.split(path.sep).filter(Boolean);
    const home = os.homedir().split(path.sep).filter(Boolean);
    // Drop a leading home-directory prefix so the first segment is meaningful.
    if (home.every((seg, i) => rel[i] === seg)) rel = rel.slice(home.length);
  } else {
    // Fallback: the encoded directory name, e.g. `-Users-me-MyProjects-foo`.
    // Project names contain dashes, so this cannot be split reliably — keep it whole.
    return path.basename(path.dirname(filePath));
  }
  if (rel.length === 0) return cwd ? path.basename(cwd) : 'unknown';
  if (WORKSPACE_ROOTS.has(rel[0]) && rel.length > 1) return rel[1];
  return rel[0];
}

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

function normalizeTokens(u: RawUsage): TokenCounts {
  const c5 = u.cache_creation?.ephemeral_5m_input_tokens;
  const c1 = u.cache_creation?.ephemeral_1h_input_tokens;
  // Prefer the explicit 5m/1h split. Only when it is absent do we fall back to
  // the flat total, attributing it to the 5m rate (the cheaper, more common TTL).
  const haveSplit = c5 !== undefined || c1 !== undefined;
  return {
    uncachedInput: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite5m: haveSplit ? (c5 ?? 0) : (u.cache_creation_input_tokens ?? 0),
    cacheWrite1h: haveSplit ? (c1 ?? 0) : 0,
  };
}

/**
 * Parse a chunk of a transcript into usage records.
 *
 * Works on the raw Buffer and splits on newline bytes so the returned `consumed`
 * count is an exact byte offset of the last *complete* line. A transcript being
 * appended to by a live session routinely ends mid-line, and resuming from a
 * partial line would corrupt every subsequent parse.
 */
function parseChunk(buf: Buffer, filePath: string): { records: UsageRecord[]; consumed: number } {
  const records: UsageRecord[] = [];
  const isSubagent = filePath.includes(`${path.sep}subagents${path.sep}`);
  let consumed = 0;
  let start = 0;

  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start);
    if (nl === -1) break;
    const line = buf.toString('utf8', start, nl);
    start = nl + 1;
    consumed = start; // byte offset, tracked incrementally

    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // tolerate a torn or malformed line rather than failing the file
    }
    if (d.type !== 'assistant') continue;
    const msg = d.message as { model?: string; usage?: RawUsage } | undefined;
    const usage = msg?.usage;
    if (!usage) continue;
    const rid = d.requestId as string | undefined;
    if (!rid) continue;

    records.push({
      rid,
      model: msg?.model ?? null,
      ts: (d.timestamp as string) ?? '',
      sessionId: (d.sessionId as string) ?? null,
      project: projectOf(d.cwd as string | undefined, filePath),
      cwd: (d.cwd as string) ?? null,
      branch: (d.gitBranch as string) || null,
      effort: (d.effort as string) ?? null,
      sidechain: isSubagent || Boolean(d.isSidechain),
      tokens: normalizeTokens(usage),
    });
  }
  return { records, consumed };
}

type CursorRow = { size: number; mtime: number; offset: number; data: string };

/** Read every transcript, using a per-file byte cursor to skip already-parsed bytes. */
function collectRecords(): UsageRecord[] {
  const db = getDb();
  const read = db.prepare('SELECT size, mtime, offset, data FROM jsonl_cursor WHERE path = ?');
  const write = db.prepare(
    'INSERT INTO jsonl_cursor (path, size, mtime, offset, data) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, ' +
      'offset=excluded.offset, data=excluded.data',
  );

  const all: UsageRecord[] = [];

  for (const file of listTranscripts()) {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const mtime = Math.floor(st.mtimeMs);
    const prev = read.get(file) as CursorRow | undefined;

    // Unchanged since last parse — reuse the cached records verbatim.
    if (prev && prev.size === st.size && prev.mtime === mtime) {
      try {
        all.push(...(JSON.parse(prev.data) as UsageRecord[]));
        continue;
      } catch {
        /* fall through to a full re-parse */
      }
    }

    // Append-only growth: resume from the stored offset. Anything else (shrunk,
    // rewritten, or never seen) gets a full read.
    const canResume = Boolean(prev) && prev!.size <= st.size && prev!.offset <= st.size;
    const startAt = canResume ? prev!.offset : 0;
    let carried: UsageRecord[] = [];
    if (canResume) {
      try {
        carried = JSON.parse(prev!.data) as UsageRecord[];
      } catch {
        carried = [];
      }
    }

    let chunk: Buffer;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const len = st.size - startAt;
        if (len <= 0) {
          chunk = Buffer.alloc(0);
        } else {
          chunk = Buffer.allocUnsafe(len);
          fs.readSync(fd, chunk, 0, len, startAt);
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      continue;
    }

    const { records, consumed } = parseChunk(chunk, file);
    const merged = carried.concat(records);
    write.run(file, st.size, mtime, startAt + consumed, JSON.stringify(merged));
    all.push(...merged);
  }
  return all;
}

/**
 * All Claude Code usage, deduplicated by requestId.
 *
 * A single API request emits several assistant lines (one per content block),
 * each carrying the *same cumulative* usage object. Measured on this machine:
 * 6,289 usage-bearing lines collapse to 3,255 real requests, and every duplicate
 * was byte-identical. Summing lines instead of requests inflates cost by ~93%.
 */
export function loadUsageRecords(): UsageRecord[] {
  const byRid = new Map<string, UsageRecord>();
  for (const r of collectRecords()) {
    if (!byRid.has(r.rid)) byRid.set(r.rid, r);
  }
  return [...byRid.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}
