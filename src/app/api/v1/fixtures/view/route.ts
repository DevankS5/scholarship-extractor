import { serveFixture } from "@/lib/crawling/fixtures";

export const dynamic = "force-dynamic";

/** Preview what a fixture:// URL currently serves (sandboxed as plain text to avoid executing anything). */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url.startsWith("fixture://")) return new Response("fixture:// URL required", { status: 400 });
  const page = await serveFixture(url);
  return new Response(page.body, { status: page.status, headers: { "content-type": "text/plain; charset=utf-8", "x-fixture": "true" } });
}
