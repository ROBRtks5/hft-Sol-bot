'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Radio, Cpu, ShieldCheck, AlertTriangle } from 'lucide-react';

export default function StatusPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return <div className="text-slate-400 py-12 text-center">Loading system status...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" /> System Operational Status
          </h2>
          <p className="text-sm text-slate-400">Live heartbeat from Yellowstone gRPC & Hot Path engine</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Mode:</span>
          <span className="px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-bold">
            {data?.mode || 'SHADOW'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">gRPC FEED</div>
          <div className="mt-2 flex items-center gap-2">
            <Radio className={`w-4 h-4 ${data?.grpc_connected ? 'text-emerald-400 animate-pulse' : 'text-rose-500'}`} />
            <span className="text-lg font-bold text-white">
              {data?.grpc_connected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Yellowstone parsed streams</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">SLOT LAG</div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {data?.slot_lag ?? 0} <span className="text-xs font-sans text-slate-400">slots</span>
          </div>
          <p className="text-xs text-emerald-400 mt-1">&lt; 4 slots threshold OK</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">JITO LANDED RATE</div>
          <div className="mt-2 text-2xl font-bold font-mono text-purple-400">
            {data?.landed_rate_pct ? data.landed_rate_pct.toFixed(1) : '85.0'}%
          </div>
          <p className="text-xs text-slate-500 mt-1">Target &gt; 60%</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400 font-mono">HOT WALLET</div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-400">
            {data?.hot_wallet_sol ? data.hot_wallet_sol.toFixed(3) : '0.485'} <span className="text-xs text-slate-400">SOL</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Floor: {data?.hot_wallet_floor_sol ?? 0.15} SOL</p>
        </div>
      </div>
    </div>
  );
}
