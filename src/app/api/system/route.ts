import { NextResponse } from 'next/server';
import { snapshot } from '@/lib/system/metrics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await snapshot());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to read system metrics' },
      { status: 500 },
    );
  }
}
