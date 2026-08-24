'use client';

import { Card, Empty } from './ui';
import { useLive } from '@/lib/useLive';
import { relativeTime } from '@/lib/format';

type Report =
  | { configured: false; reason: 'not_configured' | 'error'; message?: string }
  | {
      configured: true;
      locationName: string;
      updatedAt: string;
      tempC: number;
      feelsLikeC: number;
      condition: string;
      emoji: string;
      isDay: boolean;
      humidity: number;
      windKph: number;
      highC: number;
      lowC: number;
    };

const round = (n: number) => Math.round(n);

export function WeatherCard() {
  const { data, isLoading } = useLive<Report>('/api/weather', 15 * 60_000);

  if (isLoading || !data) {
    return (
      <Card>
        <p className="text-sm text-ink-3">Loading weather…</p>
      </Card>
    );
  }

  if (!data.configured) {
    return (
      <Card title="Weather">
        <Empty
          title="Not configured"
          body={
            data.reason === 'not_configured'
              ? 'Set WEATHER_LOCATION in .env.local to a city name (e.g. "Colombo, Sri Lanka") and restart.'
              : (data.message ?? 'Could not fetch weather.')
          }
        />
      </Card>
    );
  }

  return (
    <Card subtitle={data.locationName} right={<span className="num">{relativeTime(data.updatedAt)}</span>}>
      <div className="flex items-center gap-3">
        <span className="text-4xl leading-none" aria-hidden>
          {data.emoji}
        </span>
        <div>
          <p className="num text-3xl font-semibold tracking-tight text-ink">{round(data.tempC)}°C</p>
          <p className="text-xs text-ink-2">
            {data.condition} · feels {round(data.feelsLikeC)}°C
          </p>
        </div>
      </div>
      <p className="num mt-3 text-xs text-ink-3">
        H {round(data.highC)}° · L {round(data.lowC)}° · {data.humidity}% humidity · {round(data.windKph)} km/h wind
      </p>
    </Card>
  );
}
