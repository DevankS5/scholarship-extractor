import Link from "next/link";
import { AuthorityBadge, Badge, Card, FixtureBadge, LifecycleBadge, Metric, VerificationBadge, fmtDate, fmtDateTime } from "@/components/ui";
import { STATES } from "@/lib/extraction/extractor";
import { parseScope, parseSearchParams } from "@/lib/http";
import { getMetrics, searchScholarships } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

const LEVELS = ["SCHOOL", "DIPLOMA", "UNDERGRADUATE", "POSTGRADUATE", "DOCTORAL"];
const PROVIDERS = ["GOVERNMENT", "UNIVERSITY", "CSR", "NGO_TRUST", "INTERNATIONAL", "OTHER", "UNKNOWN"];
const LIFECYCLES = ["ACTIVE", "EXPIRING_SOON", "UPCOMING", "EXPIRED", "CLOSED", "NO_LONGER_VERIFIABLE", "REMOVED", "UNKNOWN"];
const CATEGORIES = ["SC", "ST", "OBC", "EWS", "MINORITY", "PWD"];

type SP = Record<string, string | string[] | undefined>;

function qs(sp: SP, over: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...over })) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function Select({ name, label, options, value }: { name: string; label: string; options: string[]; value?: string }) {
  return (
    <label className="block text-xs text-slate-600">
      {label}
      <select name={name} defaultValue={value ?? ""} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
        ))}
      </select>
    </label>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const params = parseSearchParams(sp);
  const scope = parseScope(typeof sp.scope === "string" ? sp.scope : undefined);
  const [metrics, result] = await Promise.all([getMetrics(scope), searchScholarships({ ...params, scope })]);
  const m = metrics.scholarships;
  const c = metrics.candidates;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const real = metrics.split.find((s) => !s.is_fixture);
  const fx = metrics.split.find((s) => s.is_fixture);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Scholarship intelligence dashboard</h1>
          <p className="text-sm text-slate-600">Every number below is computed from the persisted database. Unknown stays unknown; review-required is an honest output.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {(["all", "real", "fixture"] as const).map((s) => (
            <Link key={s} href={`/${qs(sp, { scope: s === "all" ? undefined : s, page: undefined })}`} className={`rounded-md px-3 py-1 ${scope === s ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {s === "all" ? "All data" : s === "real" ? "Real sources" : "Fixtures only"}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Candidates discovered" value={c.discovered} hint={`${c.leads} lead(s) from secondary sources`} />
        <Metric label="Unique scholarships" value={m.total} hint={`${c.persisted} candidate pages persisted`} />
        <Metric label="Verified (≥95 + gates)" value={m.verified} tone="text-emerald-700" hint={`${m.verified_95} at ≥95`} />
        <Metric label="Review required" value={m.review_required} tone="text-amber-700" hint={`${m.pending_changes} with pending changes`} />
        <Metric label="Primary-source checked" value={m.primary_checked} hint="authority confirmed" />
        <Metric label="Avg. confidence" value={m.avg_confidence} hint="excludes rejected" />
        <Metric label="Active" value={m.active} />
        <Metric label="Upcoming" value={m.upcoming} />
        <Metric label="Expiring soon" value={m.expiring_soon} />
        <Metric label="Expired" value={m.expired} />
        <Metric label="No longer verifiable" value={m.no_longer_verifiable} hint={`${m.removed} removed · ${m.closed} closed`} />
        <Metric label="Recently changed (7d)" value={m.recently_changed} hint={`${metrics.changes.field_changes} field change event(s)`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Honest coverage" className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-1">Data set</th><th>Records</th><th>Primary-checked</th><th>Verified</th><th>Review required</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-1.5">Real sources</td><td>{real?.records ?? 0}</td><td>{real?.primary_checked ?? 0}</td><td>{real?.verified ?? 0}</td><td>{real?.review_required ?? 0}</td></tr>
              <tr><td className="py-1.5"><span className="mr-2">Simulated fixtures</span><FixtureBadge /></td><td>{fx?.records ?? 0}</td><td>{fx?.primary_checked ?? 0}</td><td>{fx?.verified ?? 0}</td><td>{fx?.review_required ?? 0}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Fixture records exercise the full pipeline offline (change detection, expiry, stale handling) and are <b>never</b> counted as real scholarships. Real-source counts only grow when live crawling reaches provider pages that pass every gate.
          </p>
        </Card>
        <Card title="Pipeline status">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Latest run</dt><dd>{metrics.latestRun ? <Link className="text-indigo-600 hover:underline" href={`/runs/${metrics.latestRun.id}`}>{metrics.latestRun.status}</Link> : "none yet"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Last successful crawl</dt><dd>{fmtDateTime(metrics.lastSuccessfulCrawlAt)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Source categories</dt><dd>{m.source_categories}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Discovery mechanisms used</dt><dd>{c.methods}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Fetch failures (candidates)</dt><dd>{c.fetch_failed}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Accepted field changes</dt><dd>{metrics.changes.accepted_field_changes}</dd></div>
          </dl>
          {m.total === 0 && (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              No records yet. Open <Link href="/runs" className="underline">Crawl runs &amp; Demo lab</Link> and start a crawl.
            </p>
          )}
        </Card>
      </div>

      <Card title="Search & filters">
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {scope !== "all" && <input type="hidden" name="scope" value={scope} />}
          <label className="col-span-2 block text-xs text-slate-600">
            Search name, provider, description, eligibility
            <input name="q" defaultValue={params.q ?? ""} placeholder="e.g. merit, fellowship, income…" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <Select name="verification_status" label="Verification" options={["VERIFIED", "REVIEW_REQUIRED", "REJECTED"]} value={params.verification_status} />
          <Select name="lifecycle_status" label="Lifecycle" options={LIFECYCLES} value={params.lifecycle_status} />
          <Select name="provider_type" label="Provider type" options={PROVIDERS} value={params.provider_type} />
          <Select name="education_level" label="Education level" options={LEVELS} value={params.education_level} />
          <Select name="state" label="State / domicile" options={STATES} value={params.state} />
          <Select name="category" label="Category" options={CATEGORIES} value={params.category} />
          <label className="block text-xs text-slate-600">
            Min confidence
            <input name="min_confidence" type="number" min={0} max={100} defaultValue={params.min_confidence ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs text-slate-600">
            Deadline from
            <input name="deadline_from" type="date" defaultValue={params.deadline_from ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs text-slate-600">
            Deadline to
            <input name="deadline_to" type="date" defaultValue={params.deadline_to ?? ""} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <Select name="verified_within_days" label="Last verified" options={["1", "7", "30"]} value={params.verified_within_days?.toString()} />
          <label className="block text-xs text-slate-600">
            Sort
            <select name="sort" defaultValue={params.sort ?? ""} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
              <option value="">Recently updated</option>
              <option value="deadline">Deadline (soonest)</option>
              <option value="confidence">Confidence (high → low)</option>
              <option value="verified">Last verified</option>
              <option value="changed">Recently changed</option>
            </select>
          </label>
          <div className="col-span-2 flex items-end gap-2">
            <button className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Apply</button>
            <Link href="/" className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Reset</Link>
          </div>
        </form>
      </Card>

      <Card title={`Scholarships (${result.total})`} right={<a className="text-xs text-indigo-600 hover:underline" href={`/api/v1/export${scope !== "all" ? `?scope=${scope}` : ""}`}>Export JSON</a>}>
        {result.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No scholarships match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-2">Scholarship</th><th>Provider</th><th>Deadline</th><th>Verification</th><th>Lifecycle</th><th>Confidence</th><th>Authority</th><th>Last verified</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.items.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50">
                    <td className="max-w-sm py-2 pr-3">
                      <Link href={`/scholarships/${r.id}`} className="font-medium text-indigo-700 hover:underline">{r.name}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.isFixture && <FixtureBadge />}
                        {r.flags.includes("PENDING_REVIEW") && <Badge tone="amber">pending change</Badge>}
                        {r.lastChangedAt && new Date(r.lastChangedAt).getTime() > Date.now() - 7 * 86400000 && <Badge tone="blue">recently changed</Badge>}
                      </div>
                    </td>
                    <td className="pr-3">{r.providerName ?? <span className="text-slate-400">Not specified</span>}<div className="text-xs text-slate-500">{r.providerType.replace(/_/g, " ")}</div></td>
                    <td className="pr-3 whitespace-nowrap">{r.closingDate ? fmtDate(r.closingDate) : <span className="text-slate-400">Not specified</span>}</td>
                    <td className="pr-3"><VerificationBadge status={r.verificationStatus} /></td>
                    <td className="pr-3"><LifecycleBadge status={r.lifecycleStatus} /></td>
                    <td className="pr-3 font-mono">{r.confidenceScore.toFixed(1)}</td>
                    <td className="pr-3"><AuthorityBadge authority={r.authority} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(r.lastVerifiedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">Page {result.page} of {pages}</span>
            <div className="flex gap-2">
              {result.page > 1 && <Link className="rounded-md border px-3 py-1 hover:bg-slate-100" href={`/${qs(sp, { page: String(result.page - 1) })}`}>Previous</Link>}
              {result.page < pages && <Link className="rounded-md border px-3 py-1 hover:bg-slate-100" href={`/${qs(sp, { page: String(result.page + 1) })}`}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
