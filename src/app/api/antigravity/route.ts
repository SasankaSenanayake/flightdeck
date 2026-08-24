import { NextResponse } from 'next/server';
import { buildAntigravityReport } from '@/lib/antigravity/report';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await buildAntigravityReport());
  } catch (err) {
    return NextResponse.json(
      { installed: false, error: err instanceof Error ? err.message : 'failed to read Antigravity state' },
      { status: 200 },
    );
  }
}
