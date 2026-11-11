/* CLI: npx tsx scripts/run-crawl.ts [--scope LIVE|FIXTURES|ALL] [--as-of YYYY-MM-DD] [--max-pages N] [--reverify-only] */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { crawlRuns } from "../src/db/schema";
import { runAndWait } from "../src/lib/services/crawl";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const scopeArg = (arg("scope") ?? "ALL").toUpperCase();
  const scope = scopeArg === "LIVE" || scopeArg === "FIXTURES" ? scopeArg : "ALL";
  const r = await runAndWait({
    trigger: "CLI",
    scope,
    asOf: arg("as-of") ?? null,
    maxPages: arg("max-pages") ? Number(arg("max-pages")) : undefined,
    reverifyOnly: process.argv.includes("--reverify-only"),
  });
  if (r.runId) {
    const run = (await db.select().from(crawlRuns).where(eq(crawlRuns.id, r.runId)))[0];
    console.log(run.log.join("\n"));
    console.log(`\nRUN ${run.id} → ${run.status}`);
  } else console.error(r.error);
  await pool.end();
  process.exit(r.ok ? 0 : 1);
}
main();
