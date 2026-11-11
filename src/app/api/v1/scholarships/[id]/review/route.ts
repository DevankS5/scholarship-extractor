import { timingSafeEqual } from "node:crypto";
import { json } from "@/lib/http";
import { reviewScholarship, type ReviewDecision } from "@/lib/services/review";

export const dynamic = "force-dynamic";

const DECISIONS: ReviewDecision[] = ["APPROVE_CHANGES", "REJECT_RECORD", "RESTORE_RECORD"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Fail closed: reviews need the shared secret in REVIEW_TOKEN (Authorization: Bearer <token>).
  const expected = process.env.REVIEW_TOKEN;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return json({ error: "Forbidden" }, 403);
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { reviewer?: string; decision?: ReviewDecision; rationale?: string };
  if (!b.decision || !DECISIONS.includes(b.decision)) return json({ error: "decision must be one of " + DECISIONS.join(", ") }, 400);
  const r = await reviewScholarship(id, { reviewer: b.reviewer ?? "", decision: b.decision, rationale: b.rationale ?? "" });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}
