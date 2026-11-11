import { Badge, Card, FixtureBadge } from "@/components/ui";
import { parseScope } from "@/lib/http";
import { listCandidates, listSourcesWithStats } from "@/lib/services/queries";
import { syncSourceRegistry } from "@/lib/services/registry";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Sources({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await syncSourceRegistry();
  const [sources, cands] = await Promise.all([
    listSourcesWithStats(),
    listCandidates({ status: sp.status, classification: sp.classification, scope: parseScope(sp.scope), page: Number(sp.page ?? 1), pageSize: 60 }),
  ]);
  const statuses = ["PERSISTED", "NOT_SCHOLARSHIP_PAGE", "DISCOVERED", "DUPLICATE_LEAD", "FETCH_FAILED", "SKIPPED_ROBOTS", "DEFERRED", "QUEUED"];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Source registry &amp; discovery candidates</h1>
      <Card title="Source registry (config/source_policy.yaml)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Source</th><th>Type</th><th>Authority</th><th>Official domains</th><th>Enabled</th><th>Reviewed</th><th>Candidates</th><th>Records</th><th>Verified</th></tr></thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {sources.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-2"><div className="font-medium">{s.name}</div><div className="max-w-xs text-xs text-slate-500">{s.rationale}</div>{s.isFixture && <FixtureBadge />}</td>
                  <td className="pr-2 text-xs">{s.sourceType.replace(/_/g, " ")}</td>
                  <td><Badge tone={s.authorityLevel === "PRIMARY" ? "green" : "violet"}>{s.authorityLevel}</Badge></td>
                  <td className="pr-2 text-xs">{s.officialDomains.join(", ")}</td>
                  <td>{s.enabled ? <Badge tone="green">on</Badge> : <Badge>off</Badge>}</td>
                  <td>{s.reviewed ? <Badge tone="green">{s.reviewedOn}</Badge> : <Badge tone="amber">unreviewed</Badge>}</td>
                  <td>{s.candidates}</td><td>{s.records}</td><td>{s.verified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`Discovered candidates (${cands.total})`}>
        <div className="mb-3 flex flex-wrap gap-1 text-xs">
          <Link className="rounded border px-2 py-1 hover:bg-slate-100" href="/sources">all</Link>
          {statuses.map((s) => <Link key={s} className="rounded border px-2 py-1 hover:bg-slate-100" href={`/sources?status=${s}`}>{s.replace(/_/g, " ").toLowerCase()}</Link>)}
          <Link className="rounded border px-2 py-1 hover:bg-slate-100" href="/sources?classification=LEAD">leads only</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="text-left uppercase text-slate-500"><tr><th className="py-1">URL</th><th>Method</th><th>Class</th><th>Score</th><th>Status</th><th>Seen</th><th>Found on</th></tr></thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {cands.items.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-sm break-all py-1.5 pr-2">{c.scholarshipId ? <Link className="text-indigo-600 hover:underline" href={`/scholarships/${c.scholarshipId}`}>{c.candidateTitle ?? c.normalizedUrl}</Link> : c.normalizedUrl}{c.isFixture && <> <FixtureBadge /></>}</td>
                  <td>{c.discoveryMethod}</td>
                  <td><Badge tone={c.classification === "OFFICIAL" ? "green" : c.classification === "LEAD" ? "violet" : "slate"}>{c.classification}</Badge></td>
                  <td>{c.relevanceScore}</td>
                  <td><div>{c.processingStatus}</div><div className="max-w-xs text-slate-500">{c.statusReason}</div></td>
                  <td>{c.timesSeen}×</td>
                  <td className="max-w-xs break-all text-slate-500">{c.discoverySourceUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">Relevance score only prioritises fetching; it is never shown as verification confidence. Aggregator-originated candidates are leads and cannot reach VERIFIED.</p>
      </Card>
    </div>
  );
}
