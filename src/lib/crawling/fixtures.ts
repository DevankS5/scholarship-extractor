/**
 * SIMULATED provider pages used for tests and demos (change detection, stale handling, authority gates).
 * Served through the fixture:// scheme so the whole pipeline can run offline and deterministically.
 * Nothing here is a real organisation or scholarship. Records derived from it are flagged is_fixture.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fixtureState } from "@/db/schema";

export type FixtureMode = "A" | "B" | "ERROR_503" | "NOT_FOUND";

interface FxData {
  name: string;
  provider: string;
  description?: string;
  benefit?: string;
  eligibility?: string[];
  dates?: [string, string][];
  datesStyle?: "table" | "list";
  note?: string[]; // extra paragraphs inside "Important dates" (used for conflicting dates)
  documents?: string[];
  selection?: string;
  renewal?: string;
  apply?: { text: string; url: string } | null;
  howToApply?: string;
  cycle?: string;
}

interface Fixture {
  slug: string;
  host: string;
  listing: string; // listing path on the host
  data: FxData;
  B?: Partial<FxData>;
  sitemapOnly?: boolean; // reachable only via sitemap.xml (discovery mechanism #2)
  lead?: boolean;
}

const D = "fx-education-dept.example";
const U = "fx-institute.example";
const C = "fx-csr-foundation.example";
const T = "fx-trust.example";
const G = "fx-global-fellowship.example";
const X = "fx-unreviewed.example";
const A = "fx-aggregator.example";

const DEPT = "Demo Department of Higher Education";
const INST = "Demo Institute of Technology";
const CSR = "Demo Industries CSR Foundation";
const TRUST = "Demo Education Trust";
const GLOBAL = "Demo Global Fellowship Foundation";

export const FIXTURES: Fixture[] = [
  {
    slug: "fx-dept-postmatric", host: D, listing: "/scholarships",
    data: {
      name: "Demo Post-Matric Scholarship for Meritorious Students (Fixture)", provider: DEPT,
      description: "A simulated central-sector scheme used to test the crawler's extraction and change detection.",
      benefit: "Selected students receive ₹12,000 per annum as a maintenance allowance.",
      eligibility: ["Applicants must be Indian citizens enrolled in a recognised undergraduate programme.", "Candidates must have secured at least 60% marks in the previous qualifying examination.", "Annual family income should not exceed ₹2,50,000."],
      dates: [["Opening date", "01 January 2027"], ["Last date to apply", "31 December 2027"]], datesStyle: "table",
      documents: ["Income certificate", "Previous year marksheet", "Aadhaar card", "Bank account details"],
      selection: "Applications are shortlisted on the basis of marks in the qualifying examination.",
      renewal: "Renewal is subject to securing at least 50% marks in the previous year.",
      apply: { text: "Apply online", url: "fixture://fx-scholarship-portal.example/apply/postmatric" },
      cycle: "Academic Year 2027-28",
    },
    B: { dates: [["Opening date", "01 January 2027"], ["Last date to apply", "15 February 2028"]], benefit: "Selected students receive ₹15,000 per annum as a maintenance allowance." },
  },
  {
    slug: "fx-dept-meritmeans", host: D, listing: "/scholarships",
    data: {
      name: "Demo Merit-cum-Means Scholarship 2025 (Fixture)", provider: DEPT,
      description: "A simulated scheme whose application window has already closed.",
      benefit: "A scholarship of ₹20,000 per annum is paid to selected students.",
      eligibility: ["Open to students of recognised universities pursuing postgraduate studies.", "Minimum 55% marks in graduation."],
      dates: [["Last date to apply", "30 June 2025"]], datesStyle: "table",
      documents: ["Marksheet", "Income certificate"],
      apply: { text: "Apply online", url: "fixture://fx-scholarship-portal.example/apply/meritmeans" },
      cycle: "Academic Year 2025-26",
    },
  },
  {
    slug: "fx-dept-girls", host: D, listing: "/scholarships",
    data: {
      name: "Demo Higher Education Scholarship for Girl Students (Fixture)", provider: DEPT,
      description: "A simulated scheme with no income criterion published.",
      benefit: "Girl students receive a one-time grant of ₹30,000.",
      eligibility: ["This scholarship is open to girl students only.", "Applicants should be enrolled in an undergraduate programme at a recognised institution."],
      dates: [["Last date to apply", "15 January 2028"]], datesStyle: "table",
      documents: ["Enrolment proof", "Bank passbook"],
      apply: { text: "Apply here", url: "fixture://fx-education-dept.example/apply/girls" },
    },
  },
  {
    slug: "fx-univ-meritwaiver", host: U, listing: "/financial-aid",
    data: {
      name: "Demo Institute Merit Tuition Waiver (Fixture)", provider: INST,
      description: "A simulated institutional tuition waiver.",
      benefit: "Selected students receive a full tuition fee waiver for the duration of the course.",
      eligibility: ["Open to B.Tech undergraduate students of the institute.", "Students must maintain a minimum CGPA of 8.5."],
      dates: [], datesStyle: "list",
      note: ["Applications close on 30 November 2027."],
      documents: ["Semester grade card", "Fee receipt"],
      selection: "A committee shortlists students by CGPA and conducts an interview.",
      apply: { text: "Apply online", url: "fixture://fx-institute.example/apply/merit-waiver" },
    },
  },
  {
    slug: "fx-univ-phd", host: U, listing: "/financial-aid",
    data: {
      name: "Demo Institute Doctoral Research Fellowship (Fixture)", provider: INST,
      description: "A simulated research fellowship for doctoral students.",
      benefit: "Fellows receive a stipend of ₹31,000 per month.",
      eligibility: ["Open to full-time doctoral (PhD) scholars admitted to the institute.", "Applicants must have secured at least 65% marks in their master's degree."],
      dates: [["Last date to apply", "30 September 2027"]], datesStyle: "table",
      documents: ["Research proposal", "Master's degree marksheet"],
      selection: "Applicants are interviewed by a research committee.",
      renewal: "Renewal is subject to satisfactory annual progress review.",
      apply: { text: "Apply online", url: "fixture://fx-institute.example/apply/phd-fellowship" },
    },
    B: { benefit: "Fellows receive a stipend of ₹37,000 per month.", dates: [["Last date to apply", "31 October 2027"]] },
  },
  {
    slug: "fx-univ-expired", host: U, listing: "/financial-aid",
    data: {
      name: "Demo Institute Alumni Scholarship 2024 (Fixture)", provider: INST,
      description: "A simulated scholarship from a past cycle.",
      benefit: "Awardees receive ₹25,000 per annum.",
      eligibility: ["Open to undergraduate students of the institute.", "Applicants should have secured at least 70% marks."],
      dates: [["Last date to apply", "31 March 2025"]], datesStyle: "table",
      documents: ["Marksheet"],
      apply: { text: "Apply online", url: "fixture://fx-institute.example/apply/alumni" },
      cycle: "Academic Year 2024-25",
    },
  },
  {
    slug: "fx-csr-engineering", host: C, listing: "/programmes",
    data: {
      name: "Demo CSR Engineering Scholars Programme (Fixture)", provider: CSR,
      description: "A simulated CSR scholarship for engineering undergraduates.",
      benefit: "Scholars receive up to ₹50,000 per annum towards tuition and living costs.",
      eligibility: ["Open to first-year undergraduate engineering students.", "Applicants must be residents of Karnataka.", "Applicants must have secured at least 75% marks in Class 12."],
      dates: [["Last date to apply", "31 August 2027"]], datesStyle: "table",
      documents: ["Class 12 marksheet", "Admission letter", "Residence proof"],
      selection: "Shortlisted applicants attend an online interview.",
      apply: { text: "Apply now", url: "fixture://fx-csr-foundation.example/apply/engineering" },
    },
  },
  {
    slug: "fx-csr-conflict", host: C, listing: "/programmes",
    data: {
      name: "Demo CSR Community College Grant (Fixture)", provider: CSR,
      description: "A simulated grant whose page states two different deadlines.",
      benefit: "A grant of ₹18,000 per annum is awarded.",
      eligibility: ["Open to diploma students enrolled in recognised institutions."],
      dates: [["Last date to apply", "30 September 2027"]], datesStyle: "table",
      note: ["Please note: applications close on 15 October 2027."],
      documents: ["Enrolment certificate"],
      apply: { text: "Apply now", url: "fixture://fx-csr-foundation.example/apply/community" },
    },
  },
  {
    slug: "fx-trust-rolling", host: T, listing: "/grants",
    data: {
      name: "Demo Trust Rolling Education Grant (Fixture)", provider: TRUST,
      description: "A simulated trust grant that accepts applications all year.",
      benefit: "Grants of up to ₹40,000 are provided for tuition fees.",
      eligibility: ["Open to undergraduate students from families with an annual income below ₹3 lakh.", "Preference is given to first-generation learners."],
      note: ["Applications are accepted on a rolling basis throughout the year."],
      documents: ["Fee structure", "Income proof"],
      selection: "Applications are reviewed monthly by the trust's selection panel.",
      apply: { text: "Apply online", url: "fixture://fx-trust.example/apply/rolling" },
    },
  },
  {
    slug: "fx-trust-noapply", host: T, listing: "/grants", sitemapOnly: true,
    data: {
      name: "Demo Trust Learning Support Award (Fixture)", provider: TRUST,
      description: "A simulated award page that publishes no application pathway.",
      benefit: "An award of ₹10,000 is given to selected students.",
      eligibility: ["Open to students pursuing undergraduate studies."],
      dates: [["Last date to apply", "20 December 2027"]], datesStyle: "table",
    },
  },
  {
    slug: "fx-intl-india", host: G, listing: "/fellowships",
    data: {
      name: "Demo Global Fellowship for Indian Scholars (Fixture)", provider: GLOBAL,
      description: "A simulated international fellowship that explicitly includes Indian applicants.",
      benefit: "Fellows receive up to USD 20,000 towards living costs.",
      eligibility: ["Open to citizens of India holding a bachelor's degree.", "Applicants must have secured at least 70% marks in their undergraduate degree.", "Applicants should be applying to a postgraduate programme abroad."],
      dates: [["Last date to apply", "15 November 2027"]], datesStyle: "table",
      documents: ["Statement of purpose", "Two references", "Transcripts"],
      selection: "Shortlisted candidates are interviewed by a panel.",
      apply: { text: "Apply online", url: "fixture://fx-global-fellowship.example/apply/india" },
    },
  },
  {
    slug: "fx-intl-noindia", host: G, listing: "/fellowships",
    data: {
      name: "Demo Global Leadership Fellowship (Fixture)", provider: GLOBAL,
      description: "A simulated fellowship page that never mentions eligibility for Indian applicants.",
      benefit: "Fellows receive up to USD 15,000.",
      eligibility: ["Open to mid-career professionals with five years of experience."],
      dates: [["Last date to apply", "30 October 2027"]], datesStyle: "table",
      apply: { text: "Apply online", url: "fixture://fx-global-fellowship.example/apply/leadership" },
    },
  },
  {
    slug: "fx-unrev-merit", host: X, listing: "/awards",
    data: {
      name: "Demo Unreviewed Foundation Merit Award (Fixture)", provider: "Demo Unreviewed Foundation",
      description: "A simulated award from a provider whose domain ownership is unconfirmed.",
      benefit: "A merit award of ₹15,000 per annum.",
      eligibility: ["Open to undergraduate students with at least 80% marks."],
      dates: [["Last date to apply", "31 July 2027"]], datesStyle: "table",
      documents: ["Marksheet"],
      apply: { text: "Apply online", url: "fixture://fx-unreviewed.example/apply/merit" },
    },
  },
  {
    slug: "fx-agg-only", host: A, listing: "/scholarships", lead: true,
    data: {
      name: "Demo Aggregator-Only Scholarship (Fixture)", provider: "Demo Mystery Foundation",
      description: "An aggregator page describing a scholarship with no link to any provider page.",
      benefit: "A scholarship of ₹60,000 is awarded.",
      eligibility: ["Open to all students."],
      dates: [["Last date to apply", "31 December 2027"]], datesStyle: "table",
      apply: { text: "Apply here", url: "fixture://fx-aggregator.example/form/mystery" },
    },
  },
  {
    slug: "fx-agg-csr-duplicate", host: A, listing: "/scholarships", lead: true,
    data: {
      name: "Demo CSR Engineering Scholars Programme (Fixture)", provider: CSR,
      description: "An aggregator summary of a programme that is officially published elsewhere.",
      benefit: "Scholars receive up to ₹50,000 per annum.",
      eligibility: ["Open to engineering undergraduates."],
      dates: [["Last date to apply", "31 August 2027"]], datesStyle: "table",
      apply: { text: "Official page", url: "fixture://fx-csr-foundation.example/programmes/fx-csr-engineering" },
    },
  },
];

export function fixtureHosts(): string[] {
  return [...new Set(FIXTURES.map((f) => f.host))];
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderDetail(f: Fixture, d: FxData): string {
  const dates = d.dates ?? [];
  const dateBlock =
    d.datesStyle === "table" && dates.length
      ? `<table><caption>Key dates</caption>${dates.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`
      : dates.length
        ? `<ul>${dates.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>`
        : "";
  const notes = (d.note ?? []).map((n) => `<p>${esc(n)}</p>`).join("");
  return `<!doctype html><html><head><title>${esc(d.name)} | ${esc(d.provider)}</title></head><body>
<header><nav><a href="/">Home</a> <a href="/about">About us</a> <a href="/login">Login</a></nav></header>
<main>
<h1>${esc(d.name)}</h1>
<p>Offered by: ${esc(d.provider)}</p>
${d.cycle ? `<p>${esc(d.cycle)}</p>` : ""}
${d.description ? `<h2>About the scholarship</h2><p>${esc(d.description)}</p>` : ""}
${d.benefit ? `<h2>Benefits</h2><p>${esc(d.benefit)}</p>` : ""}
${d.eligibility ? `<h2>Eligibility Criteria</h2><ul>${d.eligibility.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
${dateBlock || notes ? `<h2>Important Dates</h2>${dateBlock}${notes}` : ""}
${d.documents?.length ? `<h2>Documents Required</h2><ul>${d.documents.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
${d.selection ? `<h2>Selection Process</h2><p>${esc(d.selection)}</p>` : ""}
${d.renewal ? `<h2>Renewal</h2><p>${esc(d.renewal)}</p>` : ""}
${d.apply ? `<h2>How to Apply</h2><p>${esc(d.howToApply ?? "Candidates must apply through the online application form.")}</p><p><a href="${esc(d.apply.url)}">${esc(d.apply.text)}</a></p>` : ""}
</main>
<footer>Simulated fixture page for software testing. Not a real organisation.</footer>
</body></html>`;
}

export interface ServedPage {
  status: number;
  contentType: string;
  body: string;
}

export async function getFixtureMode(slug: string): Promise<FixtureMode> {
  const row = (await db.select().from(fixtureState).where(eq(fixtureState.slug, slug)).limit(1))[0];
  return (row?.mode as FixtureMode) ?? "A";
}

export async function listFixtureStates() {
  const rows = await db.select().from(fixtureState);
  const m = new Map(rows.map((r) => [r.slug, r.mode as FixtureMode]));
  return FIXTURES.map((f) => ({
    slug: f.slug,
    name: f.data.name,
    host: f.host,
    url: `fixture://${f.host}${f.listing}/${f.slug}`,
    mode: m.get(f.slug) ?? ("A" as FixtureMode),
    hasVersionB: !!f.B,
    lead: !!f.lead,
  }));
}

export async function setFixtureMode(slug: string, mode: FixtureMode) {
  if (!FIXTURES.some((f) => f.slug === slug)) throw new Error("Unknown fixture " + slug);
  await db
    .insert(fixtureState)
    .values({ slug, mode, updatedAt: new Date() })
    .onConflictDoUpdate({ target: fixtureState.slug, set: { mode, updatedAt: new Date() } });
}

export async function resetFixtures() {
  await db.delete(fixtureState);
}

/** Serve a fixture:// URL. */
export async function serveFixture(url: string): Promise<ServedPage> {
  const u = new URL(url);
  const host = u.hostname;
  const path = u.pathname.replace(/\/$/, "") || "/";
  const forHost = FIXTURES.filter((f) => f.host === host);
  if (!forHost.length) return { status: 404, contentType: "text/html", body: "<html><body>Not found</body></html>" };

  if (path === "/sitemap.xml") {
    // only pages NOT linked from the listing appear here => proves discovery through a second mechanism
    const urls = forHost.filter((f) => f.sitemapOnly).map((f) => `<url><loc>fixture://${host}${f.listing}/${f.slug}</loc></url>`).join("");
    return { status: 200, contentType: "application/xml", body: `<?xml version="1.0"?><urlset>${urls}</urlset>` };
  }
  if (path === forHost[0].listing) {
    const items = forHost.filter((f) => !f.sitemapOnly);
    const body = `<!doctype html><html><head><title>Scholarships and financial aid</title></head><body>
<header><nav><a href="/">Home</a> <a href="/about">About us</a> <a href="/login">Login</a> <a href="/news/archive">News archive</a></nav></header>
<main><h1>Scholarships and financial aid</h1><p>Browse the programmes below.</p><ul>
${items
  .map((f) => {
    const href = `fixture://${host}${f.listing}/${f.slug}`;
    const official = f.slug === "fx-agg-csr-duplicate" ? "" : "";
    return `<li><a href="${href}">${esc(f.data.name)}</a>${official}</li>`;
  })
  .join("")}
</ul>${host === A ? `<p>Official provider pages: <a href="fixture://${C}/programmes/fx-csr-engineering">Demo CSR Engineering Scholars Programme - provider scholarship page</a></p>` : ""}</main>
<footer>Simulated fixture listing.</footer></body></html>`;
    return { status: 200, contentType: "text/html; charset=utf-8", body };
  }
  const slug = path.split("/").pop() ?? "";
  const f = forHost.find((x) => x.slug === slug);
  if (!f) return { status: 404, contentType: "text/html", body: "<html><body>Not found</body></html>" };
  const mode = await getFixtureMode(f.slug);
  if (mode === "ERROR_503") return { status: 503, contentType: "text/html", body: "<html><body>Service unavailable</body></html>" };
  if (mode === "NOT_FOUND") return { status: 404, contentType: "text/html", body: "<html><body>Not found</body></html>" };
  const data = mode === "B" && f.B ? { ...f.data, ...f.B } : f.data;
  return { status: 200, contentType: "text/html; charset=utf-8", body: renderDetail(f, data) };
}
