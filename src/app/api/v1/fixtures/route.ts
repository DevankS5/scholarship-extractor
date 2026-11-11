import { json } from "@/lib/http";
import { listFixtureStates, resetFixtures, setFixtureMode, type FixtureMode } from "@/lib/crawling/fixtures";

export const dynamic = "force-dynamic";

const MODES: FixtureMode[] = ["A", "B", "ERROR_503", "NOT_FOUND"];

export async function GET() {
  return json({ note: "SIMULATED fixture providers for tests/demos only.", items: await listFixtureStates() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; slug?: string; mode?: FixtureMode };
  if (b.action === "reset") {
    await resetFixtures();
    return json({ ok: true });
  }
  if (!b.slug || !b.mode || !MODES.includes(b.mode)) return json({ error: "slug and mode (A|B|ERROR_503|NOT_FOUND) required" }, 400);
  try {
    await setFixtureMode(b.slug, b.mode);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
