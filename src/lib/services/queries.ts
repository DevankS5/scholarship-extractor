import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  changeEvents, crawlRuns, discoveredCandidates, evidence, fetchObservations, fieldEvidence, reviewActions, scholarships,
  scholarshipVersions, sources, verificationResults,
} from "@/db/schema";

export type Scope = "all" | "real" | "fixture";

export interface SearchParams {
  q?: string;
  verification_status?: string;
  lifecycle_status?: string;
  provider_type?: string;
  education_level?: string;
  state?: string;
  category?: string;
  min_confidence?: number;
  deadline_from?: string;
  deadline_to?: string;
  verified_within_days?: number;
  sort?: string;
  page?: number;
  page_size?: number;
  scope?: Scope;
}

function scopeCond(scope: Scope | undefined): SQL | undefined {
  if (scope === "real") return eq(scholarships.isFixture, false);
  if (scope === "fixture") return eq(scholarships.isFixture, true);
  return undefined;
}

export async function searchScholarships(p: SearchParams) {
  const conds: (SQL | undefined)[] = [scopeCond(p.scope)];
  if (p.q?.trim()) {
    const like = `%${p.q.trim().replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(scholarships.name, like), ilike(scholarships.providerName, like), ilike(scholarships.description, like), ilike(scholarships.eligibilitySummary, like)));
  }
  if (p.verification_status) conds.push(eq(scholarships.verificationStatus, p.verification_status));
  if (p.lifecycle_status) conds.push(eq(scholarships.lifecycleStatus, p.lifecycle_status));
  if (p.provider_type) conds.push(eq(scholarships.providerType, p.provider_type));
  if (p.education_level) conds.push(sql`${scholarships.eligibilityStructured} -> 'education_levels' @> ${JSON.stringify([p.education_level])}::jsonb`);
  if (p.state) conds.push(sql`${scholarships.domicileRequirements} @> ${JSON.stringify([p.state])}::jsonb`);
  if (p.category) conds.push(sql`${scholarships.categoryCriteria} @> ${JSON.stringify([p.category])}::jsonb`);
  if (p.min_confidence !== undefined && !Number.isNaN(p.min_confidence)) conds.push(gte(scholarships.confidenceScore, p.min_confidence));
  if (p.deadline_from) conds.push(gte(scholarships.closingDate, p.deadline_from));
  if (p.deadline_to) conds.push(lte(scholarships.closingDate, p.deadline_to));
  if (p.verified_within_days) conds.push(sql`${scholarships.lastVerifiedAt} >= now() - (${p.verified_within_days} || ' days')::interval`);
  const where = and(...conds);

  const order =
    p.sort === "confidence" ? [desc(scholarships.confidenceScore)]
    : p.sort === "verified" ? [sql`${scholarships.lastVerifiedAt} desc nulls last`]
    : p.sort === "changed" ? [sql`${scholarships.lastChangedAt} desc nulls last`]
    : p.sort === "deadline" ? [sql`${scholarships.closingDate} asc nulls last`]
    : [desc(scholarships.updatedAt)];
  const pageSize = Math.min(Math.max(p.page_size ?? 20, 1), 100);
  const page = Math.max(p.page ?? 1, 1);

  const [items, [{ count }]] = await Promise.all([
    db.select().from(scholarships).where(where).orderBy(...order, asc(scholarships.name)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(scholarships).where(where),
  ]);
  return { items, total: count, page, pageSize };
}

export async function getMetrics(scope: Scope = "all") {
  const cond = scope === "real" ? sql`is_fixture = false` : scope === "fixture" ? sql`is_fixture = true` : sql`true`;
  const s = (
    await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where verification_status='VERIFIED')::int as verified,
      count(*) filter (where verification_status='REVIEW_REQUIRED')::int as review_required,
      count(*) filter (where verification_status='REJECTED')::int as rejected,
      count(*) filter (where lifecycle_status='ACTIVE')::int as active,
      count(*) filter (where lifecycle_status='UPCOMING')::int as upcoming,
      count(*) filter (where lifecycle_status='EXPIRING_SOON')::int as expiring_soon,
      count(*) filter (where lifecycle_status='EXPIRED')::int as expired,
      count(*) filter (where lifecycle_status='CLOSED')::int as closed,
      count(*) filter (where lifecycle_status='NO_LONGER_VERIFIABLE')::int as no_longer_verifiable,
      count(*) filter (where lifecycle_status='REMOVED')::int as removed,
      count(*) filter (where lifecycle_status='UNKNOWN')::int as unknown_lifecycle,
      count(*) filter (where last_changed_at >= now() - interval '7 days')::int as recently_changed,
      coalesce(round((avg(confidence_score) filter (where verification_status <> 'REJECTED'))::numeric,1),0)::float as avg_confidence,
      count(*) filter (where authority in ('PRIMARY_CONFIRMED','PRIMARY_DOCUMENT_CONFIRMED'))::int as primary_checked,
      count(*) filter (where verification_status='VERIFIED' and confidence_score >= 95)::int as verified_95,
      count(distinct provider_type) filter (where provider_type <> 'UNKNOWN')::int as source_categories,
      count(*) filter (where flags ? 'PENDING_REVIEW')::int as pending_changes
    from scholarships where ${cond}`)
  ).rows[0] as Record<string, number>;

  const candCond = scope === "real" ? sql`is_fixture = false` : scope === "fixture" ? sql`is_fixture = true` : sql`true`;
  const cands = (
    await db.execute(sql`
    select count(*)::int as discovered,
      count(*) filter (where classification='LEAD')::int as leads,
      count(*) filter (where processing_status in ('PERSISTED','DUPLICATE_LEAD'))::int as persisted,
      count(*) filter (where processing_status='FETCH_FAILED')::int as fetch_failed,
      count(distinct discovery_method)::int as methods
    from discovered_candidates where ${candCond}`)
  ).rows[0] as Record<string, number>;

  const ev = (
    await db.execute(sql`
    select count(*) filter (where e.change_type in ('FIELD_CHANGED','FIELD_ADDED','FIELD_REMOVED','APPLICATION_URL_CHANGED','SOURCE_CHANGED') and e.accepted)::int as accepted_field_changes,
           count(*) filter (where e.change_type in ('FIELD_CHANGED','FIELD_ADDED','FIELD_REMOVED','APPLICATION_URL_CHANGED','SOURCE_CHANGED'))::int as field_changes,
           count(*) filter (where e.change_type = 'STATUS_CHANGED')::int as status_changes
    from change_events e join scholarships s on s.id = e.scholarship_id where ${scope === "real" ? sql`s.is_fixture = false` : scope === "fixture" ? sql`s.is_fixture = true` : sql`true`}`)
  ).rows[0] as Record<string, number>;

  const split = (
    await db.execute(sql`
    select is_fixture, count(*)::int as records,
      count(*) filter (where verification_status='VERIFIED')::int as verified,
      count(*) filter (where authority in ('PRIMARY_CONFIRMED','PRIMARY_DOCUMENT_CONFIRMED'))::int as primary_checked,
      count(*) filter (where verification_status='REVIEW_REQUIRED')::int as review_required
    from scholarships group by is_fixture`)
  ).rows as { is_fixture: boolean; records: number; verified: number; primary_checked: number; review_required: number }[];

  const lastOk = (await db.select({ at: crawlRuns.finishedAt }).from(crawlRuns).where(sql`${crawlRuns.status} in ('SUCCESS','PARTIAL')`).orderBy(desc(crawlRuns.finishedAt)).limit(1))[0];
  const latest = (await db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(1))[0] ?? null;
  return { scholarships: s, candidates: cands, changes: ev, split, lastSuccessfulCrawlAt: lastOk?.at ?? null, latestRun: latest, scope };
}

export async function getScholarshipDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = (await db.select().from(scholarships).where(eq(scholarships.id, id)).limit(1))[0];
  if (!row) return null;
  const [versions, changes, verifications, observations, reviews, candidates, evRows, source] = await Promise.all([
    db.select().from(scholarshipVersions).where(eq(scholarshipVersions.scholarshipId, id)).orderBy(desc(scholarshipVersions.versionNumber)),
    db.select().from(changeEvents).where(eq(changeEvents.scholarshipId, id)).orderBy(desc(changeEvents.detectedAt), desc(changeEvents.createdAt)),
    db.select().from(verificationResults).where(eq(verificationResults.scholarshipId, id)).orderBy(desc(verificationResults.evaluatedAt)),
    db.select().from(fetchObservations).where(eq(fetchObservations.scholarshipId, id)).orderBy(desc(fetchObservations.fetchedAt)).limit(25),
    db.select().from(reviewActions).where(eq(reviewActions.scholarshipId, id)).orderBy(desc(reviewActions.createdAt)),
    db.select().from(discoveredCandidates).where(eq(discoveredCandidates.scholarshipId, id)),
    db.select().from(evidence).where(eq(evidence.scholarshipId, id)).orderBy(desc(evidence.capturedAt)),
    row.sourceId ? db.select().from(sources).where(eq(sources.id, row.sourceId)).limit(1) : Promise.resolve([]),
  ]);
  const current = versions.find((v) => v.id === row.currentVersionId) ?? versions[0];
  const fieldEv = current
    ? await db
        .select({ fe: fieldEvidence, ev: evidence })
        .from(fieldEvidence)
        .leftJoin(evidence, eq(fieldEvidence.evidenceId, evidence.id))
        .where(eq(fieldEvidence.scholarshipVersionId, current.id))
    : [];
  return { scholarship: row, versions, changes, verifications, latestVerification: verifications[0] ?? null, observations, reviews, candidates, evidence: evRows, fieldEvidence: fieldEv, source: source[0] ?? null };
}

export async function listRuns(limit = 25) {
  return db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(limit);
}
export async function getRun(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.select().from(crawlRuns).where(eq(crawlRuns.id, id)).limit(1))[0] ?? null;
}

export async function listCandidates(opts: { status?: string; classification?: string; scope?: Scope; page?: number; pageSize?: number } = {}) {
  const conds: (SQL | undefined)[] = [];
  if (opts.status) conds.push(eq(discoveredCandidates.processingStatus, opts.status));
  if (opts.classification) conds.push(eq(discoveredCandidates.classification, opts.classification));
  if (opts.scope === "real") conds.push(eq(discoveredCandidates.isFixture, false));
  if (opts.scope === "fixture") conds.push(eq(discoveredCandidates.isFixture, true));
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const where = and(...conds);
  const [items, [{ count }]] = await Promise.all([
    db.select().from(discoveredCandidates).where(where).orderBy(desc(discoveredCandidates.lastSeenAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(discoveredCandidates).where(where),
  ]);
  return { items, total: count, page, pageSize };
}

export async function listSourcesWithStats() {
  const rows = await db.select().from(sources).orderBy(asc(sources.isFixture), asc(sources.name));
  const stats = (
    await db.execute(sql`
    select source_id, count(*)::int as candidates, count(*) filter (where processing_status='PERSISTED')::int as persisted
    from discovered_candidates group by source_id`)
  ).rows as { source_id: string; candidates: number; persisted: number }[];
  const sch = (await db.execute(sql`select source_id, count(*)::int as records, count(*) filter (where verification_status='VERIFIED')::int as verified from scholarships group by source_id`)).rows as { source_id: string; records: number; verified: number }[];
  return rows.map((r) => ({
    ...r,
    candidates: stats.find((x) => x.source_id === r.id)?.candidates ?? 0,
    records: sch.find((x) => x.source_id === r.id)?.records ?? 0,
    verified: sch.find((x) => x.source_id === r.id)?.verified ?? 0,
  }));
}

export async function exportScholarships(scope: Scope = "all") {
  return db.select().from(scholarships).where(scopeCond(scope)).orderBy(asc(scholarships.name));
}
