import type { sources } from "@/db/schema";
import type { NormalizedDocument } from "../crawling/normalize";
import type { ExtractionResult } from "../extraction/extractor";
import { hostMatchesAny, hostOf, normalizeName, normalizeUrl } from "../util";

export type SourceRow = typeof sources.$inferSelect;

export type Authority = "PRIMARY_CONFIRMED" | "PRIMARY_DOCUMENT_CONFIRMED" | "PRIMARY_LIKELY" | "SECONDARY" | "UNKNOWN";

export interface SourceResolution {
  authority: Authority;
  providerMatch: boolean;
  domainMatch: boolean;
  sourceId: string | null;
  sourceKey: string | null;
  sourceType: string;
  officialSourceUrl: string | null;
  applicationUrl: string | null;
  applicationValidated: boolean;
  rationale: string[];
  unresolvedQuestions: string[];
  /** For aggregator/lead pages: outbound links that point at registered official domains. */
  officialLinks: string[];
}

/** Find the registry source whose official domains contain this URL's host (most specific domain wins). */
export function findSourceForUrl(url: string, all: SourceRow[]): SourceRow | null {
  const host = hostOf(url);
  if (!host) return null;
  let best: { s: SourceRow; len: number } | null = null;
  for (const s of all) {
    for (const d of s.officialDomains) {
      if (hostMatchesAny(url, [d]) && (!best || d.length > best.len)) best = { s, len: d.length };
    }
  }
  return best?.s ?? null;
}

function providerMatches(value: string, source: SourceRow): boolean {
  const v = normalizeName(value);
  return [source.providerName, ...source.providerAliases].some((a) => {
    const n = normalizeName(a);
    return n && (v.includes(n) || n.includes(v));
  });
}

export function resolveSource(args: {
  finalUrl: string;
  source: SourceRow | null;
  extraction: ExtractionResult;
  doc: NormalizedDocument;
  allSources: SourceRow[];
}): SourceResolution {
  const { finalUrl, source, extraction, doc, allSources } = args;
  const rationale: string[] = [];
  const unresolved: string[] = [];
  const officialLinks: string[] = [];
  const base = {
    providerMatch: false, domainMatch: false, sourceId: source?.id ?? null, sourceKey: source?.key ?? null,
    sourceType: source?.sourceType ?? "UNKNOWN", officialSourceUrl: null as string | null,
    applicationUrl: (extraction.fields.application_url?.value as string | undefined) ?? null,
    applicationValidated: false, officialLinks,
  };

  if (!source) {
    unresolved.push(`Host ${hostOf(finalUrl)} is not in the source registry; ownership cannot be established.`);
    return { ...base, authority: "UNKNOWN", rationale, unresolvedQuestions: unresolved };
  }

  const domainMatch = hostMatchesAny(finalUrl, source.officialDomains);
  if (source.authorityLevel === "SECONDARY" || source.sourceType === "AGGREGATOR" || source.sourceType === "NEWS_MEDIA") {
    rationale.push(`${source.name} is registered as a secondary source (${source.sourceType}); it is treated as a discovery lead only.`);
    for (const l of doc.links) {
      const other = findSourceForUrl(l.href, allSources.filter((s) => s.authorityLevel === "PRIMARY"));
      if (other) {
        const n = normalizeUrl(l.href);
        if (n && !officialLinks.includes(n)) officialLinks.push(n);
      }
    }
    if (officialLinks.length) rationale.push(`Page links to ${officialLinks.length} URL(s) on registered official domains (queued for primary verification).`);
    return { ...base, domainMatch, authority: "SECONDARY", rationale, unresolvedQuestions: ["No provider-controlled page has confirmed this record yet."] };
  }

  const providerField = extraction.fields.provider_name;
  const providerMatch = !!providerField && providerField.support === "SUPPORTED" && providerMatches(String(providerField.value), source);
  if (domainMatch) rationale.push(`URL host ${hostOf(finalUrl)} is within registered official domain(s): ${source.officialDomains.join(", ")}.`);
  else unresolved.push(`URL host ${hostOf(finalUrl)} is outside the registered official domains.`);
  if (providerMatch) rationale.push(`Page text names the provider ("${providerField!.quote.slice(0, 80)}").`);
  else unresolved.push("The page does not directly and unambiguously name the registered provider.");
  if (source.reviewed) rationale.push(`Domain ownership was reviewed${source.reviewedOn ? " on " + source.reviewedOn : ""}: ${source.rationale ?? "no rationale recorded"}`);
  else unresolved.push("Domain ownership has not been confirmed by a reviewer.");

  const appUrl = base.applicationUrl;
  const appValidated = !!appUrl && hostMatchesAny(appUrl, [...source.officialDomains, ...source.applicationDomains]);
  if (appUrl) {
    if (appValidated) rationale.push(`Application URL is linked from the official page and its host is a registered official/application domain.`);
    else unresolved.push("Application URL host is not a registered official/application domain.");
  }

  let authority: Authority = "UNKNOWN";
  if (domainMatch && source.authorityLevel === "PRIMARY") {
    if (source.reviewed && providerMatch) authority = doc.kind === "PDF" ? "PRIMARY_DOCUMENT_CONFIRMED" : "PRIMARY_CONFIRMED";
    else authority = "PRIMARY_LIKELY";
  }
  const primary = authority === "PRIMARY_CONFIRMED" || authority === "PRIMARY_DOCUMENT_CONFIRMED";
  return {
    ...base, domainMatch, providerMatch, authority, rationale, unresolvedQuestions: unresolved,
    officialSourceUrl: primary || authority === "PRIMARY_LIKELY" ? normalizeUrl(finalUrl) : null,
    applicationValidated: appValidated,
  };
}
