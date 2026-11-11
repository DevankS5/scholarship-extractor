/*
 * Reproducible end-to-end demonstration on ONE persisted database (idempotency, change detection, expiry, stale).
 * Uses the SIMULATED fixture providers only. Run: npx tsx scripts/demo.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { resetFixtures, setFixtureMode } from "../src/lib/crawling/fixtures";
import { runAndWait } from "../src/lib/services/crawl";

async function counts(label: string) {
  const r = (
    await db.execute(sql`select
      (select count(*)::int from scholarships where is_fixture) as records,
      (select count(*)::int from scholarship_versions) as versions,
      (select count(*)::int from change_events) as events,
      (select count(*)::int from fetch_observations) as observations,
      (select count(*)::int from scholarships where is_fixture and verification_status='VERIFIED') as verified,
      (select count(*)::int from scholarships where is_fixture and lifecycle_status='EXPIRED') as expired,
      (select count(*)::int from scholarships where lifecycle_status='NO_LONGER_VERIFIABLE') as stale`)
  ).rows[0];
  console.log(label.padEnd(34), JSON.stringify(r));
}

const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function main() {
  await resetFixtures();
  await counts("start");
  await runAndWait({ trigger: "TEST", scope: "FIXTURES" });
  await counts("after run 1 (baseline)");
  await runAndWait({ trigger: "TEST", scope: "FIXTURES" });
  await counts("after run 2 (identical → no new events/versions)");

  await setFixtureMode("fx-dept-postmatric", "B");
  await setFixtureMode("fx-univ-phd", "B");
  await runAndWait({ trigger: "TEST", scope: "FIXTURES" });
  await counts("after run 3 (2 fixtures changed → events)");
  await runAndWait({ trigger: "TEST", scope: "FIXTURES" });
  await counts("after run 4 (identical again)");

  await setFixtureMode("fx-trust-rolling", "ERROR_503");
  for (const d of [20, 25, 30]) {
    await runAndWait({ trigger: "TEST", scope: "FIXTURES", asOf: plus(d) });
    await counts(`after failed run (simulated +${d}d)`);
  }
  await pool.end();
}
main();
