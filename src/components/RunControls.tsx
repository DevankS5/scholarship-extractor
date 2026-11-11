"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface RunInfo {
  id: string;
  status: string;
  pagesAttempted: number;
  fetchSuccessCount: number;
  fetchFailureCount: number;
  persistedCount: number;
  verifiedCount: number;
  reviewRequiredCount: number;
  changeEventCount: number;
  log: string[];
}

export function RunControls() {
  const router = useRouter();
  const [scope, setScope] = useState("ALL");
  const [asOf, setAsOf] = useState("");
  const [run, setRun] = useState<RunInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function start() {
    setErr(null);
    const r = await fetch("/api/v1/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, asOf: asOf || undefined }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? "Could not start run");
    const poll = async () => {
      const x = await fetch(`/api/v1/runs/${j.runId}`, { cache: "no-store" });
      if (!x.ok) return;
      const info = (await x.json()) as RunInfo;
      setRun(info);
      if (info.status !== "RUNNING") {
        if (timer.current) clearInterval(timer.current);
        router.refresh();
      }
    };
    await poll();
    timer.current = setInterval(poll, 1500);
  }

  const running = run?.status === "RUNNING";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">Scope
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="ALL">All sources (live + simulated fixtures)</option>
            <option value="LIVE">Live sources only</option>
            <option value="FIXTURES">Simulated fixtures only</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Simulated clock (optional)
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <button onClick={start} disabled={running} className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {running ? "Crawl running…" : "Start crawl"}
        </button>
      </div>
      <p className="text-xs text-slate-500">Live crawls respect robots.txt, per-domain delays and a page budget, so they can take a few minutes. A simulated clock is only for demos and is labelled on every event it creates.</p>
      {err && <p className="rounded-md bg-rose-50 p-2 text-rose-700">{err}</p>}
      {run && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap gap-4 text-xs">
            <b>Run {run.id.slice(0, 8)} — {run.status}</b>
            <span>pages {run.pagesAttempted}</span><span>ok {run.fetchSuccessCount}</span><span>failed {run.fetchFailureCount}</span>
            <span>persisted {run.persistedCount}</span><span>verified {run.verifiedCount}</span><span>review {run.reviewRequiredCount}</span><span>changes {run.changeEventCount}</span>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">{run.log.slice(-25).join("\n")}</pre>
        </div>
      )}
    </div>
  );
}
