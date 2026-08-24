import { fetchQuota, type QuotaResult } from './quota';
import { antigravityRoot, readAvailableModels, readIdeSessions, readTrajectories, type Trajectory } from './state';

export type AntigravityReport = {
  installed: boolean;
  generatedAt: string;
  quota: QuotaResult;
  totals: {
    trajectories: number;
    projects: number;
    ideSessions: number;
    ideUptimeHours: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  daily: { date: string; trajectories: number; ideUptimeHours: number }[];
  byProject: { name: string; trajectories: number; repo: string | null }[];
  recent: Trajectory[];
  availableModels: string[];
  /** Surfaced so the UI never implies these are token or credit figures. */
  dataNote: string;
};

const DAY_MS = 86_400_000;

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function buildAntigravityReport(): Promise<AntigravityReport> {
  const installed = antigravityRoot() !== null;
  const [quota, trajectories, sessions, availableModels] = await Promise.all([
    fetchQuota(),
    Promise.resolve(readTrajectories()),
    Promise.resolve(readIdeSessions()),
    Promise.resolve(readAvailableModels()),
  ]);

  const days = new Map<string, { trajectories: number; uptimeMs: number }>();
  const bump = (date: string, key: 'trajectories' | 'uptimeMs', n: number) => {
    const e = days.get(date) ?? { trajectories: 0, uptimeMs: 0 };
    e[key] += n;
    days.set(date, e);
  };

  for (const t of trajectories) {
    const ts = t.updatedAt ?? t.createdAt;
    if (ts) bump(localDate(ts), 'trajectories', 1);
  }

  let uptimeMs = 0;
  for (const s of sessions) {
    // Split a run that crosses midnight across the days it actually covers.
    let cursor = s.start;
    while (cursor < s.end) {
      const dayEnd = new Date(cursor).setHours(24, 0, 0, 0);
      const slice = Math.min(s.end, dayEnd) - cursor;
      bump(localDate(cursor), 'uptimeMs', slice);
      uptimeMs += slice;
      cursor += slice;
      if (slice <= 0) break;
    }
  }

  const projects = new Map<string, { trajectories: number; repo: string | null }>();
  for (const t of trajectories) {
    const name = t.project ?? 'unknown';
    const e = projects.get(name) ?? { trajectories: 0, repo: t.repo };
    e.trajectories += 1;
    if (!e.repo && t.repo) e.repo = t.repo;
    projects.set(name, e);
  }

  const stamps = trajectories
    .map((t) => t.updatedAt ?? t.createdAt)
    .filter((x): x is number => typeof x === 'number')
    .sort((a, b) => a - b);

  const daily = [...days.entries()]
    .map(([date, v]) => ({
      date,
      trajectories: v.trajectories,
      ideUptimeHours: Number((v.uptimeMs / 3_600_000).toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((d) => Date.parse(d.date) > Date.now() - 120 * DAY_MS);

  return {
    installed,
    generatedAt: new Date().toISOString(),
    quota,
    totals: {
      trajectories: trajectories.length,
      projects: projects.size,
      ideSessions: sessions.length,
      ideUptimeHours: Number((uptimeMs / 3_600_000).toFixed(1)),
      firstSeen: stamps.length ? localDate(stamps[0]) : null,
      lastSeen: stamps.length ? localDate(stamps[stamps.length - 1]) : null,
    },
    daily,
    byProject: [...projects.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.trajectories - a.trajectories),
    recent: trajectories.slice(0, 15),
    availableModels,
    dataNote:
      'Antigravity stores no token or credit counts on disk. Agent sessions come from local trajectory state; uptime is measured from Cloud Code heartbeats, so it reflects the IDE running — not time spent actively working.',
  };
}
