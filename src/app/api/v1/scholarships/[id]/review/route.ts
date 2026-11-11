import { json } from "@/lib/http";
import { reviewScholarship, type ReviewDecision } from "@/lib/services/review";

export const dynamic = "force-dynamic";

const DECISIONS: ReviewDecision[] = ["APPROVE_CHANGES", "REJECT_RECORD", "RESTORE_RECORD"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { reviewer?: string; decision?: ReviewDecision; rationale?: string };
  if (!b.decision || !DECISIONS.includes(b.decision)) return json({ error: "decision must be one of " + DECISIONS.join(", ") }, 400);
  const r = await reviewScholarship(id, { reviewer: b.reviewer ?? "", decision: b.decision, rationale: b.rationale ?? "" });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}
