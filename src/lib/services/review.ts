import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { changeEvents, reviewActions, scholarships, scholarshipVersions, verificationResults } from "@/db/schema";
import { MATERIAL_KEYS, snapshotToColumns, type Snapshot } from "./persist";
import { computeLifecycle } from "../lifecycle/lifecycle";
import { getCrawlPolicy } from "../config";
import { sha256, stableStringify } from "../util";

export type ReviewDecision = "APPROVE_CHANGES" | "REJECT_RECORD" | "RESTORE_RECORD";

/** Human review actions are logged with reviewer, timestamp, decision and rationale. */
export async function reviewScholarship(id: string, input: { reviewer: string; decision: ReviewDecision; rationale: string }) {
  if (!input.reviewer.trim() || !input.rationale.trim()) return { ok: false as const, error: "Reviewer and rationale are required." };
  return db.transaction(async (tx) => {
    const row = (await tx.select().from(scholarships).where(eq(scholarships.id, id)).limit(1))[0];
    if (!row) return { ok: false as const, error: "Scholarship not found." };
    const now = new Date();
    await tx.insert(reviewActions).values({ scholarshipId: id, reviewer: input.reviewer.trim(), decision: input.decision, rationale: input.rationale.trim() });
    const lastVer = (await tx.select().from(verificationResults).where(eq(verificationResults.scholarshipId, id)).orderBy(desc(verificationResults.evaluatedAt)).limit(1))[0];

    if (input.decision === "REJECT_RECORD") {
      await tx.update(scholarships).set({ verificationStatus: "REJECTED", statusReason: `Rejected by ${input.reviewer}: ${input.rationale}`, updatedAt: now }).where(eq(scholarships.id, id));
      await tx.insert(changeEvents).values({ scholarshipId: id, fieldName: "verification_status", changeType: "STATUS_CHANGED", oldValue: row.verificationStatus as never, newValue: "REJECTED" as never, reason: `Reviewer decision: ${input.rationale}`, accepted: true, resolution: "AUTO_ACCEPTED" });
      return { ok: true as const };
    }

    if (input.decision === "RESTORE_RECORD") {
      const status = lastVer?.status ?? "REVIEW_REQUIRED";
      await tx.update(scholarships).set({ verificationStatus: status, updatedAt: now }).where(eq(scholarships.id, id));
      await tx.insert(changeEvents).values({ scholarshipId: id, fieldName: "verification_status", changeType: "STATUS_CHANGED", oldValue: row.verificationStatus as never, newValue: status as never, reason: `Reviewer restored record: ${input.rationale}`, accepted: true, resolution: "AUTO_ACCEPTED" });
      return { ok: true as const };
    }

    // APPROVE_CHANGES: apply every pending proposed value as a new immutable version
    const pending = await tx.select().from(changeEvents).where(and(eq(changeEvents.scholarshipId, id), eq(changeEvents.resolution, "PENDING_REVIEW"))).orderBy(desc(changeEvents.detectedAt));
    if (!pending.length) return { ok: false as const, error: "There are no pending changes to approve." };
    const cur = row.currentVersionId ? (await tx.select().from(scholarshipVersions).where(eq(scholarshipVersions.id, row.currentVersionId)).limit(1))[0] : undefined;
    const snap: Snapshot = { ...(cur?.recordSnapshot ?? {}) };
    const seen = new Set<string>();
    for (const ev of pending) {
      if (seen.has(ev.fieldName)) continue; // newest proposal per field wins
      seen.add(ev.fieldName);
      snap[ev.fieldName] = ev.newValue;
    }
    const life = computeLifecycle({ closingDate: (snap.closing_date as string | null) ?? null, openingDate: (snap.opening_date as string | null) ?? null, signals: row.signals, now, warningDays: getCrawlPolicy().lifecycle.warning_window_days });
    const status = lastVer?.status ?? "REVIEW_REQUIRED";
    const [v] = await tx
      .insert(scholarshipVersions)
      .values({
        scholarshipId: id, versionNumber: (cur?.versionNumber ?? 0) + 1, recordSnapshot: snap,
        contentFingerprint: sha256(stableStringify(MATERIAL_KEYS.map((k) => snap[k]))), verificationStatus: status, lifecycleStatus: life.status, confidenceScore: row.confidenceScore,
      })
      .returning({ id: scholarshipVersions.id });
    const flags = row.flags.filter((f) => f !== "PENDING_REVIEW");
    await tx
      .update(scholarships)
      .set({ ...snapshotToColumns(snap), currentVersionId: v.id, verificationStatus: status, lifecycleStatus: life.status, statusReason: `Changes approved by ${input.reviewer}. ${life.reason}`, flags, lastChangedAt: now, updatedAt: now })
      .where(eq(scholarships.id, id));
    for (const ev of pending) {
      await tx.update(changeEvents).set({ resolution: "APPROVED", accepted: true }).where(eq(changeEvents.id, ev.id));
    }
    return { ok: true as const };
  });
}
