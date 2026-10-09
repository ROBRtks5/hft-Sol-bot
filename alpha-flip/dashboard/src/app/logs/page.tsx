'use client';

import React, { useEffect, useState } from 'react';
import { FileText, Terminal, Shield } from 'lucide-react';

export default function LogsPage() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'system' | 'audit'>('system');

  useEffect(() => {
    fetch('/api/logs')
      .then((res) => res.json())
      .then((json) => setData(json));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-400" /> System & Audit Logs
          </h2>
          <p className="text-sm text-slate-400">Deterministic event streams and authenticated operator audit trail</p>
        </div>
        <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-1">
          <button
            onClick={() => setTab('system')}
            className={`px-3 py-1 rounded text-xs font-semibold transition ${tab === 'system' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            System Logs
          </button>
          <button
            onClick={() => setTab('audit')}
            className={`px-3 py-1 rounded text-xs font-semibold transition ${tab === 'audit' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            Audit Trail
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs overflow-x-auto min-h-[350px]">
        {tab === 'system' ? (
          <div className="space-y-2">
            {data?.system_logs?.map((l: any, i: number) => (
              <div key={i} className="flex gap-4 text-slate-300">
                <span className="text-slate-500 shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span>
                <span className={l.level === 'INFO' ? 'text-blue-400' : 'text-slate-400'}>[{l.level}]</span>
                <span>{l.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {data?.audit_logs?.length > 0 ? (
              data.audit_logs.map((a: any, i: number) => (
                <div key={i} className="flex gap-4 text-slate-300">
                  <span className="text-slate-500 shrink-0">{new Date(a.timestamp).toLocaleTimeString()}</span>
                  <span className="text-purple-400">[{a.action}]</span>
                  <span className="text-amber-400">{a.operator}</span>
                  <span className={a.status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}>[{a.status}]</span>
                  <span>{a.reason}</span>
                </div>
              ))
            ) : (
              <div className="text-slate-500 py-12 text-center">No operator control actions recorded yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
