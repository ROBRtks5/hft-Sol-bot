import { NextResponse } from 'next/server';

export interface PositionRecord {
  mint: string;
  symbol: string;
  status: 'OPEN' | 'PARTIAL_TIER1' | 'EXITING' | 'CLOSED';
  entry_slot: number;
  entry_price_sol: number;
  entry_sol: number;
  tokens_acquired: number;
  remaining_tokens: number;
  current_price_sol: number;
  unrealized_pnl_bps: number;
  unrealized_pnl_sol: number;
  held_slots: number;
  has_pending_exit: boolean;
}

export async function GET() {
  // Returns read-only snapshot of current position (0 or 1 active)
  const activePosition: PositionRecord[] = [
    {
      mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
      symbol: 'POPCAT',
      status: 'OPEN',
      entry_slot: 285_120_350,
      entry_price_sol: 0.0000000342,
      entry_sol: 0.03,
      tokens_acquired: 877_192,
      remaining_tokens: 877_192,
      current_price_sol: 0.0000000378,
      unrealized_pnl_bps: 1052,
      unrealized_pnl_sol: 0.00315,
      held_slots: 90,
      has_pending_exit: false,
    },
  ];

  return NextResponse.json({
    active_position: activePosition.length > 0 ? activePosition[0] : null,
    max_concurrent_positions: 1,
    can_open_new_position: activePosition.length === 0,
    historical_positions_today: 8,
  });
}
