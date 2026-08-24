'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import { useEffect, useState } from 'react';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

/** True while the tab is visible. Polling stops when it isn't. */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * Poll an endpoint, but only while the tab is in the foreground.
 *
 * A hidden tab polling every 2s is pure waste — and this dashboard exists to
 * measure the machine, not to load it.
 */
export function useLive<T>(url: string, intervalMs: number, opts?: SWRConfiguration) {
  const visible = useVisible();
  return useSWR<T>(url, fetcher, {
    refreshInterval: visible ? intervalMs : 0,
    revalidateOnFocus: true,
    keepPreviousData: true,
    ...opts,
  });
}

/** Append to a bounded rolling window — charts must never grow unbounded. */
export function useRolling<T>(value: T | undefined, cap = 150): T[] {
  const [buf, setBuf] = useState<T[]>([]);
  useEffect(() => {
    if (value === undefined) return;
    setBuf((prev) => {
      const next = [...prev, value];
      return next.length > cap ? next.slice(next.length - cap) : next;
    });
  }, [value, cap]);
  return buf;
}
