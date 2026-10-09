import { NextResponse } from 'next/server';

export interface PnlSummary {
  daily_realized_sol: number;
  daily_trades_count: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  profit_factor: number;
  total_friction_sol: number;
  peak_equity_sol: number;
  current_drawdown_sol: number;
  max_drawdown_sol: number;
  recent_trades: Array<{
    id: string;
    mint: string;
    entry_sol: number;
    exit_sol: number;
    net_pnl_sol: number;
    roi_bps: number;
    exit_reason: string;
    hold_slots: number;
    timestamp: string;
  }>;
}

export async function GET() {
  const pnl: PnlSummary = {
    daily_realized_sol: 0.0425,
    daily_trades_count: 5,
    winning_trades: 4,
    losing_trades: 1,
    win_rate_pct: 80.0,
    profit_factor: 3.82,
    total_friction_sol: 0.0082,
    peak_equity_sol: 0.0450,
    current_drawdown_sol: 0.0025,
    max_drawdown_sol: 0.0051,
    recent_trades: [
      {
        id: 'trade_5',
        mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        entry_sol: 0.03,
        exit_sol: 0.0354,
        net_pnl_sol: 0.0041,
        roi_bps: 1360,
        exit_reason: 'TakeProfitLadderTier1',
        hold_slots: 64,
        timestamp: '14:22:10 UTC',
      },
      {
        id: 'trade_4',
        mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        entry_sol: 0.03,
        exit_sol: 0.0381,
        net_pnl_sol: 0.0068,
        roi_bps: 2266,
        exit_reason: 'TakeProfitLadderTier2',
        hold_slots: 112,
        timestamp: '14:05:42 UTC',
      },
      {
        id: 'trade_3',
        mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
        entry_sol: 0.03,
        exit_sol: 0.0288,
        net_pnl_sol: -0.0019,
        roi_bps: -633,
        exit_reason: 'HardStopLoss',
        hold_slots: 22,
        timestamp: '13:48:19 UTC',
      },
    ],
  };

  return NextResponse.json(pnl);
}
