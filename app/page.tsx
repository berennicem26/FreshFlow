export default function Home() {
  return (
    <main className="min-h-screen p-8 max-w-7xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🍎</span>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-400">FreshFlow</h1>
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Intelligent Spoilage & Dynamic Markdown Hub
          </span>
        </div>
        <p className="text-sm text-slate-400">
          Autonomous perishables markdown engine and food bank donation router preventing retail grocery waste.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-slate-200">System Ready for Kiro Agentic Engineering</h2>
        <p className="text-sm text-slate-400 mt-1">
          Open this repository in Kiro to initiate the EARS specification, steering documents, and dynamic repricing workflows.
        </p>
      </section>
    </main>
  );
}
