import { json } from "@/lib/http";
import { getScholarshipDetail } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = await getScholarshipDetail(id);
  if (!d) return json({ error: "Not found" }, 404);
  return json({ changes: d.changes });
}
