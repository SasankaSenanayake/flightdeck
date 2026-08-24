import { NextResponse } from 'next/server';
import { buildClaudeCodeReport } from '@/lib/claude-code/aggregate';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(buildClaudeCodeReport());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to read transcripts' },
      { status: 500 },
    );
  }
}
