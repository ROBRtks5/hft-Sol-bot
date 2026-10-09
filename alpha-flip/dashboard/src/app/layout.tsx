import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Shield, Activity, BarChart2, AlertCircle, FileText, Settings } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Alpha-Flip v3.2 Operations Dashboard',
  description: 'Read-only mission control for Alpha-Flip Solana momentum flip bot',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased">
        <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
              AF
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-wide text-white">Alpha-Flip v3.2</h1>
              <p className="text-xs text-slate-400 font-mono">Autonomous Solana Momentum Flip Engine</p>
            </div>
          </div>

          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link href="/status" className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-400" /> Status
            </Link>
            <Link href="/positions" className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-blue-400" /> Position
            </Link>
            <Link href="/pnl" className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1.5">
              <BarChart2 className="w-4 h-4 text-purple-400" /> PnL
            </Link>
            <Link href="/alerts" className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-400" /> Alerts
            </Link>
            <Link href="/logs" className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-slate-400" /> Logs
            </Link>
            <Link href="/controls" className="px-3 py-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-rose-400" /> Controls
            </Link>
          </nav>
        </header>

        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
