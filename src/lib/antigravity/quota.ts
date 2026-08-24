import { readAccessToken } from './state';

const ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export type QuotaResult =
  | { available: true; tier: string | null; raw: Record<string, unknown> }
  | { available: false; reason: 'disabled' | 'no_token' | 'auth_expired' | 'unsupported' | 'error'; message: string };

/**
 * Best-effort attempt at Antigravity's real quota.
 *
 * Antigravity stores no token or credit counts locally, so the only path to
 * real numbers is the same undocumented Cloud Code endpoint the IDE itself
 * polls every ~5 minutes. We reuse the cached short-lived access token and send
 * it only to Google, its own issuer. The refresh token is deliberately never
 * touched — reusing an existing session is defensible, minting new credentials
 * is not.
 *
 * This is undocumented and may break or change without notice, so every failure
 * path is a clean fallback to the activity panel. Opt in with
 * ANTIGRAVITY_LIVE_QUOTA=1.
 */
export async function fetchQuota(): Promise<QuotaResult> {
  if (process.env.ANTIGRAVITY_LIVE_QUOTA !== '1') {
    return { available: false, reason: 'disabled', message: 'Set ANTIGRAVITY_LIVE_QUOTA=1 to attempt the live quota lookup.' };
  }

  const token = readAccessToken();
  if (!token) {
    return { available: false, reason: 'no_token', message: 'No cached Google access token found in the IDE state.' };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'DARWIN_ARM64', pluginType: 'GEMINI' },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        available: false,
        reason: 'auth_expired',
        message: 'Cached access token was rejected (it expires roughly hourly). Reopen Antigravity to refresh it.',
      };
    }
    if (!res.ok) {
      return {
        available: false,
        reason: 'unsupported',
        message: `Endpoint returned ${res.status}. This API is undocumented and may have changed.`,
      };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const current = body.currentTier as { id?: string; name?: string } | undefined;
    return { available: true, tier: current?.name ?? current?.id ?? null, raw: body };
  } catch (err) {
    return {
      available: false,
      reason: 'error',
      // Deliberately not echoing the request: it carries the bearer token.
      message: err instanceof Error && err.name === 'TimeoutError' ? 'Request timed out after 5s.' : 'Request failed.',
    };
  }
}
