'use client';

import type { ReactNode } from 'react';
import { Sparkline } from './Sparkline';

export function Card({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`card-enter rounded-xl border border-line bg-surface-1 p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-5 ${className}`}
    >
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0 text-xs text-ink-3">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
  tone = 'default',
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  tone?: 'default' | 'good' | 'warning' | 'critical';
  /** Optional recent-history trend, oldest first — renders as a compact sparkline. */
  spark?: (number | null)[];
}) {
  const toneColor =
    tone === 'good'
      ? 'var(--good)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'critical'
          ? 'var(--critical)'
          : undefined;
  return (
    <div className="card-enter rounded-xl border border-line bg-surface-1 p-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-center gap-2">
        {accent && (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        )}
        <span className="truncate text-xs font-medium text-ink-2">{label}</span>
      </div>
      <div
        className="num mt-2 text-2xl font-semibold tracking-tight"
        style={toneColor ? { color: toneColor } : undefined}
      >
        {value}
      </div>
      {hint && <div className="num mt-1 text-xs text-ink-3">{hint}</div>}
      {spark && spark.filter((v) => v !== null).length >= 2 && (
        <div className="mt-2.5 -mb-1">
          <Sparkline data={spark} color={toneColor ?? accent ?? 'var(--series-1)'} />
        </div>
      )}
    </div>
  );
}

/** Horizontal magnitude bar. Rounded data-end, 2px gap, always direct-labeled. */
export function BarRow({
  label,
  value,
  max,
  color,
  sublabel,
}: {
  label: string;
  value: string;
  max: number;
  color: string;
  sublabel?: string;
}) {
  const raw = Number(String(value).replace(/[^0-9.-]/g, '')) || 0;
  const w = max > 0 ? Math.max(1.5, (raw / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-xs text-ink" title={label}>
          {label}
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
        </div>
      </div>
      <div className="text-right">
        <div className="num text-xs font-medium text-ink">{value}</div>
        {sublabel && <div className="num text-[11px] text-ink-3">{sublabel}</div>}
      </div>
    </div>
  );
}

/** Radial gauge for a single live percentage. */
export function Gauge({
  value,
  label,
  detail,
  color,
}: {
  value: number | null;
  label: string;
  detail?: string;
  color: string;
}) {
  const v = value === null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value));
  const R = 42;
  const C = 2 * Math.PI * R;
  const dash = v === null ? 0 : (v / 100) * C;
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 100 100" className="size-28 -rotate-90" role="img" aria-label={`${label} ${v ?? 0}%`}>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
          {v !== null && (
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
              style={{ transition: 'stroke-dasharray 400ms ease-out' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-xl font-semibold text-ink">
            {v === null ? '—' : `${Math.round(v)}%`}
          </span>
        </div>
      </div>
      <div className="mt-2 text-xs font-medium text-ink-2">{label}</div>
      {detail && <div className="num text-[11px] text-ink-3">{detail}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5 text-xs text-ink-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: i.color }} />
          <span>{i.name}</span>
          {i.value && <span className="num font-medium text-ink">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-xs text-ink-3">{body}</p>}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 border-l-2 border-line-strong pl-3 text-[11px] leading-relaxed text-ink-3">
      {children}
    </p>
  );
}
