import { NextRequest, NextResponse } from 'next/server';
import {
  getAccountAccessStartupCheck,
  warnIfAccountAccessConfigMissing,
} from '@/lib/auth/account-access-config';
import { authenticateCaller, fetchBackendResponse } from '@/lib/server/backend-api';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization, Origin',
};

export async function GET(req: NextRequest) {
  const authError = await authenticateCaller(req);
  if (authError) return authError;

  warnIfAccountAccessConfigMissing();

  try {
    const upstream = await fetchBackendResponse({
      method: 'GET',
      path: '/health/startup-validation',
      timeoutMs: 30_000,
    });

    const payload = await upstream.json().catch(() => null) as
      | { status?: string; checks?: Array<{ status?: string }> }
      | null;

    if (!upstream.ok || !payload) {
      return NextResponse.json(
        payload ?? { error: 'Backend unreachable' },
        {
          status: upstream.status || 502,
          headers: privateHeaders,
        }
      );
    }

    const frontendCheck = getAccountAccessStartupCheck();
    const checks = [...(Array.isArray(payload.checks) ? payload.checks : []), frontendCheck];
    const status = checks.some((check) => check?.status === 'fail')
      ? 'fail'
      : checks.some((check) => check?.status === 'warn')
        ? 'warn'
        : 'pass';

    return NextResponse.json(
      {
        ...payload,
        status,
        checks,
      },
      {
        status: upstream.status,
        headers: privateHeaders,
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Backend unreachable' },
      { status: 502, headers: privateHeaders }
    );
  }
}
