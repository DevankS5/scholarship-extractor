"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Fx {
  slug: string;
  name: string;
  url: string;
  mode: string;
  hasVersionB: boolean;
  lead: boolean;
}

const MODES: [string, string][] = [["A", "Version A"], ["B", "Version B (changed)"], ["ERROR_503", "503 outage"], ["NOT_FOUND", "404"]];

export function DemoLab({ fixtures }: { fixtures: Fx[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function post(body: unknown) {
    setBusy(true);
    await fetch("/api/v1/fixtures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    router.refresh();
  }
  async function view(url: string) {
    const r = await fetch(`/api/v1/fixtures/view?url=${encodeURIComponent(url)}`);
    setPreview(`HTTP ${r.status}\n\n` + (await r.text()));
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-violet-50 p-3 text-xs text-violet-900">
        <b>Controlled demonstrations (SIMULATED providers — not real announcements).</b>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Run a crawl on <i>Simulated fixtures</i> (baseline). Run it again — no new versions or change events appear (idempotency).</li>
          <li>Switch <i>fx-dept-postmatric</i> and <i>fx-univ-phd</i> to “Version B”, crawl again → FIELD_CHANGED events with old/new values and evidence.</li>
          <li>Expired cases: <i>fx-dept-meritmeans</i> and <i>fx-univ-expired</i> publish past deadlines → lifecycle EXPIRED (record kept).</li>
          <li>Stale handling: switch <i>fx-trust-rolling</i> to “503 outage” and crawl three times with simulated clock +20d, +25d, +30d. One failure never removes a record; three failures past the 14-day grace period → NO_LONGER_VERIFIABLE.</li>
        </ol>
      </div>
      <button disabled={busy} onClick={() => post({ action: "reset" })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50">Reset all fixtures to version A</button>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left uppercase text-slate-500"><tr><th className="py-1">Fixture</th><th>Serving</th><th>Switch to</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {fixtures.map((f) => (
              <tr key={f.slug}>
                <td className="py-1.5 pr-2"><div className="font-medium">{f.slug}</div><div className="text-slate-500">{f.name}</div></td>
                <td><span className={`rounded px-1.5 py-0.5 ${f.mode === "A" ? "bg-slate-100" : "bg-amber-100 text-amber-800"}`}>{f.mode}</span></td>
                <td className="space-x-1 py-1">
                  {MODES.filter(([m]) => m !== "B" || f.hasVersionB).map(([m, label]) => (
                    <button key={m} disabled={busy || f.mode === m} onClick={() => post({ slug: f.slug, mode: m })} className="rounded border border-slate-300 px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-40">{label}</button>
                  ))}
                </td>
                <td><button onClick={() => view(f.url)} className="text-indigo-600 hover:underline">view source</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview && (
        <div>
          <button onClick={() => setPreview(null)} className="mb-1 text-xs text-slate-500 underline">close preview</button>
          <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-[11px] text-slate-100">{preview}</pre>
        </div>
      )}
    </div>
  );
}
