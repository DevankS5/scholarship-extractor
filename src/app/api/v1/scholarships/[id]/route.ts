import { json } from "@/lib/http";
import { getScholarshipDetail } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = await getScholarshipDetail(id);
  if (!d) return json({ error: "Not found" }, 404);
  const v = d.latestVerification;
  return json({
    ...d.scholarship,
    confidence_explanation: v ? { components: v.componentScores, penalties: v.penalties, gates: v.gateResults, field_results: v.fieldResults, reasons: v.reasons, policy_version: v.policyVersion } : null,
    source: d.source,
  });
}
