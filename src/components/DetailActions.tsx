"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DetailActions({ id, hasPending, rejected }: { id: string; hasPending: boolean; rejected: boolean }) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [token, setToken] = useState("");
  const [rationale, setRationale] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? ok : j.error ?? "Request failed");
      if (r.ok) setTimeout(() => router.refresh(), url.endsWith("reverify") ? 3500 : 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <button disabled={busy} onClick={() => post(`/api/v1/scholarships/${id}/reverify`, {}, "Re-verification run started — page refreshes shortly.")} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
        Re-verify now
      </button>
      <div className="grid gap-2">
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Review token (REVIEW_TOKEN)" className="rounded-md border border-slate-300 px-2 py-1.5" />
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Reviewer name" className="rounded-md border border-slate-300 px-2 py-1.5" />
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Rationale (required, logged)" rows={2} className="rounded-md border border-slate-300 px-2 py-1.5" />
        <div className="flex flex-wrap gap-2">
          {hasPending && <button disabled={busy} onClick={() => post(`/api/v1/scholarships/${id}/review`, { reviewer, rationale, decision: "APPROVE_CHANGES" }, "Pending changes approved.")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50">Approve pending changes</button>}
          {!rejected && <button disabled={busy} onClick={() => post(`/api/v1/scholarships/${id}/review`, { reviewer, rationale, decision: "REJECT_RECORD" }, "Record rejected.")} className="rounded-md bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700 disabled:opacity-50">Reject record</button>}
          {rejected && <button disabled={busy} onClick={() => post(`/api/v1/scholarships/${id}/review`, { reviewer, rationale, decision: "RESTORE_RECORD" }, "Record restored to the verifier's decision.")} className="rounded-md bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-50">Restore record</button>}
        </div>
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
