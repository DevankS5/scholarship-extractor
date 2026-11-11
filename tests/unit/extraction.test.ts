import { describe, expect, it } from "vitest";
import { normalizeHtml } from "../../src/lib/crawling/normalize";
import { extractScholarship } from "../../src/lib/extraction/extractor";
import { findAmounts, findDates, identityFingerprint, normalizeUrl, quoteInText } from "../../src/lib/util";

const page = (body: string) => `<html><head><title>x</title></head><body><nav><a href="/login">Login</a></nav><main>${body}</main></body></html>`;
const BASE = "https://provider.example/scholarship";

const FULL = page(`
<h1>Example Merit Scholarship</h1><p>Offered by: Example Foundation</p>
<h2>Benefits</h2><p>Awardees receive up to ₹50,000 per annum.</p>
<h2>Eligibility</h2><ul><li>Open to undergraduate students.</li><li>Candidates must have secured at least 75% marks.</li><li>Annual family income should not exceed ₹3,00,000.</li></ul>
<table><tr><th>Last date to apply</th><td>31 August 2026</td></tr></table>
<h2>How to Apply</h2><p>Apply online.</p><a href="https://provider.example/apply">Apply now</a>`);

describe("extraction", () => {
  const ex = extractScholarship(normalizeHtml(FULL, BASE));

  it("emits a schema-valid scholarship candidate with evidence for each field", () => {
    expect(ex.isScholarshipPage).toBe(true);
    expect(ex.fields.name.value).toBe("Example Merit Scholarship");
    expect(ex.fields.provider_name.value).toBe("Example Foundation");
    expect(ex.fields.closing_date.value).toBe("2026-08-31");
    expect((ex.fields.amount.value as { max: number }).max).toBe(50000);
    expect((ex.fields.amount.value as { min: number | null }).min).toBeNull(); // "up to" is a cap, not a guarantee
    expect((ex.fields.income_criteria.value as { amount: number }).amount).toBe(300000);
    expect(ex.fields.application_url.value).toBe("https://provider.example/apply");
  });

  it("every quote exists in the normalised source text", () => {
    const doc = normalizeHtml(FULL, BASE);
    for (const f of Object.values(ex.fields)) expect(quoteInText(doc.text, f.quote)).toBe(true);
    expect(ex.droppedFields).toEqual([]);
  });

  it("leaves missing facts null (no income threshold inferred)", () => {
    const r = extractScholarship(normalizeHtml(page(`<h1>Example Scholarship</h1><p>Offered by: Example Foundation</p><h2>Eligibility</h2><ul><li>Open to students.</li></ul><h2>Benefits</h2><p>₹10,000 scholarship.</p><p>Apply at the portal.</p>`), BASE));
    expect(r.fields.income_criteria).toBeUndefined();
    expect(r.fields.closing_date).toBeUndefined();
    expect(r.flags).toContain("DEADLINE_UNSUPPORTED");
  });

  it("does not guess a year and does not pick between conflicting deadlines", () => {
    expect(findDates("Last date: 31 August")).toHaveLength(0);
    const r = extractScholarship(normalizeHtml(page(`<h1>Example Grant</h1><h2>Eligibility</h2><p>Open to all students.</p><h2>Benefits</h2><p>₹5,000 grant.</p><p>Last date to apply: 30 September 2027.</p><p>Applications close on 15 October 2027.</p>`), BASE));
    expect(r.fields.closing_date).toBeUndefined();
    expect(r.conflicts[0].field).toBe("closing_date");
    expect(r.conflicts[0].values.sort()).toEqual(["2027-09-30", "2027-10-15"]);
  });

  it("does not treat a listing page as a scholarship", () => {
    const r = extractScholarship(normalizeHtml(page(`<h1>Scholarships and financial aid</h1><ul><li><a href="/a">Scheme A</a></li><li><a href="/b">Scheme B</a></li></ul>`), BASE));
    expect(r.isScholarshipPage).toBe(false);
  });

  it("parses amounts and Indian numeric dates", () => {
    expect(findAmounts("worth Rs. 2 lakh per annum")[0]).toMatchObject({ value: 200000, currency: "INR", frequency: "ANNUAL" });
    expect(findDates("deadline 05/09/2026")[0].iso).toBe("2026-09-05");
    expect(findDates("by 5th Sept, 2026")[0].iso).toBe("2026-09-05");
    expect(findDates("31/02/2026")).toHaveLength(0);
  });
});

describe("deduplication & URL normalisation", () => {
  it("normalises tracking params, fragments, host case and trailing slash", () => {
    expect(normalizeUrl("HTTPS://Example.org/Schemes/?utm_source=x&b=2&a=1#top")).toBe("https://example.org/Schemes/?a=1&b=2");
    expect(normalizeUrl("https://example.org/a/")).toBe("https://example.org/a");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("keeps cycles distinct but merges case/punctuation variants", () => {
    const a = identityFingerprint("Example Foundation", "Merit Scholarship (Fixture)", "2026-27");
    expect(identityFingerprint("example  foundation", "MERIT scholarship", "2026-27")).toBe(a);
    expect(identityFingerprint("Example Foundation", "Merit Scholarship", "2027-28")).not.toBe(a);
  });
});
