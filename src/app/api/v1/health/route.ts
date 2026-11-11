import { sql } from "drizzle-orm";
import { db } from "@/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return json({ ok: true, service: "scholarship-intelligence-crawler", time: new Date().toISOString() });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
}
