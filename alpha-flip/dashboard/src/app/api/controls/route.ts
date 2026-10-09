import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, logAudit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.ip || '127.0.0.1';

  // 1. Enforce strict rate limiting
  if (!checkRateLimit(ip, 5, 60_000)) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: 'PAUSE',
      operator: 'unknown',
      ip,
      status: 'RATE_LIMITED',
      reason: 'Too many requests in 60s window',
    });
    return NextResponse.json(
      { error: 'Rate limit exceeded. Maximum 5 control requests per minute.' },
      { status: 429 }
    );
  }

  // 2. Validate Bearer Auth Token
  const authHeader = req.headers.get('authorization');
  const expectedToken = process.env.DASHBOARD_AUTH_TOKEN || 'super_secret_operator_token_change_in_production';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing Bearer authorization header' }, { status: 401 });
  }

  const token = authHeader.substring(7).trim();
  if (token !== expectedToken) {
    logAudit({
      timestamp: new Date().toISOString(),
      action: 'PAUSE',
      operator: 'unauthorized',
      ip,
      status: 'DENIED',
      reason: 'Invalid authentication token',
    });
    return NextResponse.json({ error: 'Unauthorized: Invalid operator token' }, { status: 403 });
  }

  // 3. Parse action body
  try {
    const body = await req.json();
    const { action, confirmation, operator } = body;

    // Strict guard: No direct trade execution allowed!
    if (action !== 'PAUSE' && action !== 'KILL' && action !== 'RESUME') {
      return NextResponse.json(
        { error: 'Invalid control action. Allowed actions: PAUSE, KILL, RESUME. Direct trade placement is strictly forbidden.' },
        { status: 400 }
      );
    }

    if (!confirmation || confirmation !== `CONFIRM_${action}`) {
      return NextResponse.json(
        { error: `Explicit confirmation required. Send confirmation: "CONFIRM_${action}"` },
        { status: 400 }
      );
    }

    // In production, publish control action to Redis channel `alpha_flip:hot:commands`
    logAudit({
      timestamp: new Date().toISOString(),
      action,
      operator: operator || 'operator',
      ip,
      status: 'SUCCESS',
      reason: `Operator commanded ${action}`,
    });

    return NextResponse.json({
      success: true,
      action,
      message: `Engine mode commanded: ${action}`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
  }
}
