'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';

const AXIS = { fill: 'var(--text-muted)', fontSize: 11 };

/** Shared tooltip so every chart reads the same. Text uses ink tokens, never series color. */
function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string | number; value?: number; color?: string }[];
  label?: string | number;
  formatter?: (v: number, key: string) => string;
  labelFormatter?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2 shadow-lg">
      <div className="mb-1 text-[11px] font-medium text-ink-2">
        {labelFormatter && label !== undefined ? labelFormatter(label) : label}
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="num ml-auto font-medium text-ink">
            {formatter && typeof p.value === 'number'
              ? formatter(p.value, String(p.dataKey ?? p.name ?? ''))
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export type Series = { key: string; name: string; color: string };

export function TimeSeries({
  data,
  series,
  xKey,
  height = 200,
  yFormatter,
  valueFormatter,
  labelFormatter,
  area = true,
  animate = true,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  xKey: string;
  height?: number;
  yFormatter?: (v: number) => string;
  valueFormatter?: (v: number, key: string) => string;
  labelFormatter?: (l: string | number) => string;
  area?: boolean;
  animate?: boolean;
}) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--grid)' }}
          minTickGap={28}
          tickFormatter={labelFormatter as (v: string | number) => string}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={yFormatter as (v: number) => string}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          content={<ChartTooltip formatter={valueFormatter} labelFormatter={labelFormatter} />}
        />
        {series.map((s) =>
          area ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#g-${s.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
              isAnimationActive={animate}
              connectNulls
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
              isAnimationActive={animate}
              connectNulls
            />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

export function StackedBars({
  data,
  series,
  xKey,
  height = 200,
  yFormatter,
  valueFormatter,
  labelFormatter,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  xKey: string;
  height?: number;
  yFormatter?: (v: number) => string;
  valueFormatter?: (v: number, key: string) => string;
  labelFormatter?: (l: string | number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }} barCategoryGap="22%">
        <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--grid)' }}
          minTickGap={20}
          tickFormatter={labelFormatter as (v: string | number) => string}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={yFormatter as (v: number) => string} />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={<ChartTooltip formatter={valueFormatter} labelFormatter={labelFormatter} />}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="a"
            fill={s.color}
            // 2px surface gap between stacked segments.
            stroke="var(--surface-1)"
            strokeWidth={2}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MiniBars({
  data,
  xKey,
  yKey,
  color,
  height = 64,
  valueFormatter,
  labelFormatter,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color: string;
  height?: number;
  valueFormatter?: (v: number, key: string) => string;
  labelFormatter?: (l: string | number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap="20%">
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={<ChartTooltip formatter={valueFormatter} labelFormatter={labelFormatter} />}
        />
        <XAxis dataKey={xKey} hide />
        <YAxis hide />
        <Bar dataKey={yKey} radius={[3, 3, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChartFrame({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}
