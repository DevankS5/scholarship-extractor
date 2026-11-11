import { json } from "@/lib/http";
import { getScholarshipDetail } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = await getScholarshipDetail(id);
  if (!d) return json({ error: "Not found" }, 404);
  return json({
    current_version_field_evidence: d.fieldEvidence.map((x) => ({
      field: x.fe.fieldName, normalized_value: x.fe.normalizedValue, raw_value: x.fe.rawValue, support_status: x.fe.supportStatus, method: x.fe.extractionMethod,
      evidence: x.ev && { source_url: x.ev.sourceUrl, quote: x.ev.evidenceText, section: x.ev.sectionHeading, page: x.ev.pageNumber, captured_at: x.ev.capturedAt, observation_id: x.ev.fetchObservationId, type: x.ev.evidenceType, start: x.ev.textStartOffset, end: x.ev.textEndOffset },
    })),
    all_evidence: d.evidence,
  });
}
