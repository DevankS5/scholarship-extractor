/**
 * Persistence + change detection. All accepted-state updates (change events, immutable version,
 * current record, verification result) happen in ONE database transaction. No network I/O inside.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { changeEvents, evidence, fetchObservations, fieldEvidence, scholarships, scholarshipVersions, verificationResults } from "@/db/schema";
import type { CrawlPolicy } from "../config";
import { getSettings } from "../config";
import { pageForOffset, type NormalizedDocument } from "../crawling/normalize";
import type { ExtractionResult, FieldValue } from "../extraction/extractor";
import { computeLifecycle, nextCheckAt, type Lifecycle } from "../lifecycle/lifecycle";
import { deepEqual, hostOf, identityFingerprint, normalizeName, sha256, stableStringify } from "../util";
import type { SourceResolution, SourceRow } from "../verification/resolver";
import type { VerificationResult } from "../verification/verifier";
import { providerTypeFor } from "./registry";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Snapshot = Record<string, unknown>;

/** Fields that define "the scholarship's facts" and therefore drive versions + change events. */
export const MATERIAL_KEYS = [
  "name", "provider_name", "academic_cycle", "amount", "benefit_type", "closing_date", "opening_date",
  "eligibility_summary", "income_criteria", "academic_requirements", "education_levels", "category_criteria",
  "gender_criteria", "domicile_requirements", "documents_required", "selection_process", "renewal_requirements",
  "application_instructions", "application_url", "terms_url",
] as const;

/** Changes to these require reviewer approval (eligibility materially changing is never auto-accepted). */
const REVIEW_KEYS = new Set(["eligibility_summary", "income_criteria", "academic_requirements", "education_levels", "category_criteria", "gender_criteria", "domicile_requirements"]);

const ARRAY_KEYS = new Set(["academic_requirements", "education_levels", "category_criteria", "domicile_requirements", "documents_required"]);

export function buildSnapshot(ex: ExtractionResult): Snapshot {
  const v = (k: string) => ex.fields[k]?.value ?? null;
  const s: Snapshot = {};
  for (const k of MATERIAL_KEYS) s[k] = ARRAY_KEYS.has(k) ? (v(k) ?? []) : v(k);
  s.description = v("description");
  s.date_raw = ex.fields.closing_date?.quote ?? ex.fields.opening_date?.quote ?? null;
  return s;
}

export function snapshotToColumns(s: Snapshot) {
  const amt = s.amount as { raw?: string; min?: number | null; max?: number | null; currency?: string | null; frequency?: string | null } | null;
  const income = (s.income_criteria as Record<string, unknown> | null) ?? null;
  return {
    name: s.name as string,
    normalizedName: normalizeName(s.name as string),
    providerName: (s.provider_name as string | null) ?? null,
    academicCycle: (s.academic_cycle as string | null) ?? null,
    description: (s.description as string | null) ?? null,
    benefitType: (s.benefit_type as string | null) ?? null,
    amountMin: amt?.min ?? null,
    amountMax: amt?.max ?? null,
    amountCurrency: amt?.currency ?? null,
    amountRaw: amt?.raw ?? null,
    benefitFrequency: amt?.frequency ?? null,
    eligibilitySummary: (s.eligibility_summary as string | null) ?? null,
    eligibilityStructured: {
      education_levels: s.education_levels ?? [],
      academic_requirements: s.academic_requirements ?? [],
      income_criteria: income,
      category_criteria: s.category_criteria ?? [],
      gender_criteria: s.gender_criteria ?? null,
      domicile_states: s.domicile_requirements ?? [],
    } as Record<string, unknown>,
    academicRequirements: (s.academic_requirements as unknown[]) ?? [],
    incomeCriteria: income,
    genderCriteria: (s.gender_criteria as string | null) ?? null,
    categoryCriteria: (s.category_criteria as string[]) ?? [],
    domicileRequirements: (s.domicile_requirements as string[]) ?? [],
    openingDate: (s.opening_date as string | null) ?? null,
    closingDate: (s.closing_date as string | null) ?? null,
    dateRaw: (s.date_raw as string | null) ?? null,
    documentsRequired: (s.documents_required as string[]) ?? [],
    selectionProcess: (s.selection_process as string | null) ?? null,
    renewalRequirements: (s.renewal_requirements as string | null) ?? null,
    applicationInstructions: (s.application_instructions as string | null) ?? null,
    applicationUrl: (s.application_url as string | null) ?? null,
    termsUrl: (s.terms_url as string | null) ?? null,
  };
}

function changeTypeFor(key: string, oldV: unknown, newV: unknown): string {
  const empty = (x: unknown) => x === null || x === undefined || (Array.isArray(x) && x.length === 0);
  if (key === "application_url") return "APPLICATION_URL_CHANGED";
  if (empty(oldV) && !empty(newV)) return "FIELD_ADDED";
  if (!empty(oldV) && empty(newV)) return "FIELD_REMOVED";
  return "FIELD_CHANGED";
}

async function insertEvidence(tx: Tx, p: { obsId: string; scholarshipId: string; url: string; fv: FieldValue; doc: NormalizedDocument; contentHash: string | null; capturedAt: Date }) {
  const { fv } = p;
  const type = p.doc.kind === "PDF" ? "PDF_TEXT" : fv.field === "application_url" || fv.field === "terms_url" ? "LINK_TARGET" : "HTML_TEXT";
  const [row] = await tx
    .insert(evidence)
    .values({
      fetchObservationId: p.obsId,
      scholarshipId: p.scholarshipId,
      sourceUrl: p.url,
      fieldName: fv.field,
      evidenceText: fv.quote.slice(0, 600),
      textStartOffset: fv.start,
      textEndOffset: fv.end,
      pageNumber: p.doc.kind === "PDF" ? pageForOffset(p.doc.text, fv.start) : null,
      sectionHeading: fv.section,
      evidenceType: type,
      contentHash: p.contentHash,
      capturedAt: p.capturedAt,
    })
    .returning({ id: evidence.id });
  return row.id;
}

export interface PersistInput {
  runId: string;
  observationId: string;
  candidateId: string | null;
  url: string;
  doc: NormalizedDocument;
  contentHash: string | null;
  extraction: ExtractionResult;
  resolution: SourceResolution;
  verification: VerificationResult;
  source: SourceRow | null;
  now: Date;
  simulated: boolean;
  discoveryUrl: string | null;
  isFixture: boolean;
  policy: CrawlPolicy;
}

export interface PersistOutcome {
  action: "CREATED" | "UPDATED" | "UNCHANGED" | "DUPLICATE_LEAD";
  scholarshipId: string;
  status: "VERIFIED" | "REVIEW_REQUIRED" | "REJECTED";
  changeEvents: number;
  versionCreated: boolean;
}

export async function persistExtraction(inp: PersistInput): Promise<PersistOutcome> {
  const { extraction: ex, resolution: res, verification: ver, now } = inp;
  const settings = getSettings();
  const snapshot = buildSnapshot(ex);
  const name = snapshot.name as string;
  const identityProvider = (snapshot.provider_name as string | null) ?? inp.source?.providerName ?? null;
  const cycle = (snapshot.academic_cycle as string | null) ?? null;
  const fingerprint = identityFingerprint(identityProvider, name, cycle);
  const primary = res.authority === "PRIMARY_CONFIRMED" || res.authority === "PRIMARY_DOCUMENT_CONFIRMED";
  const sourceDomain = hostOf(inp.url);

  return db.transaction(async (tx) => {
    // ---- identity resolution: fingerprint first, then same official URL (name/cycle edits on one page)
    let existing = (await tx.select().from(scholarships).where(eq(scholarships.fingerprint, fingerprint)).limit(1))[0];
    if (!existing && res.officialSourceUrl) {
      existing = (await tx.select().from(scholarships).where(eq(scholarships.officialSourceUrl, res.officialSourceUrl)).limit(1))[0];
    }

    const recordSignals = { explicitClosed: ex.signals.explicitClosed, explicitOpen: ex.signals.explicitOpen, explicitDiscontinued: ex.signals.explicitDiscontinued };
    const life = computeLifecycle({
      closingDate: (snapshot.closing_date as string | null) ?? null,
      openingDate: (snapshot.opening_date as string | null) ?? null,
      signals: recordSignals,
      now,
      warningDays: inp.policy.lifecycle.warning_window_days,
    });

    // ---- a secondary/unconfirmed observation must never overwrite primary-confirmed facts
    if (existing && !primary && ["PRIMARY_CONFIRMED", "PRIMARY_DOCUMENT_CONFIRMED"].includes(existing.authority)) {
      await tx.update(fetchObservations).set({ scholarshipId: existing.id }).where(eq(fetchObservations.id, inp.observationId));
      return { action: "DUPLICATE_LEAD" as const, scholarshipId: existing.id, status: existing.verificationStatus as "VERIFIED", changeEvents: 0, versionCreated: false };
    }

    const common = {
      fingerprint,
      sourceId: inp.source?.id ?? null,
      providerType: providerTypeFor(inp.source?.sourceType ?? "UNKNOWN"),
      officialSourceUrl: res.officialSourceUrl,
      sourceType: res.sourceType,
      sourceDomain,
      authority: res.authority,
      lastAttemptedAt: now,
      lastSeenAt: now,
      consecutiveFailures: 0,
      lastFailureCode: null as string | null,
      signals: recordSignals as Record<string, boolean>,
      confidencePolicyVersion: ver.policyVersion,
      isFixture: inp.isFixture,
      nextCheckAt: nextCheckAt(now, (snapshot.closing_date as string | null) ?? null, inp.policy.lifecycle.recheck_days_default, inp.policy.lifecycle.recheck_days_near_deadline, inp.policy.lifecycle.warning_window_days),
      updatedAt: now,
    };

    const writeVersionAndEvidence = async (schId: string, versionNumber: number, snap: Snapshot, status: string, lifecycle: string, score: number) => {
      const [v] = await tx
        .insert(scholarshipVersions)
        .values({
          scholarshipId: schId, versionNumber, recordSnapshot: snap, contentFingerprint: sha256(stableStringify(MATERIAL_KEYS.map((k) => snap[k]))),
          verificationStatus: status, lifecycleStatus: lifecycle, confidenceScore: score, createdFromObservationId: inp.observationId,
        })
        .returning({ id: scholarshipVersions.id });
      const evIds: Record<string, string> = {};
      for (const fv of Object.values(ex.fields)) {
        const evId = await insertEvidence(tx, { obsId: inp.observationId, scholarshipId: schId, url: inp.url, fv, doc: inp.doc, contentHash: inp.contentHash, capturedAt: now });
        evIds[fv.field] = evId;
        await tx.insert(fieldEvidence).values({
          scholarshipVersionId: v.id, fieldName: fv.field, normalizedValue: fv.value as never, rawValue: fv.raw, evidenceId: evId,
          supportStatus: ver.fieldResults[fv.field] ?? fv.support, extractionMethod: fv.method, extractorVersion: settings.extractor_version,
        });
      }
      return { versionId: v.id, evIds };
    };

    const writeVerification = async (schId: string, versionId: string | null, status: string) => {
      await tx.insert(verificationResults).values({
        scholarshipId: schId, scholarshipVersionId: versionId, fetchObservationId: inp.observationId, score: ver.score, status,
        componentScores: ver.components, penalties: ver.penalties, gateResults: ver.gates, fieldResults: ver.fieldResults,
        reasons: ver.reasons, resolution: { authority: res.authority, rationale: res.rationale, unresolved: res.unresolvedQuestions, officialSourceUrl: res.officialSourceUrl, applicationUrl: res.applicationUrl },
        policyVersion: ver.policyVersion, verifierVersion: ver.verifierVersion, evaluatedAt: now,
      });
    };

    // =============================================================== CREATE
    if (!existing) {
      const cols = snapshotToColumns(snapshot);
      const [row] = await tx
        .insert(scholarships)
        .values({
          ...common, ...cols,
          verificationStatus: ver.status, lifecycleStatus: life.status, statusReason: life.reason, flags: ver.flags,
          confidenceScore: ver.score, lastVerifiedAt: primary ? now : null, discoveryUrl: inp.discoveryUrl, firstDiscoveredAt: now,
        })
        .returning({ id: scholarships.id });
      const { versionId } = await writeVersionAndEvidence(row.id, 1, snapshot, ver.status, life.status, ver.score);
      await tx.update(scholarships).set({ currentVersionId: versionId }).where(eq(scholarships.id, row.id));
      await writeVerification(row.id, versionId, ver.status);
      await tx.update(fetchObservations).set({ scholarshipId: row.id }).where(eq(fetchObservations.id, inp.observationId));
      return { action: "CREATED" as const, scholarshipId: row.id, status: ver.status, changeEvents: 0, versionCreated: true };
    }

    // =============================================================== UPDATE
    const current = existing.currentVersionId
      ? (await tx.select().from(scholarshipVersions).where(eq(scholarshipVersions.id, existing.currentVersionId)).limit(1))[0]
      : undefined;
    const oldSnap: Snapshot = current?.recordSnapshot ?? {};
    const applied: Snapshot = { ...oldSnap, ...snapshot };
    const diffs: { key: string; oldV: unknown; newV: unknown; accepted: boolean; why: string }[] = [];
    const hasConflict = (k: string) => ex.conflicts.some((c) => c.field === (k === "closing_date" ? "closing_date" : k));
    for (const key of MATERIAL_KEYS) {
      const oldV = oldSnap[key] ?? (ARRAY_KEYS.has(key) ? [] : null);
      const newV = snapshot[key] ?? (ARRAY_KEYS.has(key) ? [] : null);
      if (deepEqual(oldV, newV)) continue;
      const type = changeTypeFor(key, oldV, newV);
      let accepted = true;
      let why = "Supported by a confirmed official source; normalisation unambiguous; no unresolved authoritative conflict.";
      if (!primary) { accepted = false; why = "Observation is not from a confirmed primary source."; }
      else if (hasConflict(key)) { accepted = false; why = "The source states conflicting values; the previously accepted value is retained until a reviewer resolves it."; }
      else if (type === "FIELD_REMOVED") { accepted = false; why = "Absence of a value on the page is not proof it was withdrawn; reviewer must confirm."; }
      else if (REVIEW_KEYS.has(key)) { accepted = false; why = "Eligibility criteria changed materially; reviewer approval required."; }
      else if (hasConflict(key)) { accepted = false; why = "Conflicting values on the source."; }
      else if (ex.fields[key]?.support === "PARTIALLY_SUPPORTED") { accepted = false; why = "Evidence is only partially supporting the value."; }
      diffs.push({ key, oldV, newV, accepted, why });
      if (!accepted) applied[key] = oldV;
    }
    // a closing date that is now in conflict keeps the previously accepted value (never silently pick one)
    for (const c of ex.conflicts) if (!(c.field in applied) || applied[c.field] === undefined) applied[c.field] = oldSnap[c.field] ?? null;
    if (!deepEqual(oldSnap.description ?? null, snapshot.description ?? null) && primary) applied.description = snapshot.description ?? null;
    applied.date_raw = (applied.closing_date ?? null) === (snapshot.closing_date ?? null) ? snapshot.date_raw : oldSnap.date_raw ?? null;

    const acceptedDiffs = diffs.filter((d) => d.accepted);
    const pendingDiffs = diffs.filter((d) => !d.accepted);
    const sourceChanged = !!res.officialSourceUrl && existing.officialSourceUrl !== res.officialSourceUrl && primary;
    const versionCreated = acceptedDiffs.length > 0 || sourceChanged;
    const reappeared = ["NO_LONGER_VERIFIABLE", "REMOVED"].includes(existing.lifecycleStatus);

    // lifecycle computed from the ACCEPTED dates, not from merely-observed pending ones
    const lifeAccepted = computeLifecycle({
      closingDate: (applied.closing_date as string | null) ?? null,
      openingDate: (applied.opening_date as string | null) ?? null,
      signals: recordSignals,
      now,
      warningDays: inp.policy.lifecycle.warning_window_days,
    });

    let eventCount = 0;
    let evIds: Record<string, string> = {};
    let newVersionId: string | null = null;
    const newNumber = current ? current.versionNumber + 1 : 1;

    // dedupe pending events: same field + same proposed value already pending => do not repeat
    const pendingNow = await tx.select().from(changeEvents).where(and(eq(changeEvents.scholarshipId, existing.id), eq(changeEvents.resolution, "PENDING_REVIEW")));

    // 1) write new version first (events reference its evidence)
    const nextStatusPending = pendingDiffs.length > 0 || pendingNow.length > 0;
    const finalStatus: "VERIFIED" | "REVIEW_REQUIRED" = nextStatusPending ? "REVIEW_REQUIRED" : ver.status;
    if (versionCreated) {
      const w = await writeVersionAndEvidence(existing.id, newNumber, applied, finalStatus, lifeAccepted.status, ver.score);
      newVersionId = w.versionId;
      evIds = w.evIds;
    } else if (pendingDiffs.length) {
      // evidence for pending proposals, so reviewers can see the supporting quote
      for (const d of pendingDiffs) {
        const fv = ex.fields[d.key];
        if (fv) evIds[d.key] = await insertEvidence(tx, { obsId: inp.observationId, scholarshipId: existing.id, url: inp.url, fv, doc: inp.doc, contentHash: inp.contentHash, capturedAt: now });
      }
    }
    for (const d of pendingDiffs) {
      if (d.accepted) continue;
      if (!evIds[d.key] && ex.fields[d.key]) evIds[d.key] = await insertEvidence(tx, { obsId: inp.observationId, scholarshipId: existing.id, url: inp.url, fv: ex.fields[d.key], doc: inp.doc, contentHash: inp.contentHash, capturedAt: now });
    }

    // 2) change events (immutable)
    for (const d of diffs) {
      if (!d.accepted && pendingNow.some((p) => p.fieldName === d.key && deepEqual(p.newValue, d.newV))) continue;
      await tx.insert(changeEvents).values({
        scholarshipId: existing.id, crawlRunId: inp.runId, fieldName: d.key, changeType: changeTypeFor(d.key, d.oldV, d.newV),
        oldValue: d.oldV as never, newValue: d.newV as never, detectedAt: now, sourceObservationId: inp.observationId, evidenceId: evIds[d.key] ?? null,
        reason: d.why, accepted: d.accepted, resolution: d.accepted ? "AUTO_ACCEPTED" : "PENDING_REVIEW", isSimulated: inp.simulated,
      });
      eventCount++;
    }
    if (sourceChanged) {
      await tx.insert(changeEvents).values({
        scholarshipId: existing.id, crawlRunId: inp.runId, fieldName: "official_source_url", changeType: "SOURCE_CHANGED",
        oldValue: existing.officialSourceUrl as never, newValue: res.officialSourceUrl as never, detectedAt: now, sourceObservationId: inp.observationId,
        reason: existing.officialSourceUrl ? "Official source URL changed." : "Primary official source established for a previously unconfirmed record.", accepted: true, resolution: "AUTO_ACCEPTED", isSimulated: inp.simulated,
      });
      eventCount++;
    }
    if (existing.lifecycleStatus !== lifeAccepted.status) {
      await tx.insert(changeEvents).values({
        scholarshipId: existing.id, crawlRunId: inp.runId, fieldName: "lifecycle_status",
        changeType: reappeared ? "SCHOLARSHIP_REAPPEARED" : "STATUS_CHANGED", oldValue: existing.lifecycleStatus as never, newValue: lifeAccepted.status as never,
        detectedAt: now, sourceObservationId: inp.observationId, reason: reappeared ? `Source reachable again. ${lifeAccepted.reason}` : lifeAccepted.reason, accepted: true, resolution: "AUTO_ACCEPTED", isSimulated: inp.simulated,
      });
      eventCount++;
    }

    // 3) current record
    const cols = snapshotToColumns(applied);
    const statusReason = nextStatusPending
      ? `${lifeAccepted.reason} Pending reviewer decision on: ${[...new Set([...pendingNow.map((p) => p.fieldName), ...pendingDiffs.map((d) => d.key)])].join(", ")}.`
      : lifeAccepted.reason;
    const keepRejected = existing.verificationStatus === "REJECTED";
    await tx
      .update(scholarships)
      .set({
        ...common, ...cols,
        fingerprint: existing.fingerprint === fingerprint || !versionCreated ? existing.fingerprint : fingerprint,
        officialSourceUrl: res.officialSourceUrl ?? existing.officialSourceUrl,
        verificationStatus: keepRejected ? "REJECTED" : finalStatus,
        lifecycleStatus: lifeAccepted.status,
        statusReason,
        flags: [...new Set([...ver.flags, ...(nextStatusPending ? ["PENDING_REVIEW"] : [])])],
        confidenceScore: ver.score,
        lastVerifiedAt: primary ? now : existing.lastVerifiedAt,
        currentVersionId: newVersionId ?? existing.currentVersionId,
        lastChangedAt: eventCount > 0 ? now : existing.lastChangedAt,
        discoveryUrl: existing.discoveryUrl ?? inp.discoveryUrl,
      })
      .where(eq(scholarships.id, existing.id));

    // 4) verification result only when something about the decision changed
    const lastVer = (await tx.select().from(verificationResults).where(eq(verificationResults.scholarshipId, existing.id)).orderBy(desc(verificationResults.evaluatedAt)).limit(1))[0];
    if (versionCreated || !lastVer || lastVer.score !== ver.score || lastVer.status !== ver.status) await writeVerification(existing.id, newVersionId ?? existing.currentVersionId, ver.status);
    await tx.update(fetchObservations).set({ scholarshipId: existing.id }).where(eq(fetchObservations.id, inp.observationId));

    return {
      action: eventCount > 0 || versionCreated ? ("UPDATED" as const) : ("UNCHANGED" as const),
      scholarshipId: existing.id,
      status: keepRejected ? ("REVIEW_REQUIRED" as const) : finalStatus,
      changeEvents: eventCount,
      versionCreated,
    };
  });
}

// ====================================================================== failures & lifecycle sweeps
export async function recordFailure(args: { scholarshipId: string; code: string; now: Date; runId: string; observationId: string; policy: CrawlPolicy; simulated: boolean }) {
  const { lifecycleAfterFailure } = await import("../lifecycle/lifecycle");
  return db.transaction(async (tx) => {
    const row = (await tx.select().from(scholarships).where(eq(scholarships.id, args.scholarshipId)).limit(1))[0];
    if (!row) return null;
    const failures = row.consecutiveFailures + 1;
    const r = lifecycleAfterFailure({
      previous: row.lifecycleStatus as Lifecycle, consecutiveFailures: failures, lastSuccessAt: row.lastSeenAt, now: args.now,
      minFailures: args.policy.lifecycle.stale_min_consecutive_failures, graceDays: args.policy.lifecycle.stale_grace_period_days,
    });
    const flags = new Set(row.flags);
    if (failures > 0) flags.add("STALE_OBSERVATION");
    await tx
      .update(scholarships)
      .set({
        consecutiveFailures: failures, lastFailureCode: args.code, lastAttemptedAt: args.now, flags: [...flags],
        lifecycleStatus: r.status, statusReason: r.reason,
        verificationStatus: r.changed ? "REVIEW_REQUIRED" : row.verificationStatus,
        lastChangedAt: r.changed ? args.now : row.lastChangedAt, updatedAt: args.now,
        nextCheckAt: new Date(args.now.getTime() + 86_400_000),
      })
      .where(eq(scholarships.id, row.id));
    await tx.update(fetchObservations).set({ scholarshipId: row.id }).where(eq(fetchObservations.id, args.observationId));
    if (r.changed) {
      await tx.insert(changeEvents).values({
        scholarshipId: row.id, crawlRunId: args.runId, fieldName: "lifecycle_status", changeType: "STATUS_CHANGED",
        oldValue: row.lifecycleStatus as never, newValue: r.status as never, detectedAt: args.now, sourceObservationId: args.observationId,
        reason: r.reason, accepted: true, resolution: "AUTO_ACCEPTED", isSimulated: args.simulated,
      });
    }
    return { changed: r.changed, status: r.status, failures };
  });
}

/** Re-evaluate date-driven lifecycle for all records (e.g. ACTIVE → EXPIRING_SOON → EXPIRED over time). */
export async function refreshLifecycles(now: Date, runId: string, policy: CrawlPolicy, simulated: boolean, isFixtureScope?: boolean): Promise<number> {
  const rows = await db.select().from(scholarships).where(sql`${scholarships.lifecycleStatus} not in ('NO_LONGER_VERIFIABLE','REMOVED')`);
  let n = 0;
  for (const r of rows) {
    if (isFixtureScope !== undefined && r.isFixture !== isFixtureScope) continue;
    const next = computeLifecycle({ closingDate: r.closingDate, openingDate: r.openingDate, signals: r.signals, now, warningDays: policy.lifecycle.warning_window_days });
    if (next.status === r.lifecycleStatus) continue;
    await db.transaction(async (tx) => {
      await tx.update(scholarships).set({ lifecycleStatus: next.status, statusReason: next.reason, lastChangedAt: now, updatedAt: now }).where(eq(scholarships.id, r.id));
      await tx.insert(changeEvents).values({
        scholarshipId: r.id, crawlRunId: runId, fieldName: "lifecycle_status", changeType: "STATUS_CHANGED", oldValue: r.lifecycleStatus as never, newValue: next.status as never,
        detectedAt: now, reason: next.reason, accepted: true, resolution: "AUTO_ACCEPTED", isSimulated: simulated,
      });
    });
    n++;
  }
  return n;
}
