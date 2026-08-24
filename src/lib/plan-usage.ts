import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The Claude desktop app's own cache of Pro/Max plan usage percentages —
 * the same numbers shown in its Settings → Usage pane ("Current session",
 * "All models" weekly). This is the only local source of *real* plan quota:
 * Claude Code's own transcripts never see the account's actual limits, only
 * the tokens it sent, so a token-derived "% of plan used" would be a guess.
 * This file is the app's own account-synced figure — sampled every ~15
 * minutes while the app runs — so it's authoritative, not estimated.
 */
const FILE = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Claude',
  'plan-usage-history.json',
);

type RawSample = { t: number; org?: string; u: { fh?: number; sd?: number } };

export type PlanUsagePoint = { t: number; session: number; weekly: number };

export type PlanUsageReport =
  | { available: false }
  | {
      available: true;
      updatedAt: string;
      /** Rolling ~5-hour session window. */
      session: { pct: number; sampledAt: string };
      /** 7-day, all-models window. Observed to reset Sunday just after midnight. */
      weekly: { pct: number; sampledAt: string };
      history: PlanUsagePoint[];
    };

function readSamples(): RawSample[] {
  let raw: string;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { samples?: RawSample[] };
    return Array.isArray(parsed.samples) ? parsed.samples : [];
  } catch {
    return [];
  }
}

export function buildPlanUsageReport(days = 14, maxPoints = 400): PlanUsageReport {
  const all = readSamples();
  if (all.length === 0) return { available: false };

  const since = Date.now() - days * 86_400_000;
  const windowed = all.filter((s) => s.t >= since);
  const source = windowed.length > 1 ? windowed : all.slice(-1);

  const stride = Math.max(1, Math.ceil(source.length / maxPoints));
  const lastIdx = source.length - 1;
  const history: PlanUsagePoint[] = source
    // Always keep the final sample: striding from index 0 doesn't generally
    // land on the last index, which would make the chart's right edge lag
    // behind the header gauges by up to `stride` samples.
    .filter((_, i) => i % stride === 0 || i === lastIdx)
    .map((s) => ({ t: s.t, session: s.u.fh ?? 0, weekly: s.u.sd ?? 0 }));

  const last = all[all.length - 1];
  const at = new Date(last.t).toISOString();

  return {
    available: true,
    updatedAt: at,
    session: { pct: last.u.fh ?? 0, sampledAt: at },
    weekly: { pct: last.u.sd ?? 0, sampledAt: at },
    history,
  };
}
