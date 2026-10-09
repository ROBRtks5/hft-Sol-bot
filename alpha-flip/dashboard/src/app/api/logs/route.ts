import { NextResponse } from 'next/server';
import { getAuditLogs } from '@/lib/audit';

export async function GET() {
  const systemLogs = [
    {
      level: 'INFO',
      message: 'Yellowstone gRPC subscription frame received slot=285120440',
      timestamp: new Date(Date.now() - 500).toISOString(),
    },
    {
      level: 'DEBUG',
      message: 'Instruction decoder unpacked Pump.fun buy tx in 38µs',
      timestamp: new Date(Date.now() - 1500).toISOString(),
    },
    {
      level: 'INFO',
      message: 'Economic edge gate passed: gross 500 bps > hurdle 280 bps',
      timestamp: new Date(Date.now() - 5000).toISOString(),
    },
    {
      level: 'INFO',
      message: 'Journal committed buy_landed event with signature 4z..w8',
      timestamp: new Date(Date.now() - 10000).toISOString(),
    },
  ];

  return NextResponse.json({
    system_logs: systemLogs,
    audit_logs: getAuditLogs(),
  });
}
