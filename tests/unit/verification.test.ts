import { describe, expect, it } from "vitest";
import { normalizeHtml } from "../../src/lib/crawling/normalize";
import { extractScholarship } from "../../src/lib/extraction/extractor";
import { computeLifecycle, lifecycleAfterFailure } from "../../src/lib/lifecycle/lifecycle";
import { parseRobots, pathAllowed } from "../../src/lib/crawling/robots";
import type { SourceResolution } from "../../src/lib/verification/resolver";
import { calculateConfidence, decideStatus, freshnessPoints, verify } from "../../src/lib/verification/verifier";

const html = `<html><body><main><h1>Example Merit Scholarship</h1><p>Offered by: Example Foundation</p>
<h2>Benefits</h2><p>Awardees receive ₹50,000 per annum.</p>
<h2>Eligibility</h2><ul><li>Open to undergraduate students.</li></ul>
<table><tr><th>Last date to apply</th><td>31 August 2027</td></tr></table>
<h2>How to Apply</h2><p>Apply online.</p><a href="https://provider.example/apply">Apply now</a></main></body></html>`;
const doc = normalizeHtml(html, "https://provider.example/s");
const ex = extractScholarship(doc);
const NOW = new Date("2026-06-01T00:00:00Z");

const res = (over: Partial<SourceResolution> = {}): SourceResolution => ({
  authority: "PRIMARY_CONFIRMED", providerMatch: true, domainMatch: true, sourceId: null, sourceKey: "x", sourceType: "NGO_TRUST",
  officialSourceUrl: "https://provider.example/s", applicationUrl: "https://provider.example/apply", applicationValidated: true,
  rationale: [], unresolvedQuestions: [], officialLinks: [], ...over,
});
const run = (r: SourceResolution, e = ex, now = NOW) => verify({ extraction: e, resolution: r, text: doc.text, observationOk: true, observedAt: NOW, now });

describe("confidence scoring", () => {
  it("is deterministic and reaches VERIFIED when all evidence + gates pass", () => {
    const a = run(res());
    const b = run(res());
    expect(a).toEqual(b);
    expect(a.score).toBe(100);
    expect(a.status).toBe("VERIFIED");
  });
  it("aggregator-only can never be VERIFIED", () => {
    const r = run(res({ authority: "SECONDARY", officialSourceUrl: null }));
    expect(r.status).toBe("REVIEW_REQUIRED");
    expect(r.gates.primary_source_confirmed).toBe(false);
  });
  it("unconfirmed official source stays REVIEW_REQUIRED even with a high raw score", () => {
    const r = run(res({ authority: "PRIMARY_LIKELY" }));
    expect(r.status).toBe("REVIEW_REQUIRED");
  });
  it("a score of 97 does not bypass a failed gate; a score of 94 fails the threshold", () => {
    expect(decideStatus(97, { primary_source_confirmed: false, other: true })).toBe("REVIEW_REQUIRED");
    expect(decideStatus(94, { primary_source_confirmed: true })).toBe("REVIEW_REQUIRED");
    expect(decideStatus(95, { primary_source_confirmed: true })).toBe("VERIFIED");
  });
  it("conflicting deadlines force review", () => {
    const conflicted = { ...ex, conflicts: [{ field: "closing_date", values: ["a", "b"], quotes: [] }] };
    const r = run(res(), conflicted);
    expect(r.gates.no_unresolved_critical_conflict).toBe(false);
    expect(r.status).toBe("REVIEW_REQUIRED");
  });
  it("missing application pathway lowers score below the threshold", () => {
    const noApp = { ...ex, fields: Object.fromEntries(Object.entries(ex.fields).filter(([k]) => k !== "application_url" && k !== "application_instructions")) };
    const r = run(res({ applicationUrl: null, applicationValidated: false }), noApp);
    expect(r.components.application).toBe(0);
    expect(r.status).toBe("REVIEW_REQUIRED");
  });
  it("freshness schedule and clamping", () => {
    expect([3, 10, 20, 45, 90].map(freshnessPoints)).toEqual([10, 8, 5, 2, 0]);
    expect(calculateConfidence({ a: 90, b: 20 }, [])).toBe(100);
    expect(calculateConfidence({ a: 10 }, [25])).toBe(0);
  });
});

describe("lifecycle transitions", () => {
  const base = { openingDate: null, signals: {}, warningDays: 14 };
  it("EXPIRED for a past supported deadline, EXPIRING_SOON inside the window, ACTIVE otherwise", () => {
    expect(computeLifecycle({ ...base, closingDate: "2026-05-01", now: NOW }).status).toBe("EXPIRED");
    expect(computeLifecycle({ ...base, closingDate: "2026-06-10", now: NOW }).status).toBe("EXPIRING_SOON");
    expect(computeLifecycle({ ...base, closingDate: "2026-09-10", now: NOW }).status).toBe("ACTIVE");
  });
  it("never ACTIVE merely because the page is reachable", () => {
    expect(computeLifecycle({ ...base, closingDate: null, now: NOW }).status).toBe("UNKNOWN");
  });
  it("UPCOMING / CLOSED / REMOVED only from explicit evidence", () => {
    expect(computeLifecycle({ ...base, closingDate: "2026-12-01", openingDate: "2026-07-01", now: NOW }).status).toBe("UPCOMING");
    expect(computeLifecycle({ ...base, closingDate: null, signals: { explicitClosed: true }, now: NOW }).status).toBe("CLOSED");
    expect(computeLifecycle({ ...base, closingDate: null, signals: { explicitDiscontinued: true }, now: NOW }).status).toBe("REMOVED");
  });
  it("a single failure never downgrades; repeated failures beyond grace do", () => {
    const f = { previous: "ACTIVE" as const, lastSuccessAt: new Date("2026-05-01T00:00:00Z"), now: NOW, minFailures: 3, graceDays: 14 };
    expect(lifecycleAfterFailure({ ...f, consecutiveFailures: 1 }).status).toBe("ACTIVE");
    expect(lifecycleAfterFailure({ ...f, consecutiveFailures: 3, lastSuccessAt: new Date("2026-05-30T00:00:00Z") }).status).toBe("ACTIVE"); // inside grace
    expect(lifecycleAfterFailure({ ...f, consecutiveFailures: 3 }).status).toBe("NO_LONGER_VERIFIABLE");
    expect(lifecycleAfterFailure({ ...f, previous: "EXPIRED", consecutiveFailures: 9 }).status).toBe("EXPIRED");
  });
});

describe("robots.txt", () => {
  it("honours disallow/allow with longest match", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/open\nSitemap: https://x.example/s.xml");
    expect(pathAllowed(rules, "/private/a")).toBe(false);
    expect(pathAllowed(rules, "/private/open/a")).toBe(true);
    expect(pathAllowed(rules, "/public")).toBe(true);
  });
});
