import { NextResponse } from 'next/server';
import { AdminAuthFailed, AdminKeyMissing, fetchAdminReport } from '@/lib/anthropic-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 30, 1), 180);
  try {
    return NextResponse.json(await fetchAdminReport(days));
  } catch (err) {
    // A missing or rejected key is a configuration state, not a server fault —
    // the UI renders a setup card for it rather than an error.
    if (err instanceof AdminKeyMissing) {
      return NextResponse.json({ configured: false, reason: 'missing_key' });
    }
    if (err instanceof AdminAuthFailed) {
      return NextResponse.json({ configured: false, reason: 'auth_failed', message: err.message });
    }
    return NextResponse.json(
      { configured: false, reason: 'error', message: err instanceof Error ? err.message : 'unknown' },
      { status: 200 },
    );
  }
}
