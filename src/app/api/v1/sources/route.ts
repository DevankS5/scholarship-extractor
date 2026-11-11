import { json } from "@/lib/http";
import { listSourcesWithStats } from "@/lib/services/queries";
import { syncSourceRegistry } from "@/lib/services/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  await syncSourceRegistry();
  return json({ items: await listSourcesWithStats() });
}
