import { json, parseScope } from "@/lib/http";
import { exportScholarships } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rows = await exportScholarships(parseScope(new URL(req.url).searchParams.get("scope")));
  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), count: rows.length, items: rows }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="scholarships-export.json"' },
  });
}
