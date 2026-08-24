import { NextResponse } from 'next/server';
import { buildPlanUsageReport } from '@/lib/plan-usage';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 14, 1), 21);
  try {
    return NextResponse.json(buildPlanUsageReport(days));
  } catch (err) {
    return NextResponse.json(
      { available: false, error: err instanceof Error ? err.message : 'failed to read plan usage' },
      { status: 200 },
    );
  }
}
