import { NextResponse } from 'next/server';
import { WeatherNotConfigured, fetchWeatherReport } from '@/lib/weather';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fetchWeatherReport());
  } catch (err) {
    if (err instanceof WeatherNotConfigured) {
      return NextResponse.json({ configured: false, reason: 'not_configured' });
    }
    return NextResponse.json({
      configured: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
}
