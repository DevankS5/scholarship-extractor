import Link from "next/link";
import { notFound } from "next/navigation";
import { DetailActions } from "@/components/DetailActions";
import { AuthorityBadge, Badge, Card, FixtureBadge, LifecycleBadge, NOT_SPECIFIED, VerificationBadge, fmtDate, fmtDateTime, fmtValue } from "@/components/ui";
import { getScholarshipDetail } from "@/lib/services/queries";
import { COMPONENT_MAX } from "@/lib/verification/verifier";

export const dynamic = "force-dynamic";

const COMPONENT_LABEL: Record<string, string> = {
  authority: "A · Official source authority", presence: "B · Current official presence", critical_fields: "C · Critical-field evidence",
  application: "D · Application pathway", freshness: "E · Freshness", consistency: "F · Consistency", provenance: "G · Provenance",
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name", provider_name: "Provider", academic_cycle: "Academic cycle", description: "Description", amount: "Benefit amount", benefit_type: "Benefit type",
  closing_date: "Closing date", opening_date: "Opening date", eligibility_summary: "Eligibility", income_criteria: "Income criteria", academic_requirements: "Academic requirements",
  education_levels: "Education levels", category_criteria: "Category criteria", gender_criteria: "Gender criteria", domicile_requirements: "Domicile / state",
  documents_required: "Documents required", selection_process: "Selection process", renewal_requirements: "Renewal requirements", application_instructions: "Application instructions",
  application_url: "Application URL", terms_url: "Terms / guidelines URL", india_eligibility: "Eligibility for applicants from India",
};
const SHOW_ABSENT = ["income_criteria", "closing_date", "amount", "application_url", "gender_criteria", "domicile_requirements", "renewal_requirements", "documents_required"];

function supportTone(s: string) {
  return s === "SUPPORTED" ? "green" : s === "PARTIALLY_SUPPORTED" ? "amber" : s === "CONFLICTING" ? "red" : "slate";
}

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getScholarshipDetail(id);
  if (!d) notFound();
  const s = d.scholarship;
  const v = d.latestVerification;
  const pending = d.changes.filter((c) => c.resolution === "PENDING_REVIEW");
  const snap = (d.versions.find((x) => x.id === s.currentVersionId) ?? d.versions[0])?.recordSnapshot ?? {};
  const evByField = new Map(d.fieldEvidence.map((x) => [x.fe.fieldName, x]));
  const evidenceFields = Object.keys(FIELD_LABEL).filter((k) => evByField.has(k));
  const absent = SHOW_ABSENT.filter((k) => !evByField.has(k) && (k !== "closing_date" || !v?.fieldResults.deadline?.includes("CONFLICT")));
  const conflictDeadline = v?.fieldResults.deadline === "CONFLICTING";

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">← Back to dashboard</Link>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <VerificationBadge status={s.verificationStatus} />
              <LifecycleBadge status={s.lifecycleStatus} />
              <AuthorityBadge authority={s.authority} />
              <Badge tone="slate">{s.providerType.replace(/_/g, " ")}</Badge>
              {s.isFixture && <FixtureBadge />}
              {s.flags.map((f) => <Badge key={f} tone="amber">{f.replace(/_/g, " ")}</Badge>)}
            </div>
            <h1 className="text-2xl font-semibold">{s.name}</h1>
            <p className="text-slate-600">{s.providerName ?? "Provider not specified"}{s.academicCycle ? ` · ${s.academicCycle}` : ""}</p>
            {s.statusReason && <p className="mt-2 text-sm text-slate-600"><b>Lifecycle reason:</b> {s.statusReason}</p>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-slate-500">Rule-based confidence</div>
            <div className="text-4xl font-semibold tabular-nums">{s.confidenceScore.toFixed(1)}</div>
            <div className="text-xs text-slate-500">policy v{s.confidencePolicyVersion ?? "—"} · threshold 95</div>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-xs uppercase text-slate-500">Closing date</dt><dd>{s.closingDate ? fmtDate(s.closingDate) : <span className="text-slate-400">{conflictDeadline ? "Conflicting on source — unresolved" : NOT_SPECIFIED}</span>}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Last verified</dt><dd>{fmtDateTime(s.lastVerifiedAt)}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Last seen / attempted</dt><dd>{fmtDateTime(s.lastSeenAt)}<div className="text-xs text-slate-500">{fmtDateTime(s.lastAttemptedAt)}</div></dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Consecutive failures</dt><dd>{s.consecutiveFailures}{s.lastFailureCode ? ` (${s.lastFailureCode})` : ""}</dd></div>
          <div className="md:col-span-2"><dt className="text-xs uppercase text-slate-500">Official source</dt><dd className="break-all">{s.officialSourceUrl ? (s.officialSourceUrl.startsWith("http") ? <a className="text-indigo-600 hover:underline" href={s.officialSourceUrl} target="_blank" rel="noreferrer">{s.officialSourceUrl}</a> : <span className="font-mono text-xs">{s.officialSourceUrl}</span>) : <span className="text-slate-400">No confirmed official source</span>}</dd></div>
          <div className="md:col-span-2"><dt className="text-xs uppercase text-slate-500">Application link</dt><dd className="break-all">{s.applicationUrl ? (s.applicationUrl.startsWith("http") ? <a className="text-indigo-600 hover:underline" href={s.applicationUrl} target="_blank" rel="noreferrer">{s.applicationUrl}</a> : <span className="font-mono text-xs">{s.applicationUrl}</span>) : <span className="text-slate-400">Not published on the inspected source</span>}</dd></div>
        </dl>
      </div>

      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>{pending.length} proposed change(s) await reviewer approval.</b> The previously accepted values remain the current record.
          <ul className="mt-2 list-disc pl-5">
            {pending.map((c) => <li key={c.id}><b>{FIELD_LABEL[c.fieldName] ?? c.fieldName}</b>: {fmtValue(c.oldValue)} → {fmtValue(c.newValue)} <span className="text-amber-700">({c.reason})</span></li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Confidence breakdown" className="lg:col-span-1">
          {v ? (
            <div className="space-y-3 text-sm">
              {(Object.keys(COMPONENT_MAX) as (keyof typeof COMPONENT_MAX)[]).map((k) => {
                const val = v.componentScores[k] ?? 0;
                const pct = (val / COMPONENT_MAX[k]) * 100;
                return (
                  <div key={k}>
                    <div className="flex justify-between"><span>{COMPONENT_LABEL[k]}</span><span className="font-mono">{val}/{COMPONENT_MAX[k]}</span></div>
                    <div className="mt-1 h-1.5 rounded bg-slate-100"><div className={`h-1.5 rounded ${pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
              {v.penalties.length > 0 && (
                <div className="rounded-md bg-rose-50 p-2 text-xs text-rose-800">
                  {v.penalties.map((p) => <div key={p.code}>−{p.points} {p.code}: {p.reason}</div>)}
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="font-mono">{v.score.toFixed(1)}</span></div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Mandatory gates</div>
                <ul className="space-y-0.5 text-xs">
                  {Object.entries(v.gateResults).map(([g, ok]) => <li key={g} className={ok ? "text-emerald-700" : "text-rose-700"}>{ok ? "✓" : "✗"} {g.replace(/_/g, " ")}</li>)}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Why</div>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700">{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className="text-xs text-slate-500">Evaluated {fmtDateTime(v.evaluatedAt)} · {v.verifierVersion} · policy {v.policyVersion}</div>
            </div>
          ) : <p className="text-sm text-slate-500">No verification result yet.</p>}
        </Card>

        <Card title="Normalised facts vs. source text (field-level evidence)" className="lg:col-span-2">
          <p className="mb-3 text-xs text-slate-500">Left: the system&apos;s normalised interpretation. Right: the exact quote from the retrieved source text that supports it.</p>
          <div className="divide-y divide-slate-100">
            {evidenceFields.map((k) => {
              const x = evByField.get(k)!;
              return (
                <div key={k} className="grid gap-2 py-3 md:grid-cols-5">
                  <div className="md:col-span-1">
                    <div className="text-sm font-medium">{FIELD_LABEL[k]}</div>
                    <Badge tone={supportTone(x.fe.supportStatus)}>{x.fe.supportStatus.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-[11px] uppercase text-slate-400">Normalised value</div>
                    <div className="whitespace-pre-wrap break-words text-sm">{k === "closing_date" || k === "opening_date" ? fmtDate(String(x.fe.normalizedValue)) : k === "amount" ? <AmountView v={x.fe.normalizedValue as Record<string, unknown>} /> : fmtValue(x.fe.normalizedValue)}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-[11px] uppercase text-slate-400">Source evidence</div>
                    <blockquote className="whitespace-pre-wrap break-words rounded border-l-4 border-indigo-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">“{x.ev?.evidenceText}”</blockquote>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {x.ev?.evidenceType} · {x.fe.extractionMethod}{x.ev?.sectionHeading ? ` · section “${x.ev.sectionHeading}”` : ""}{x.ev?.pageNumber ? ` · page ${x.ev.pageNumber}` : ""} · captured {fmtDateTime(x.ev?.capturedAt)}
                    </div>
                    <div className="break-all text-[11px] text-slate-400">{x.ev?.sourceUrl} · obs {x.ev?.fetchObservationId.slice(0, 8)}</div>
                  </div>
                </div>
              );
            })}
            {absent.map((k) => (
              <div key={k} className="grid gap-2 py-2 md:grid-cols-5">
                <div className="text-sm font-medium">{FIELD_LABEL[k]}</div>
                <div className="text-sm italic text-slate-400 md:col-span-4">{NOT_SPECIFIED}</div>
              </div>
            ))}
            {conflictDeadline && (
              <div className="grid gap-2 py-2 md:grid-cols-5">
                <div className="text-sm font-medium">Closing date</div>
                <div className="text-sm text-rose-700 md:col-span-4">The source states conflicting deadlines; none is accepted until a reviewer resolves it.</div>
              </div>
            )}
          </div>
          {Object.keys(snap).length === 0 && <p className="text-sm text-slate-500">No accepted version yet.</p>}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Change history (${d.changes.length})`}>
          {d.changes.length === 0 ? <p className="text-sm text-slate-500">No changes detected — repeated identical observations create no events.</p> : (
            <ul className="space-y-3">
              {d.changes.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={c.resolution === "PENDING_REVIEW" ? "amber" : "blue"}>{c.changeType.replace(/_/g, " ")}</Badge>
                    <span className="font-medium">{FIELD_LABEL[c.fieldName] ?? c.fieldName.replace(/_/g, " ")}</span>
                    <Badge tone={c.accepted ? "green" : "amber"}>{c.resolution.replace(/_/g, " ")}</Badge>
                    {c.isSimulated && <Badge tone="violet" title="Detected during a run with a simulated clock">simulated clock</Badge>}
                  </div>
                  <div className="mt-1 break-words"><span className="text-slate-500 line-through">{fmtChange(c.fieldName, c.oldValue)}</span> → <b>{fmtChange(c.fieldName, c.newValue)}</b></div>
                  <div className="mt-1 text-xs text-slate-500">{fmtDateTime(c.detectedAt)} · {c.reason}</div>
                  {c.evidenceId && <div className="text-[11px] text-slate-400">evidence {c.evidenceId.slice(0, 8)} · observation {c.sourceObservationId?.slice(0, 8)}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Review actions">
            <DetailActions id={s.id} hasPending={pending.length > 0} rejected={s.verificationStatus === "REJECTED"} />
            {d.reviews.length > 0 && (
              <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-slate-600">
                {d.reviews.map((r) => <li key={r.id}><b>{r.decision.replace(/_/g, " ")}</b> by {r.reviewer} · {fmtDateTime(r.createdAt)} — {r.rationale}</li>)}
              </ul>
            )}
          </Card>
          <Card title="Provenance & discovery">
            <ul className="space-y-1 text-xs text-slate-600">
              {d.source && <li><b>Registry source:</b> {d.source.name} ({d.source.sourceType}) — reviewed: {d.source.reviewed ? `yes (${d.source.reviewedOn})` : "no"}<br /><span className="text-slate-500">{d.source.rationale}</span></li>}
              {s.discoveryUrl && <li className="break-all"><b>First discovered at:</b> {s.discoveryUrl}</li>}
              {d.candidates.map((c) => <li key={c.id} className="break-all"><b>Candidate:</b> {c.discoveryMethod} · {c.classification} · {c.normalizedUrl}</li>)}
              <li><b>Versions:</b> {d.versions.length} immutable version(s); current v{d.versions.find((x) => x.id === s.currentVersionId)?.versionNumber ?? "—"}</li>
            </ul>
          </Card>
        </div>
      </div>

      <Card title="Source observations (including failures)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="text-left uppercase text-slate-500"><tr><th className="py-1">Fetched</th><th>Status</th><th>HTTP</th><th>Error</th><th>Content hash</th><th>URL</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.observations.map((o) => (
                <tr key={o.id}>
                  <td className="py-1 whitespace-nowrap">{fmtDateTime(o.fetchedAt)}</td>
                  <td><Badge tone={o.fetchStatus === "SUCCESS" ? "green" : "red"}>{o.fetchStatus}</Badge></td>
                  <td>{o.httpStatus ?? "—"}</td>
                  <td>{o.errorCode ?? ""}</td>
                  <td className="font-mono">{o.contentHash?.slice(0, 10) ?? "—"}</td>
                  <td className="max-w-xs truncate">{o.finalUrl ?? o.requestedUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.observations.length > 1 && d.observations.filter((o) => o.fetchStatus === "SUCCESS").length > 1 && <p className="mt-2 text-xs text-slate-500">Re-checks with no material change are retained as observations: “checked again; no changes”.</p>}
        </div>
      </Card>
    </div>
  );
}

function fmtChange(field: string, v: unknown) {
  if ((field === "closing_date" || field === "opening_date") && typeof v === "string") return fmtDate(v);
  if (field === "amount" && v && typeof v === "object") return (v as { raw?: string }).raw ?? JSON.stringify(v);
  return fmtValue(v);
}

function AmountView({ v }: { v: Record<string, unknown> }) {
  return (
    <div>
      <div className="font-medium">{String(v.raw ?? "")}</div>
      <div className="text-xs text-slate-500">
        {v.up_to ? "maximum (“up to”) " : ""}min {String(v.min ?? "—")} · max {String(v.max ?? "—")} · {String(v.currency ?? "currency not stated")}{v.frequency ? ` · ${String(v.frequency).toLowerCase().replace("_", " ")}` : ""}
      </div>
    </div>
  );
}
