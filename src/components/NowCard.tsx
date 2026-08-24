'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';

/**
 * Live clock. Ticks client-side only — starting from `null` avoids a
 * server/client hydration mismatch (the server has no "now").
 */
export function NowCard() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = now?.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const time = now?.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const tz = now
    ? new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value
    : undefined;

  // CMB = Colombo (Asia/Colombo), fixed +5:30, no DST.
  const cmbTime = now?.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

  return (
    <Card>
      <p className="text-sm font-medium text-ink-2">{date ?? ' '}</p>
      <p className="num mt-1 text-3xl font-semibold tracking-tight text-ink">{time ?? ' '}</p>
      {tz && <p className="mt-1 text-xs text-ink-3">{tz}</p>}
      {cmbTime && (
        <p className="num mt-3 border-t border-line pt-2 text-sm text-ink-2">
          <span className="text-ink-3">CMB</span> {cmbTime}
        </p>
      )}
    </Card>
  );
}
