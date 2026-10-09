'use client';

import React, { useEffect, useState } from 'react';
import { BarChart2, TrendingUp, DollarSign, ArrowDownRight } from 'lucide-react';

export default function PnlPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/pnl')
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="py-12 text-center text-slate-400">Loading PnL metrics...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-purple-400" /> PnL & Financial Performance
          </h2>
          <p className="text-sm text-slate-400">Net performance after all Jito tips, DEX fees, and signature friction</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">DAILY REALIZED PnL</div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">
            +{data?.daily_realized_sol} <span className="text-xs text-slate-400">SOL</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{data?.daily_trades_count} flips executed today</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">WIN RATE</div>
          <div className="mt-2 text-2xl font-bold font-mono text-purple-400">
            {data?.win_rate_pct}%
          </div>
          <p className="text-xs text-slate-500 mt-1">{data?.winning_trades}W / {data?.losing_trades}L</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">PROFIT FACTOR</div>
          <div className="mt-2 text-2xl font-bold font-mono text-blue-400">
            {data?.profit_factor}
          </div>
          <p className="text-xs text-slate-500 mt-1">Gross Wins / Gross Losses</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">CURRENT DRAWDOWN</div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-400">
            -{data?.current_drawdown_sol} <span className="text-xs text-slate-400">SOL</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Max DD Cap: 0.10 SOL</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <h3 className="font-bold text-white text-base">Recent Closed Flips</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs text-slate-400 font-mono">
              <tr>
                <th className="pb-3">TRADE ID</th>
                <th className="pb-3">TOKEN MINT</th>
                <th className="pb-3">SIZE</th>
                <th className="pb-3">NET PnL</th>
                <th className="pb-3">ROI</th>
                <th className="pb-3">EXIT REASON</th>
                <th className="pb-3">HELD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data?.recent_trades?.map((t: any) => (
                <tr key={t.id} className="hover:bg-slate-800/30">
                  <td className="py-3 font-mono text-xs text-slate-400">{t.id}</td>
                  <td className="py-3 font-mono text-xs text-white">{t.mint.substring(0, 8)}...</td>
                  <td className="py-3 font-mono text-xs text-slate-300">{t.entry_sol} SOL</td>
                  <td className={`py-3 font-mono text-xs font-bold ${t.net_pnl_sol >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.net_pnl_sol >= 0 ? '+' : ''}{t.net_pnl_sol} SOL
                  </td>
                  <td className={`py-3 font-mono text-xs ${t.roi_bps >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.roi_bps >= 0 ? '+' : ''}{(t.roi_bps / 100).toFixed(1)}%
                  </td>
                  <td className="py-3 text-xs text-slate-300">{t.exit_reason}</td>
                  <td className="py-3 font-mono text-xs text-slate-400">{t.hold_slots} slots</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
