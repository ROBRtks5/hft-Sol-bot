'use client';

import React, { useState } from 'react';
import { Settings, Lock, AlertOctagon, PauseCircle, PlayCircle, ShieldAlert } from 'lucide-react';

export default function ControlsPage() {
  const [token, setToken] = useState('');
  const [operator, setOperator] = useState('lead_quant');
  const [action, setAction] = useState<'PAUSE' | 'KILL' | 'RESUME'>('PAUSE');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmed) {
      setError('You must check the explicit confirmation box before submitting.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/controls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          operator,
          confirmation: `CONFIRM_${action}`,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setResult(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-rose-400" /> Authorized Operator Controls
        </h2>
        <p className="text-sm text-slate-400">
          State machine command interface. Requires Bearer authorization token and explicit confirmation.
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <strong>STRICT SECURITY INVARIANT:</strong> Direct trade execution is strictly forbidden from this dashboard.
          Controls are restricted to operating mode transitions (PAUSE, RESUME, and EMERGENCY KILL).
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">OPERATOR AUTH TOKEN</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter DASHBOARD_AUTH_TOKEN..."
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-300 mb-1">OPERATOR IDENTIFIER</label>
          <input
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-300 mb-2">TARGET ACTION</label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setAction('PAUSE')}
              className={`p-3 rounded-lg border text-xs font-bold font-mono transition flex flex-col items-center gap-2 ${
                action === 'PAUSE'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
              }`}
            >
              <PauseCircle className="w-5 h-5" /> PAUSE
            </button>

            <button
              type="button"
              onClick={() => setAction('RESUME')}
              className={`p-3 rounded-lg border text-xs font-bold font-mono transition flex flex-col items-center gap-2 ${
                action === 'RESUME'
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
              }`}
            >
              <PlayCircle className="w-5 h-5" /> RESUME
            </button>

            <button
              type="button"
              onClick={() => setAction('KILL')}
              className={`p-3 rounded-lg border text-xs font-bold font-mono transition flex flex-col items-center gap-2 ${
                action === 'KILL'
                  ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
              }`}
            >
              <AlertOctagon className="w-5 h-5" /> KILL SWITCH
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <input
            type="checkbox"
            id="confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
          />
          <label htmlFor="confirm" className="text-xs text-slate-300 cursor-pointer">
            I confirm commanding <strong>{action}</strong> on the Alpha-Flip state machine.
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2.5 rounded-lg font-bold text-sm text-white shadow-lg transition ${
            action === 'KILL'
              ? 'bg-rose-600 hover:bg-rose-500'
              : action === 'PAUSE'
              ? 'bg-amber-600 hover:bg-amber-500'
              : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          {loading ? 'Transmitting Command...' : `Execute ${action} Command`}
        </button>

        {error && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-400 font-mono">
            {error}
          </div>
        )}

        {result && (
          <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-400 font-mono">
            {result.message} (Timestamp: {result.timestamp})
          </div>
        )}
      </form>
    </div>
  );
}
