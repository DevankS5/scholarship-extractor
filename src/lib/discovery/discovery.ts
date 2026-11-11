import type { NormalizedDocument } from "../crawling/normalize";
import { hostMatchesAny, normalizeUrl } from "../util";
import { findSourceForUrl, type SourceRow } from "../verification/resolver";

export type DiscoveryMethod = "SEED" | "LISTING_TRAVERSAL" | "SITEMAP" | "OFFICIAL_CROSSLINK" | "SEARCH_LEAD" | "AGGREGATOR_LINK" | "MANUAL" | "REVERIFY";

const PATH_TERMS = /(scholarship|fellowship|financial-?aid|stipend|bursary|freeship|post-?matric|pre-?matric|merit-?cum-?means|tuition|grant|award|student-?support|schemes?|programmes?|financial-?assistance)/i;
const ANCHOR_TERMS = /(scholarship|fellowship|financial (?:aid|assistance|support)|stipend|tuition|fee (?:reimbursement|waiver)|education(?:al)? (?:assistance|grant|support)|bursary|post-?matric|pre-?matric|merit-cum-means|research grant|student support|grants?|awards?)/i;
const NEGATIVE = /(login|log-in|signin|sign-in|register\b|captcha|contact|sitemap|privacy|disclaimer|terms-of|tender|careers?|vacanc|rti\b|news(?:-|\/)?archive|press-?release|tel:|mailto:|javascript:|\/news\/|\/archive|feedback|screen-?reader|accessibility)/i;
const SKIP_EXT = /\.(jpg|jpeg|png|gif|svg|webp|ico|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|css|js)(\?|$)/i;

/** Discovery priority only. Never displayed or used as verification confidence. */
export function scoreLink(href: string, anchor: string, opts: { officialEnabled: boolean }): number {
  if (SKIP_EXT.test(href)) return -9;
  let s = 0;
  let path = href;
  try {
    const u = new URL(href);
    path = u.pathname + u.search;
  } catch {
    /* keep raw */
  }
  if (PATH_TERMS.test(path)) s += 3;
  if (ANCHOR_TERMS.test(anchor)) s += 2;
  if (opts.officialEnabled) s += 2;
  if (/students?|financial aid/i.test(anchor)) s += 1;
  if (NEGATIVE.test(path) || NEGATIVE.test(anchor)) s -= 3;
  // application destinations are recorded as application URLs, not crawled as scholarship pages
  if (/^(apply|apply (now|online|here)|online application|application form|register)\b/i.test(anchor.trim())) s -= 3;
  return s;
}

export interface FoundLink {
  url: string;
  anchor: string;
  score: number;
  scope: "SAME_DOMAIN" | "OFFICIAL_CROSSLINK" | "EXTERNAL";
  targetSource: SourceRow | null;
}

export function extractCandidateLinks(doc: NormalizedDocument, pageUrl: string, current: SourceRow | null, all: SourceRow[]): FoundLink[] {
  const out = new Map<string, FoundLink>();
  const base = normalizeUrl(pageUrl);
  for (const l of doc.links) {
    const url = normalizeUrl(l.href);
    if (!url || url === base) continue;
    const target = findSourceForUrl(url, all);
    const same = !!current && hostMatchesAny(url, current.officialDomains);
    const scope: FoundLink["scope"] = same ? "SAME_DOMAIN" : target ? "OFFICIAL_CROSSLINK" : "EXTERNAL";
    const score = scoreLink(url, l.text, { officialEnabled: !!(target ? target.enabled && target.authorityLevel === "PRIMARY" : same && current?.enabled && current.authorityLevel === "PRIMARY") });
    const prev = out.get(url);
    if (!prev || prev.score < score || (!prev.anchor && l.text)) out.set(url, { url, anchor: l.text.slice(0, 200), score, scope, targetSource: target });
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (/<sitemapindex/i.test(xml)) return { urls: [], sitemaps: locs };
  return { urls: locs, sitemaps: [] };
}

/** Optional lead discovery through a self-hosted SearXNG instance. Results are LEADS only (never evidence). */
export async function searchLeads(): Promise<{ url: string; title: string; query: string }[]> {
  const base = process.env.SEARXNG_URL;
  if (!base) return [];
  const queries = (process.env.SEARCH_QUERIES || "scholarship for indian students").split("|").map((q) => q.trim()).filter(Boolean);
  const out: { url: string; title: string; query: string }[] = [];
  for (const q of queries.slice(0, 5)) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(q)}&format=json`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { results?: { url?: string; title?: string }[] };
      for (const r of j.results?.slice(0, 15) ?? []) if (r.url) out.push({ url: r.url, title: r.title ?? "", query: q });
    } catch {
      /* search is optional */
    }
  }
  return out;
}
