import { json } from "@/lib/http";
import { getRun } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getRun(id);
  return r ? json(r) : json({ error: "Not found" }, 404);
}
