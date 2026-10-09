import { NextResponse } from 'next/server';

export interface AlertItem {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  timestamp: string;
  resolved: boolean;
}

export async function GET() {
  const alerts: AlertItem[] = [
    {
      id: 'alt_1',
      severity: 'INFO',
      title: 'Engine Started in SHADOW Mode',
      description: 'Zero real funds at risk. Evaluating momentum flips with realistic fees.',
      timestamp: '2026-10-09T13:00:00Z',
      resolved: true,
    },
    {
      id: 'alt_2',
      severity: 'WARNING',
      title: 'High Inflow dev_proxy_risk',
      description: 'Token 9x..P2 bypassed: cabal risk threshold triggered (score 82 > 75).',
      timestamp: '2026-10-09T14:15:30Z',
      resolved: true,
    },
    {
      id: 'alt_3',
      severity: 'INFO',
      title: 'Startup Recovery Reconciled',
      description: 'CleanIdle confirmed at slot 285,100,000. Invariants validated.',
      timestamp: '2026-10-09T13:00:05Z',
      resolved: true,
    },
  ];

  return NextResponse.json({
    active_alerts_count: alerts.filter(a => !a.resolved).length,
    alerts,
  });
}
