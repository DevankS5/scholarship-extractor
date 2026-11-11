import { json } from "@/lib/http";
import { startRun } from "@/lib/services/crawl";
import { listRuns } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ items: await listRuns(50) });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { scope?: string; asOf?: string; sourceKeys?: string[]; maxPages?: number };
  const scope = b.scope === "LIVE" || b.scope === "FIXTURES" ? b.scope : "ALL";
  if (b.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(b.asOf)) return json({ error: "asOf must be YYYY-MM-DD" }, 400);
  const r = await startRun({ trigger: "MANUAL", scope, asOf: b.asOf || null, sourceKeys: b.sourceKeys, maxPages: b.maxPages });
  return r.ok ? json({ runId: r.runId }, 202) : json({ error: r.error }, 409);
}
