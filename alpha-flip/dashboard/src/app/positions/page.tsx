'use client';

import React, { useEffect, useState } from 'react';
import { Shield, Clock, TrendingUp, AlertCircle } from 'lucide-react';

export default function PositionsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/positions')
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      });
  }, []);

  const pos = data?.active_position;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" /> Active Position (Strict 1-Position Invariant)
          </h2>
          <p className="text-sm text-slate-400">Zero parallel holdings. Instant capital velocity.</p>
        </div>
        <div className="px-3 py-1 rounded bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300">
          Capacity: {pos ? '1/1 (OCCUPIED)' : '0/1 (IDLE - READY)'}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400">Loading position state...</div>
      ) : pos ? (
        <div className="rounded-xl border border-blue-500/30 bg-blue-950/10 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <div className="text-xs text-blue-400 font-mono">TOKEN MINT</div>
              <div className="text-lg font-bold font-mono text-white mt-1">{pos.mint}</div>
              <div className="text-xs text-slate-400">{pos.symbol} • Entry Slot #{pos.entry_slot}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400 font-mono">UNREALIZED PnL</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                +{pos.unrealized_pnl_bps / 100}%
              </div>
              <div className="text-xs text-emerald-400/80">+{pos.unrealized_pnl_sol} SOL</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">Entry Capital</div>
              <div className="text-base font-bold font-mono text-white mt-1">{pos.entry_sol} SOL</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">Remaining Tokens</div>
              <div className="text-base font-bold font-mono text-white mt-1">{pos.remaining_tokens.toLocaleString()}</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">Held Duration</div>
              <div className="text-base font-bold font-mono text-white mt-1">{pos.held_slots} slots (~36s)</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">Time-Stop Cap</div>
              <div className="text-base font-bold font-mono text-amber-400 mt-1">300 slots max</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-slate-500">
          No position currently open. Scanning Yellowstone stream for fresh momentum signals.
        </div>
      )}
    </div>
  );
}
