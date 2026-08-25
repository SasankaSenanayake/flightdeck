'use client';

/**
 * Compact inline trend line for a stat tile. Plain SVG polyline, not a chart
 * library — at ~20 points this is cheaper and simpler than mounting Recharts
 * per tile, and it only needs an area fill, a faint baseline, and an
 * emphasized endpoint to read well at this size.
 */
export function Sparkline({
  data,
  color,
  height = 28,
}: {
  data: (number | null)[];
  color: string;
  height?: number;
}) {
  const values = data.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length < 2) return null;

  const w = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Map only the finite points, preserving their original x position so a
  // gap in the data doesn't compress the timeline.
  const n = data.length;
  const pts: [number, number][] = [];
  data.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const x = n > 1 ? (i / (n - 1)) * w : 0;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    pts.push([x, y]);
  });

  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const [lastX, lastY] = pts[pts.length - 1];
  const areaPath = `M${pts[0][0].toFixed(2)},${height} L${path.slice(1)} L${lastX.toFixed(2)},${height} Z`;
  const baselineY = height - (0 - min > range ? 0 : ((0 - min) / range) * (height - 4) - 2);

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      aria-hidden="true"
    >
      {min < 0 && max > 0 && (
        <line x1={0} y1={baselineY} x2={w} y2={baselineY} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      )}
      <path d={areaPath} fill={color} opacity={0.14} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
    </svg>
  );
}
