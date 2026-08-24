import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asString, asTimestampMs, fieldsByNumber, readFields } from './protobuf';

const APP_SUPPORT = path.join(os.homedir(), 'Library', 'Application Support');
/** Newest install first — the IDE was renamed between versions. */
const CANDIDATE_DIRS = ['Antigravity IDE', 'Antigravity'];

export function antigravityRoot(): string | null {
  for (const d of CANDIDATE_DIRS) {
    const full = path.join(APP_SUPPORT, d);
    if (fs.existsSync(path.join(full, 'User', 'globalStorage', 'state.vscdb'))) return full;
  }
  return null;
}

/**
 * Read a value out of the IDE's state DB.
 *
 * The IDE holds this database open with WAL enabled. We copy it to a temp file
 * and read the copy: opening the live file read-write — even accidentally —
 * risks corrupting the running editor's state.
 */
function readKeys(keys: string[]): Map<string, string> {
  const root = antigravityRoot();
  const out = new Map<string, string>();
  if (!root) return out;
  const src = path.join(root, 'User', 'globalStorage', 'state.vscdb');
  const tmp = path.join(os.tmpdir(), `ag-state-${process.pid}-${Date.now()}.vscdb`);
  try {
    fs.copyFileSync(src, tmp);
    const db = new Database(tmp, { readonly: true, fileMustExist: true });
    try {
      const stmt = db.prepare('SELECT key, value FROM ItemTable WHERE key = ?');
      for (const k of keys) {
        const row = stmt.get(k) as { key: string; value: unknown } | undefined;
        if (!row) continue;
        const v = row.value;
        out.set(k, typeof v === 'string' ? v : Buffer.from(v as Uint8Array).toString('utf8'));
      }
    } finally {
      db.close();
    }
  } catch {
    /* IDE not installed, DB locked, or schema changed — callers handle empty */
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
  }
  return out;
}

export type Trajectory = {
  id: string | null;
  title: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  workspace: string | null;
  project: string | null;
  repo: string | null;
  branch: string | null;
};

/** Workspace submessage: {1,2: uri, 3:{1: repo, 2: url}, 4: branch}. */
function decodeWorkspace(buf: Uint8Array) {
  const f = fieldsByNumber(buf);
  const uri = asString(f.get(1)?.[0]) ?? asString(f.get(2)?.[0]);
  const repoMsg = f.get(3)?.[0];
  let repo: string | null = null;
  if (repoMsg && repoMsg.type === 'bytes') {
    repo = asString(fieldsByNumber(repoMsg.value).get(1)?.[0]);
  }
  return { uri, repo, branch: asString(f.get(4)?.[0]) };
}

/**
 * Decode `trajectorySummaries`.
 *
 * Layout, recovered by inspection (there is no published schema):
 *   root      : repeated f1 = entry
 *   entry     : f1 = window uuid, f2 = wrapper
 *   wrapper   : f1 = ASCII base64 of the record
 *   record    : f1 title, f3 updated(ts), f4 uuid, f7 created(ts),
 *               f9 workspace, f10 activity(ts)
 * Any record that fails to decode is skipped rather than failing the panel.
 */
export function readTrajectories(): Trajectory[] {
  const raw = readKeys(['antigravityUnifiedStateSync.trajectorySummaries']).get(
    'antigravityUnifiedStateSync.trajectorySummaries',
  );
  if (!raw) return [];

  let root: Uint8Array;
  try {
    root = Buffer.from(raw, 'base64');
  } catch {
    return [];
  }

  const out: Trajectory[] = [];
  for (const entry of readFields(root)) {
    if (entry.type !== 'bytes') continue;
    try {
      const wrapper = fieldsByNumber(entry.value).get(2)?.[0];
      if (!wrapper || wrapper.type !== 'bytes') continue;
      const b64 = fieldsByNumber(wrapper.value).get(1)?.[0];
      if (!b64 || b64.type !== 'bytes') continue;
      const record = Buffer.from(Buffer.from(b64.value).toString('ascii'), 'base64');
      const f = fieldsByNumber(record);

      const wsField = f.get(9)?.[0];
      const ws = wsField && wsField.type === 'bytes' ? decodeWorkspace(wsField.value) : null;
      const uri = ws?.uri ?? null;
      const project = uri ? decodeURIComponent(uri).replace(/\/+$/, '').split('/').pop() ?? null : null;

      const updated = asTimestampMs(f.get(3)?.[0]) ?? asTimestampMs(f.get(10)?.[0]);
      const created = asTimestampMs(f.get(7)?.[0]);

      const t: Trajectory = {
        id: asString(f.get(4)?.[0]),
        title: asString(f.get(1)?.[0]),
        createdAt: created,
        updatedAt: updated,
        workspace: uri,
        project,
        repo: ws?.repo ?? null,
        branch: ws?.branch ?? null,
      };
      if (t.title || t.id) out.push(t);
    } catch {
      continue; // undocumented format: skip a bad record, keep the rest
    }
  }
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Models the account has access to, read from `userStatus`.
 *
 * The value is an opaque nested-protobuf blob with no schema, so this scans for
 * base64 segments and pulls out recognizable model names. `modelPreferences`
 * looks like the right key but holds only field names, not models.
 */
export function readAvailableModels(): string[] {
  const raw = readKeys(['antigravityUnifiedStateSync.userStatus']).get(
    'antigravityUnifiedStateSync.userStatus',
  );
  if (!raw) return [];
  const NAME = /(?:Gemini|Claude|GPT|Sonnet|Opus|Haiku|Grok|Llama)[A-Za-z0-9 .()\-]{0,30}/g;
  const found = new Set<string>();
  const scan = (text: string, depth: number) => {
    for (const m of text.match(NAME) ?? []) found.add(m.trim());
    if (depth > 2) return;
    for (const blob of text.match(/[A-Za-z0-9+/=]{30,}/g) ?? []) {
      try {
        scan(Buffer.from(blob, 'base64').toString('utf8'), depth + 1);
      } catch {
        continue;
      }
    }
  };
  try {
    scan(Buffer.from(raw, 'base64').toString('utf8'), 0);
  } catch {
    return [];
  }
  return [...found].filter((s) => s.length > 4).sort();
}

export type IdeSession = { start: number; end: number; durationMs: number };

const HEARTBEAT_GAP_MS = 15 * 60 * 1000; // heartbeats land every ~5 min

/**
 * Reconstruct IDE-active windows from Cloud Code heartbeats.
 *
 * While Antigravity runs it POSTs `loadCodeAssist` every ~5 minutes, logged to
 * `logs/<launch>/cloudcode.log`. Contiguous heartbeats form a session; a gap
 * longer than 15 minutes ends one.
 *
 * Log-directory mtimes are NOT usable for this: a directory's newest file keeps
 * advancing while the editor sits open, which reports a flat 24h of "activity"
 * every day the app was merely running.
 */
export function readIdeSessions(maxLaunches = 80): IdeSession[] {
  const root = antigravityRoot();
  if (!root) return [];
  const logsDir = path.join(root, 'logs');

  let dirs: string[];
  try {
    dirs = fs.readdirSync(logsDir).filter((d) => /^\d{8}T\d{6}$/.test(d)).sort().slice(-maxLaunches);
  } catch {
    return [];
  }

  const beats: number[] = [];
  for (const d of dirs) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(logsDir, d, 'cloudcode.log'), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.includes('loadCodeAssist')) continue;
      // "2026-08-24 18:42:48.943 [info] ..." — local time, no zone marker.
      const m = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (!m) continue;
      const t = new Date(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6]),
      ).getTime();
      if (Number.isFinite(t)) beats.push(t);
    }
  }
  if (beats.length === 0) return [];

  beats.sort((a, b) => a - b);
  const sessions: IdeSession[] = [];
  let start = beats[0];
  let prev = beats[0];
  for (const t of beats.slice(1)) {
    if (t - prev > HEARTBEAT_GAP_MS) {
      sessions.push({ start, end: prev, durationMs: prev - start });
      start = t;
    }
    prev = t;
  }
  sessions.push({ start, end: prev, durationMs: prev - start });

  return sessions.filter((s) => s.durationMs > 0).sort((a, b) => b.start - a.start);
}

/** Extract a Google OAuth access token, if one is cached. Never log this. */
export function readAccessToken(): string | null {
  const raw = readKeys(['antigravityUnifiedStateSync.oauthToken']).get(
    'antigravityUnifiedStateSync.oauthToken',
  );
  if (!raw) return null;
  const seen = new Set<string>();

  const hunt = (buf: Buffer, depth: number): string | null => {
    if (depth > 5) return null;
    const text = buf.toString('utf8');
    const direct = text.match(/ya29\.[A-Za-z0-9._\-]{20,}/);
    if (direct) return direct[0];
    for (const blob of text.match(/[A-Za-z0-9+/=_-]{40,}/g) ?? []) {
      if (seen.has(blob)) continue;
      seen.add(blob);
      try {
        const dec = Buffer.from(blob, 'base64');
        if (dec.length < 8) continue;
        const hit = hunt(dec, depth + 1);
        if (hit) return hit;
      } catch {
        continue;
      }
    }
    return null;
  };

  try {
    return hunt(Buffer.from(raw, 'base64'), 0);
  } catch {
    return null;
  }
}
