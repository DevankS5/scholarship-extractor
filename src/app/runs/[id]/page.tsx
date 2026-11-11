import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Metric, fmtDateTime } from "@/components/ui";
import { getRun } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getRun(id);
  if (!r) notFound();
  return (
    <div className="space-y-5">
      <Link href="/runs" className="text-sm text-indigo-600 hover:underline">← All runs</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Run {r.id.slice(0, 8)}</h1>
        <Badge tone={r.status === "SUCCESS" ? "green" : r.status === "RUNNING" ? "blue" : r.status === "PARTIAL" ? "amber" : "red"}>{r.status}</Badge>
        {r.simulatedNow && <Badge tone="violet">simulated clock {r.simulatedNow.toISOString().slice(0, 10)}</Badge>}
      </div>
      <p className="text-sm text-slate-600">Started {fmtDateTime(r.startedAt)} · finished {fmtDateTime(r.finishedAt)} · trigger {r.triggerType} · scope {r.scope} · config v{r.configVersion}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Seeds" value={r.seedCount} />
        <Metric label="New candidates" value={r.candidateCount} />
        <Metric label="Pages attempted" value={r.pagesAttempted} />
        <Metric label="Fetch ok / failed" value={`${r.fetchSuccessCount} / ${r.fetchFailureCount}`} />
        <Metric label="Extracted" value={r.extractionSuccessCount} />
        <Metric label="Persisted" value={r.persistedCount} />
        <Metric label="Verified" value={r.verifiedCount} />
        <Metric label="Review required" value={r.reviewRequiredCount} />
        <Metric label="Change events" value={r.changeEventCount} />
      </div>
      {r.errorSummary.length > 0 && (
        <Card title="Errors">
          <ul className="list-disc space-y-1 pl-5 text-sm text-rose-700">{r.errorSummary.map((e, i) => <li key={i} className="break-all">{e}</li>)}</ul>
        </Card>
      )}
      <Card title="Run log"><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs text-slate-700">{r.log.join("\n") || "(empty)"}</pre></Card>
    </div>
  );
}
