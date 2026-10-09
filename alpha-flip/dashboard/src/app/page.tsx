import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-4">
        <h2 className="text-2xl font-bold text-white">Alpha-Flip v3.2 Mission Control</h2>
        <p className="text-slate-400 max-w-xl mx-auto">
          Read-only telemetry and authorized incident management dashboard for the hot deterministic Solana execution daemon.
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <Link href="/status" className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white shadow-lg transition">
            View Live Status
          </Link>
          <Link href="/positions" className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 font-semibold text-slate-200 transition">
            Inspect Position
          </Link>
        </div>
      </div>
    </div>
  );
}
