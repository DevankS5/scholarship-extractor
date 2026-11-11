import Link from "next/link";
import { DemoLab } from "@/components/DemoLab";
import { RunControls } from "@/components/RunControls";
import { Badge, Card, fmtDateTime } from "@/components/ui";
import { listFixtureStates } from "@/lib/crawling/fixtures";
import { listRuns } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function Runs() {
  const [runs, fixtures] = await Promise.all([listRuns(30), listFixtureStates()]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Crawl runs &amp; demo lab</h1>
      <Card title="Start a crawl"><RunControls /></Card>
      <Card title="Run history">
        {runs.length === 0 ? <p className="text-sm text-slate-500">No runs yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-1">Started</th><th>Trigger</th><th>Scope</th><th>Status</th><th>Pages</th><th>OK / fail</th><th>Extracted</th><th>Verified</th><th>Review</th><th>Changes</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5"><Link className="text-indigo-600 hover:underline" href={`/runs/${r.id}`}>{fmtDateTime(r.startedAt)}</Link>{r.simulatedNow && <Badge tone="violet">sim clock {r.simulatedNow.toISOString().slice(0, 10)}</Badge>}</td>
                    <td>{r.triggerType}</td><td>{r.scope}</td>
                    <td><Badge tone={r.status === "SUCCESS" ? "green" : r.status === "RUNNING" ? "blue" : r.status === "PARTIAL" ? "amber" : "red"}>{r.status}</Badge></td>
                    <td>{r.pagesAttempted}</td><td>{r.fetchSuccessCount} / {r.fetchFailureCount}</td><td>{r.extractionSuccessCount}</td><td>{r.verifiedCount}</td><td>{r.reviewRequiredCount}</td><td>{r.changeEventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Demo lab — simulated fixture providers"><DemoLab fixtures={fixtures} /></Card>
    </div>
  );
}
