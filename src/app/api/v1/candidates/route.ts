import { db } from "@/db";
import { discoveredCandidates } from "@/db/schema";
import { json, parseScope } from "@/lib/http";
import { listCandidates } from "@/lib/services/queries";
import { syncSourceRegistry } from "@/lib/services/registry";
import { findSourceForUrl } from "@/lib/verification/resolver";
import { normalizeUrl } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return json(await listCandidates({ status: q.get("status") ?? undefined, classification: q.get("classification") ?? undefined, scope: parseScope(q.get("scope")), page: Number(q.get("page") ?? 1) }));
}

/** Submit a URL as a discovery LEAD. It is fetched on the next run and still has to pass source resolution + verification. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { url?: string };
  const norm = b.url ? normalizeUrl(b.url) : null;
  if (!norm || norm.startsWith("fixture:")) return json({ error: "A valid http(s) URL is required." }, 400);
  const all = await syncSourceRegistry();
  const src = findSourceForUrl(norm, all);
  const [row] = await db
    .insert(discoveredCandidates)
    .values({
      discoveredUrl: b.url!, normalizedUrl: norm, discoveryMethod: "MANUAL", sourceId: src?.id ?? null, sourceType: src?.sourceType ?? null,
      classification: !src ? "UNKNOWN" : src.authorityLevel === "PRIMARY" ? "OFFICIAL" : "LEAD", processingStatus: "QUEUED", statusReason: "Manually submitted; awaiting next run",
    })
    .onConflictDoNothing()
    .returning();
  return json(row ? { created: true, candidate: row } : { created: false, message: "URL already known" }, row ? 201 : 200);
}
