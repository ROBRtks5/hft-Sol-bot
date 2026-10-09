'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';

export default function AlertsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/alerts')
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-400" /> Operational Alerts & Notifications
          </h2>
          <p className="text-sm text-slate-400">Circuit breakers, feed warnings, and state reconciliation events</p>
        </div>
      </div>

      <div className="space-y-3">
        {data?.alerts?.map((alt: any) => (
          <div key={alt.id} className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-start gap-4">
            {alt.severity === 'CRITICAL' ? (
              <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            ) : alt.severity === 'WARNING' ? (
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-sm">{alt.title}</h4>
                <span className="text-xs text-slate-500 font-mono">{new Date(alt.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-slate-400 mt-1">{alt.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
