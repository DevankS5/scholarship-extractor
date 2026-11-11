import { json } from "@/lib/http";
import { startRun } from "@/lib/services/crawl";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { asOf?: string };
  const r = await startRun({ trigger: "MANUAL", scope: "ALL", scholarshipIds: [id], reverifyOnly: true, asOf: body.asOf || null });
  return r.ok ? json({ runId: r.runId }, 202) : json({ error: r.error }, 409);
}
