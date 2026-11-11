/**
 * Stage A: deterministic, evidence-first extraction.
 * Every non-null field carries an exact quote from the normalised source text. Anything that cannot be
 * tied to a quote stays null. A final validation pass drops any field whose quote is not in the text.
 */
import type { NormalizedDocument } from "../crawling/normalize";
import { collapseWs, findAmounts, findDates, quoteInText } from "../util";

export type Support = "SUPPORTED" | "PARTIALLY_SUPPORTED";

export interface FieldValue {
  field: string;
  value: unknown;
  raw: string | null;
  quote: string;
  start: number;
  end: number;
  method: string;
  support: Support;
  section: string | null;
}

export interface ExtractionResult {
  fields: Record<string, FieldValue>;
  conflicts: { field: string; values: string[]; quotes: string[] }[];
  flags: string[];
  isScholarshipPage: boolean;
  pageSignals: string[];
  signals: { explicitClosed: boolean; explicitOpen: boolean; explicitDiscontinued: boolean; indiaMentioned: boolean };
  signalQuotes: Record<string, string>;
  droppedFields: string[];
}

export interface ExtractContext {
  providerName?: string | null;
  providerAliases?: string[];
}

interface Line {
  t: string;
  start: number;
  end: number;
  heading: 0 | 1 | 2;
}
interface Section {
  heading: string;
  lines: Line[];
  start: number;
  end: number;
}

export const STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh"];

function parseLines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    const heading: 0 | 1 | 2 = raw.startsWith("## ") ? 2 : raw.startsWith("# ") ? 1 : 0;
    const t = heading ? raw.replace(/^#{1,2}\s+/, "") : raw;
    out.push({ t, start: pos + (raw.length - t.length), end: pos + raw.length, heading });
    pos += raw.length + 1;
  }
  return out;
}

function buildSections(lines: Line[]): Section[] {
  const secs: Section[] = [];
  let cur: Section | null = null;
  for (const l of lines) {
    if (l.heading) {
      cur = { heading: l.t, lines: [], start: l.end, end: l.end };
      secs.push(cur);
    } else if (cur) {
      if (!cur.lines.length) cur.start = l.start;
      cur.lines.push(l);
      cur.end = l.end;
    }
  }
  return secs;
}

const ELIG_H = /^(eligibility(?: criteria| conditions)?|who can apply|who is eligible|criteria|eligible candidates|applicant requirements|eligibility and selection)/i;
const BENEFIT_H = /(benefit|award|scholarship amount|financial|stipend|fellowship value|funding|what you get|amount|value of)/i;
const DOC_H = /^(documents?(?: required| needed)?|required documents|attachments|supporting documents)/i;
const SEL_H = /^(selection(?: process| procedure| criteria)?|evaluation|shortlisting|how (?:are )?(?:candidates|students|applicants) (?:are )?selected)/i;
const REN_H = /^(renewal|continuation|renewal criteria|renewal of scholarship)/i;
const HOW_H = /^(how to apply|application (?:process|procedure|instructions)|apply|procedure to apply)/i;
const ABOUT_H = /^(about|overview|introduction|description|about the scholarship|about the scheme|objective|background)/i;
const NAME_KEYWORDS = /(scholarship|fellowship|stipend|bursary|freeship|financial (?:assistance|aid|support)|grant|award|scheme|prize|waiver|assistance|programme|program)/i;

function sentenceAround(line: Line, text: string, idx: number, len: number): { quote: string; start: number } {
  if (line.t.length <= 260) return { quote: line.t, start: line.start };
  const s = Math.max(0, idx - 110);
  const e = Math.min(line.t.length, idx + len + 110);
  const q = line.t.slice(s, e);
  return { quote: q, start: text.indexOf(q, line.start) };
}

export function extractScholarship(doc: NormalizedDocument, ctx: ExtractContext = {}): ExtractionResult {
  const text = doc.text;
  const lines = parseLines(text);
  const linksIdx = lines.findIndex((l) => l.heading && l.t === "Links");
  const contentLines = (linksIdx >= 0 ? lines.slice(0, linksIdx) : lines).filter((l) => l.t.trim());
  const linkLines = linksIdx >= 0 ? lines.slice(linksIdx + 1) : [];
  const sections = buildSections(contentLines).filter((s) => s.heading !== "Links");
  const fields: Record<string, FieldValue> = {};
  const conflicts: ExtractionResult["conflicts"] = [];
  const flags: string[] = [];

  const put = (
    field: string,
    value: unknown,
    raw: string | null,
    quote: string,
    start: number,
    method: string,
    section: string | null = null,
    support: Support = "SUPPORTED",
  ) => {
    if (!quote) return;
    const s = start >= 0 ? start : Math.max(0, text.indexOf(quote));
    fields[field] = { field, value, raw, quote, start: s, end: s + quote.length, method, support, section };
  };
  const findSection = (re: RegExp) => sections.find((s) => re.test(s.heading) && s.lines.length);
  const sectionText = (s: Section) => text.slice(s.start, s.end);
  const sectionQuote = (s: Section) => sectionText(s).slice(0, 400);
  const bullets = (s: Section) => s.lines.map((l) => l.t.replace(/^-\s+/, "").trim()).filter(Boolean);

  // ---------------- name
  const h1 = lines.find((l) => l.heading === 1 && l.t.trim());
  let nameLine: Line | undefined = h1;
  if (!nameLine) nameLine = lines.find((l) => l.heading === 2 && NAME_KEYWORDS.test(l.t) && l.t !== "Links");
  if (nameLine) {
    const name = collapseWs(nameLine.t.replace(/\s+[|–—]\s+.*$/, ""));
    if (name.length >= 4 && name.length <= 220) put("name", name, nameLine.t, nameLine.t, nameLine.start, "HEADING", "title");
  } else if (doc.title && text.includes(doc.title)) {
    put("name", doc.title, doc.title, doc.title, text.indexOf(doc.title), "DOC_TITLE", "title");
  }

  // ---------------- provider
  const labelRe = /^(?:offered by|provider|organi[sz]ed by|awarded by|sponsored by|issued by|scheme of|implemented by|funded by)\s*[:\-–]\s*(.{3,140})$/i;
  let providerDone = false;
  for (const l of contentLines) {
    const m = labelRe.exec(l.t);
    if (m) {
      put("provider_name", collapseWs(m[1]).replace(/[.]$/, ""), l.t, l.t, l.start, "LABEL", null);
      providerDone = true;
      break;
    }
  }
  if (!providerDone) {
    const aliases = [ctx.providerName, ...(ctx.providerAliases ?? [])].filter((x): x is string => !!x);
    outer: for (const alias of aliases) {
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const hits = contentLines.filter((l) => re.test(l.t));
      if (hits.length) {
        const l = hits[0];
        const m = re.exec(l.t)!;
        const q = sentenceAround(l, text, m.index, m[0].length);
        const strong = hits.length >= 2 || contentLines.indexOf(l) < 15 || l.heading > 0;
        put("provider_name", ctx.providerName || alias, m[0], q.quote, q.start, "ALIAS_MATCH", null, strong ? "SUPPORTED" : "PARTIALLY_SUPPORTED");
        break outer;
      }
    }
  }

  // ---------------- academic cycle
  for (const l of contentLines) {
    const m = /(?:academic\s+(?:year|session)|session|A\.?Y\.?)\s*[:\-]?\s*(20\d{2})\s*[-–/]\s*(\d{2,4})/i.exec(l.t);
    if (m) {
      put("academic_cycle", `${m[1]}-${m[2].slice(-2)}`, m[0], l.t.length <= 260 ? l.t : m[0], l.start, "REGEX");
      break;
    }
  }

  // ---------------- description
  const about = findSection(ABOUT_H);
  if (about) {
    const first = about.lines[0];
    const q = first.t.slice(0, 500);
    put("description", collapseWs(q), q, q, first.start, "SECTION", about.heading);
  }

  // ---------------- amount / benefit
  const benefitSecs = sections.filter((s) => BENEFIT_H.test(s.heading) && s.lines.length);
  const amountLines = [...benefitSecs.flatMap((s) => s.lines), ...contentLines.filter((l) => !l.heading)];
  for (const l of amountLines) {
    if (/income|salary|application fee|registration fee|processing fee/i.test(l.t)) continue;
    const amts = findAmounts(l.t);
    if (!amts.length) continue;
    const kw = /scholarship|stipend|fellowship|award|benefit|grant|tuition|amount|assistance|allowance|funding|worth|receive|paid|up to/i.test(l.t);
    if (!kw && !benefitSecs.some((s) => s.lines.includes(l))) continue;
    const a = amts[0];
    const second = amts[1];
    const rangeJoin = second ? /\b(to|and|-|–)\b/i.test(l.t.slice(a.index + a.raw.length, second.index)) : false;
    let min: number | null = a.value;
    let max: number | null = a.value;
    if (a.upTo) min = null;
    if (rangeJoin && second) {
      min = Math.min(a.value, second.value);
      max = Math.max(a.value, second.value);
    }
    const freq = a.frequency ?? amts.find((x) => x.frequency)?.frequency ?? (/per\s+month|monthly/i.test(l.t) ? "MONTHLY" : /per\s+annum|annual|per\s+year/i.test(l.t) ? "ANNUAL" : /one[- ]time/i.test(l.t) ? "ONE_TIME" : null);
    const q = sentenceAround(l, text, a.index, a.raw.length);
    put("amount", { raw: a.raw, min, max, currency: a.currency, frequency: freq, up_to: a.upTo }, a.raw, q.quote, q.start, "REGEX", null);
    break;
  }
  for (const l of amountLines) {
    const m = /(tuition (?:fee )?waiver|fee waiver|stipend|reimbursement|maintenance allowance)/i.exec(l.t);
    if (m && !/income/i.test(l.t)) {
      const t = m[1].toLowerCase();
      const type = t.includes("tuition") ? "TUITION_WAIVER" : t.includes("waiver") ? "FEE_WAIVER" : t.includes("stipend") || t.includes("allowance") ? "STIPEND" : "REIMBURSEMENT";
      const q = sentenceAround(l, text, m.index, m[0].length);
      put("benefit_type", type, m[0], q.quote, q.start, "KEYWORD");
      break;
    }
  }

  // ---------------- dates (never guess a year; conflicting closing dates are NOT resolved silently)
  const closeRe = /(last\s+date|closing\s+date|close[sd]?\b|deadline|due\s+date|apply\s+(?:by|before|until)|submit\w*\s+(?:by|before)|end\s+date|applications?\s+(?:will\s+)?(?:close|end)|last\s+day)/gi;
  const openRe = /(opening\s+date|start(?:ing)?\s+date|opens?\s+on|applications?\s+(?:open|begin|start|commence)|commence(?:s|ment)?)/gi;
  const closings: { iso: string; line: Line; raw: string }[] = [];
  const openings: { iso: string; line: Line; raw: string }[] = [];
  for (const l of contentLines) {
    if (l.heading) continue;
    const ds = findDates(l.t);
    if (!ds.length) continue;
    const labels: { idx: number; kind: "open" | "close" }[] = [];
    for (const m of l.t.matchAll(closeRe)) labels.push({ idx: m.index!, kind: "close" });
    for (const m of l.t.matchAll(openRe)) labels.push({ idx: m.index!, kind: "open" });
    labels.sort((a, b) => a.idx - b.idx);
    for (const d of ds) {
      const prev = [...labels].reverse().find((x) => x.idx < d.index);
      if (!prev) continue;
      (prev.kind === "close" ? closings : openings).push({ iso: d.iso, line: l, raw: d.raw });
    }
  }
  const distinct = (arr: { iso: string }[]) => [...new Set(arr.map((a) => a.iso))];
  if (distinct(closings).length === 1) {
    const c = closings[0];
    put("closing_date", c.iso, c.raw, c.line.t.slice(0, 300), c.line.start, "LABELLED_DATE");
  } else if (distinct(closings).length > 1) {
    conflicts.push({ field: "closing_date", values: distinct(closings), quotes: [...new Set(closings.map((c) => c.line.t.slice(0, 300)))] });
    flags.push("SOURCE_CONFLICT");
  }
  if (distinct(openings).length === 1) {
    const o = openings[0];
    put("opening_date", o.iso, o.raw, o.line.t.slice(0, 300), o.line.start, "LABELLED_DATE");
  } else if (distinct(openings).length > 1) {
    conflicts.push({ field: "opening_date", values: distinct(openings), quotes: [...new Set(openings.map((c) => c.line.t.slice(0, 300)))] });
    flags.push("SOURCE_CONFLICT");
  }
  if (!fields.closing_date && !conflicts.some((c) => c.field === "closing_date")) flags.push("DEADLINE_UNSUPPORTED");

  // ---------------- eligibility
  const eligSec = findSection(ELIG_H);
  let eligLines: Line[] = [];
  if (eligSec) {
    eligLines = eligSec.lines;
    put("eligibility_summary", bullets(eligSec).join("; ").slice(0, 1200), null, sectionQuote(eligSec), eligSec.start, "SECTION", eligSec.heading);
  } else {
    const l = contentLines.find((x) => /^eligibility\s*[:\-–]\s*\S+/i.test(x.t));
    if (l) {
      eligLines = [l];
      put("eligibility_summary", l.t.replace(/^eligibility\s*[:\-–]\s*/i, "").slice(0, 1200), null, l.t, l.start, "LABEL", "eligibility");
    }
  }
  const scan = eligLines.length ? eligLines : [];

  // income
  for (const l of [...scan, ...contentLines.filter((x) => !scan.includes(x))]) {
    if (!/income/i.test(l.t)) continue;
    const a = findAmounts(l.t)[0];
    if (!a) continue;
    const op = /(not\s+exceed|should\s+not\s+be\s+more\s+than|not\s+more\s+than|less\s+than|below|up\s*to|under|maximum|within|does\s+not\s+exceed)/i.test(l.t) ? "<=" : null;
    if (!op) continue;
    const period = /annual|per\s+annum|per\s+year|yearly|p\.a\./i.test(l.t) ? "annual" : null;
    put("income_criteria", { operator: op, amount: a.value, currency: a.currency, period, raw_text: l.t.slice(0, 300) }, a.raw, l.t.slice(0, 300), l.start, "REGEX", eligSec?.heading ?? null);
    break;
  }

  // academic requirements
  const acadReqs: { metric: string; operator: string; value: number; unit: string; raw_text: string }[] = [];
  let acadFirst: Line | null = null;
  const acadScope = scan.length ? scan : contentLines.filter((l) => !l.heading && /marks|percent|aggregate|CGPA|grade|%/i.test(l.t));
  for (const l of acadScope) {
    let m = /(?:at\s+least|minimum(?:\s+of)?|not\s+less\s+than|secured\s+(?:at\s+least|minimum)?|obtained|scored)\s*(\d{2,3}(?:\.\d+)?)\s*(?:%|percent|per\s*cent)/i.exec(l.t);
    if (!m) m = /(\d{2,3}(?:\.\d+)?)\s*%\s*(?:marks|and\s+above|or\s+above|or\s+more|aggregate)/i.exec(l.t);
    if (m && +m[1] <= 100) {
      acadReqs.push({ metric: "MINIMUM_PERCENTAGE", operator: ">=", value: +m[1], unit: "percent", raw_text: l.t.slice(0, 300) });
      acadFirst ??= l;
    }
    const g = /(?:minimum|at\s+least)\s+(?:CGPA|GPA|CPI)\s*(?:of\s*)?(\d(?:\.\d+)?)/i.exec(l.t);
    if (g) {
      acadReqs.push({ metric: "MINIMUM_CGPA", operator: ">=", value: +g[1], unit: "cgpa", raw_text: l.t.slice(0, 300) });
      acadFirst ??= l;
    }
  }
  if (acadReqs.length && acadFirst) put("academic_requirements", acadReqs, null, acadFirst.t.slice(0, 300), acadFirst.start, "REGEX", eligSec?.heading ?? null);

  // education levels (only from the eligibility wording)
  if (scan.length) {
    const levels: [string, RegExp][] = [
      ["SCHOOL", /\b(class\s*(?:9|10|11|12|ix|x|xi|xii)|pre-?matric|post-?matric|higher secondary|secondary school|school students?)\b/i],
      ["DIPLOMA", /\b(diploma|polytechnic)\b/i],
      ["UNDERGRADUATE", /\b(undergraduate|under-graduate|bachelor'?s?|b\.?tech|b\.?e\.?|b\.?sc|b\.?a\.?|b\.?com|UG)\b/i],
      ["POSTGRADUATE", /\b(postgraduate|post-graduate|master'?s?|m\.?tech|m\.?sc|m\.?a\.?|m\.?b\.?a|PG)\b/i],
      ["DOCTORAL", /\b(doctoral|ph\.?d\.?|doctorate|research scholars?)\b/i],
    ];
    const found: string[] = [];
    let firstLine: Line | null = null;
    for (const [code, re] of levels) {
      const hit = scan.find((l) => re.test(l.t));
      if (hit) {
        found.push(code);
        firstLine ??= hit;
      }
    }
    if (found.length && firstLine) put("education_levels", found, null, firstLine.t.slice(0, 300), firstLine.start, "KEYWORD", eligSec?.heading ?? null);

    // category / gender / domicile
    const cats: string[] = [];
    let catLine: Line | null = null;
    const catRes: [string, RegExp][] = [
      ["SC", /\b(SC|Scheduled Castes?)\b/],
      ["ST", /\b(ST|Scheduled Tribes?)\b/],
      ["OBC", /\b(OBC|Other Backward Class(?:es)?)\b/],
      ["EWS", /\bEWS\b/],
      ["MINORITY", /\bminorit(?:y|ies)\b/i],
      ["PWD", /\b(PwD|persons? with disabilit(?:y|ies)|divyang)\b/i],
    ];
    for (const [code, re] of catRes) {
      const hit = scan.find((l) => re.test(l.t));
      if (hit) {
        cats.push(code);
        catLine ??= hit;
      }
    }
    if (cats.length && catLine) put("category_criteria", cats, null, catLine.t.slice(0, 300), catLine.start, "KEYWORD", eligSec?.heading ?? null);

    const fem = scan.find((l) => /(girl students?|female (?:students?|candidates?)|women|girls)[^.]{0,40}\b(only|exclusively)|(only|exclusively)[^.]{0,40}(girl|female|women)|open to (?:girl|female|women)/i.test(l.t));
    const male = scan.find((l) => /(boys|male (?:students?|candidates?))\s+only/i.test(l.t));
    if (fem) put("gender_criteria", "FEMALE", null, fem.t.slice(0, 300), fem.start, "REGEX", eligSec?.heading ?? null);
    else if (male) put("gender_criteria", "MALE", null, male.t.slice(0, 300), male.start, "REGEX", eligSec?.heading ?? null);

    const states: string[] = [];
    let stLine: Line | null = null;
    for (const l of scan) {
      const m = /(?:residents?|domicile|native|permanent residents?)\s+of\s+([A-Z][A-Za-z ]+)/.exec(l.t);
      if (!m) continue;
      const st = STATES.find((s) => m[1].toLowerCase().startsWith(s.toLowerCase()));
      if (st && !states.includes(st)) {
        states.push(st);
        stLine ??= l;
      }
    }
    if (states.length && stLine) put("domicile_requirements", states, null, stLine.t.slice(0, 300), stLine.start, "REGEX", eligSec?.heading ?? null);
  }

  // ---------------- documents / selection / renewal / how to apply
  const docSec = findSection(DOC_H);
  if (docSec) put("documents_required", bullets(docSec).slice(0, 40), null, sectionQuote(docSec), docSec.start, "SECTION", docSec.heading);
  const selSec = findSection(SEL_H);
  if (selSec) put("selection_process", bullets(selSec).join("; ").slice(0, 1200), null, sectionQuote(selSec), selSec.start, "SECTION", selSec.heading);
  const renSec = findSection(REN_H);
  if (renSec) put("renewal_requirements", bullets(renSec).join("; ").slice(0, 1200), null, sectionQuote(renSec), renSec.start, "SECTION", renSec.heading);
  const howSec = findSection(HOW_H);
  if (howSec) put("application_instructions", bullets(howSec).join(" ").slice(0, 800), null, sectionQuote(howSec), howSec.start, "SECTION", howSec.heading);

  // ---------------- links: application URL & terms URL (taken only from link targets that exist on the page)
  for (const l of linkLines) {
    const m = /^-\s+(.+?)\s+->\s+(\S+)$/.exec(l.t);
    if (!m) continue;
    const [, label, href] = m;
    if (!fields.application_url && /\b(apply|application form|online application|register now|submit application)\b/i.test(label)) {
      put("application_url", href, label, l.t, l.start, "LINK_TARGET", "links");
    }
    if (!fields.terms_url && /(guideline|terms|brochure|notification|scheme document)/i.test(label) && /\.pdf(\?|$)/i.test(href)) {
      put("terms_url", href, label, l.t, l.start, "LINK_TARGET", "links");
    }
  }

  // ---------------- lifecycle signals (explicit wording only)
  const signalQuotes: Record<string, string> = {};
  const sig = { explicitClosed: false, explicitOpen: false, explicitDiscontinued: false, indiaMentioned: false };
  for (const l of contentLines) {
    if (!sig.explicitClosed && /\b(applications?\s+(?:are\s+|is\s+|have\s+been\s+)?(?:now\s+)?closed|admissions?\s+closed|window\s+(?:has\s+)?closed|registration\s+(?:is\s+)?closed)\b/i.test(l.t)) {
      sig.explicitClosed = true;
      signalQuotes.explicitClosed = l.t.slice(0, 260);
    }
    if (!sig.explicitOpen && /\b(applications?\s+(?:are|is)\s+(?:now\s+)?open|now\s+accepting\s+applications|accepted\s+on\s+a\s+rolling\s+basis|open\s+throughout\s+the\s+year)\b/i.test(l.t)) {
      sig.explicitOpen = true;
      signalQuotes.explicitOpen = l.t.slice(0, 260);
    }
    if (!sig.explicitDiscontinued && /\b((?:has|have)\s+been\s+(?:discontinued|withdrawn|terminated)|is\s+(?:discontinued|withdrawn)|no\s+longer\s+(?:accepting|available|offered))\b/i.test(l.t)) {
      sig.explicitDiscontinued = true;
      signalQuotes.explicitDiscontinued = l.t.slice(0, 260);
    }
    if (!sig.indiaMentioned && /\b(India|Indian)\b/.test(l.t) && !l.heading) {
      sig.indiaMentioned = true;
      signalQuotes.indiaMentioned = l.t.slice(0, 260);
    }
  }
  // India-eligibility evidence is only credited when it appears inside the eligibility wording.
  const indiaInElig = eligLines.find((l) => /\b(India|Indian)\b/.test(l.t));
  if (indiaInElig) put("india_eligibility", true, null, indiaInElig.t.slice(0, 300), indiaInElig.start, "KEYWORD", eligSec?.heading ?? null);

  // ---------------- page classification (listing/news pages are NOT scholarship records)
  const pageSignals: string[] = [];
  if (fields.eligibility_summary) pageSignals.push("eligibility");
  if (fields.amount || fields.benefit_type) pageSignals.push("benefit");
  if (fields.closing_date || fields.opening_date || sig.explicitOpen) pageSignals.push("dates");
  if (fields.application_url || fields.application_instructions) pageSignals.push("how_to_apply");
  if (fields.documents_required) pageSignals.push("documents");
  if (fields.selection_process) pageSignals.push("selection");
  const nm = fields.name?.value as string | undefined;
  const isScholarshipPage = !!nm && NAME_KEYWORDS.test(nm) && pageSignals.length >= 3 && (pageSignals.includes("eligibility") || pageSignals.includes("benefit"));

  if (!fields.application_url) flags.push("APPLICATION_LINK_MISSING");
  if (doc.kind === "PDF") flags.push("PDF_ONLY_SOURCE");

  // ---------------- validation: every quote must exist in the stored text
  const droppedFields: string[] = [];
  for (const [k, f] of Object.entries(fields)) {
    if (!quoteInText(text, f.quote)) {
      droppedFields.push(k);
      delete fields[k];
    }
  }
  return { fields, conflicts, flags: [...new Set(flags)], isScholarshipPage, pageSignals, signals: sig, signalQuotes, droppedFields };
}
