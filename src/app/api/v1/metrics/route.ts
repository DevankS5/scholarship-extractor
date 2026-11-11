import { json, parseScope } from "@/lib/http";
import { getMetrics } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scope = parseScope(new URL(req.url).searchParams.get("scope"));
  return json(await getMetrics(scope));
}
