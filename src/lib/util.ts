import crypto from "node:crypto";

export const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- URLs
const TRACKING = /^(utm_|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|igshid$|_ga$|ref$|ref_src$)/i;

/** Lowercase scheme/host, drop fragments + tracking params, sort remaining params, trim trailing slash cautiously. */
export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const u = new URL(input.trim(), base);
    if (!["http:", "https:", "fixture:"].includes(u.protocol)) return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    const keep: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!TRACKING.test(k)) keep.push([k, v]);
    });
    keep.sort((a, b) => a[0].localeCompare(b[0]));
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let s = u.toString();
    // only trim the trailing slash on non-root paths with no query
    if (u.pathname.length > 1 && u.pathname.endsWith("/") && !u.search) s = s.replace(/\/$/, "");
    return s;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function hostMatchesDomain(host: string | null, domain: string): boolean {
  if (!host) return false;
  const h = host.replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith("." + d);
}

export function hostMatchesAny(url: string, domains: string[]): boolean {
  const h = hostOf(url);
  return domains.some((d) => hostMatchesDomain(h, d));
}

// ---------------------------------------------------------------- text
export function collapseWs(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeName(s: string): string {
  return collapseWs(s)
    .toLowerCase()
    .replace(/\(fixture\)/g, "")
    .replace(/[^a-z0-9\u0900-\u097f ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity: provider_normalized + scholarship_name_normalized + academic_cycle */
export function identityFingerprint(provider: string | null, name: string, cycle: string | null): string {
  return sha256([normalizeName(provider ?? ""), normalizeName(name), (cycle ?? "").trim()].join("|")).slice(0, 40);
}

/** Does `quote` appear in `text` after controlled whitespace normalisation? */
export function quoteInText(text: string, quote: string): boolean {
  if (!quote) return false;
  return collapseWs(text).includes(collapseWs(quote));
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(o[k]))
      .join(",") +
    "}"
  );
}

export const deepEqual = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

// ---------------------------------------------------------------- dates
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export interface ParsedDate {
  iso: string;
  raw: string;
  index: number;
}

/**
 * Find explicit full dates (day, month and 4-digit year). A date with no year is NEVER guessed.
 * Numeric dates use Indian convention DD/MM/YYYY.
 */
export function findDates(text: string): ParsedDate[] {
  const out: ParsedDate[] = [];
  const patterns: { re: RegExp; f: (m: RegExpExecArray) => string | null }[] = [
    { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s,\\-]+(?:of\\s+)?${MON}\\.?[\\s,\\-]+(\\d{4})\\b`, "gi"), f: (m) => iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) },
    { re: new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), f: (m) => iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) },
    { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, f: (m) => iso(+m[1], +m[2], +m[3]) },
    { re: /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/g, f: (m) => iso(+m[3], +m[2], +m[1]) },
  ];
  for (const { re, f } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const v = f(m);
      if (v && !out.some((o) => o.index === m!.index)) out.push({ iso: v, raw: m[0], index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function dateDiffDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86_400_000);
}

// ---------------------------------------------------------------- amounts
export interface ParsedAmount {
  raw: string;
  index: number;
  value: number;
  currency: string | null;
  upTo: boolean;
  frequency: string | null;
}

const CUR: Record<string, string> = { "₹": "INR", rs: "INR", inr: "INR", usd: "USD", "us$": "USD", $: "USD", gbp: "GBP", "£": "GBP", eur: "EUR", "€": "EUR" };

export function findAmounts(text: string): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  const re = /(up\s*to\s+|maximum\s+of\s+|upto\s+)?(?<![a-z])(₹|rs\.?|inr|us\$|usd|\$|gbp|£|eur|€)\s?([\d][\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand|k\b)?(?:\s*\/?\s*-)?(\s*(?:per\s+annum|per\s+year|annually|a\s+year|per\s+month|monthly|per\s+semester|one[- ]time|per\s+academic\s+year|p\.a\.))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let v = parseFloat(m[3].replace(/,/g, ""));
    if (!isFinite(v) || v <= 0) continue;
    const unit = (m[4] || "").toLowerCase();
    if (unit.startsWith("lakh") || unit.startsWith("lac")) v *= 100_000;
    else if (unit.startsWith("crore")) v *= 10_000_000;
    else if (unit === "thousand" || unit === "k") v *= 1000;
    const f = (m[5] || "").toLowerCase();
    let frequency: string | null = null;
    if (/month/.test(f)) frequency = "MONTHLY";
    else if (/annum|year|annual|p\.a/.test(f)) frequency = "ANNUAL";
    else if (/semester/.test(f)) frequency = "PER_SEMESTER";
    else if (/one/.test(f)) frequency = "ONE_TIME";
    out.push({
      raw: m[0].trim(),
      index: m.index,
      value: v,
      currency: CUR[m[2].toLowerCase().replace(/\.$/, "")] ?? null,
      upTo: !!m[1],
      frequency,
    });
  }
  return out;
}
