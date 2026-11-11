import type { Scope, SearchParams } from "./services/queries";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function parseScope(v: string | null | undefined): Scope {
  return v === "real" || v === "fixture" ? v : "all";
}

type Raw = Record<string, string | string[] | undefined>;

/** Accepts URLSearchParams or Next searchParams object. */
export function parseSearchParams(src: URLSearchParams | Raw): SearchParams {
  const get = (k: string): string | undefined => {
    if (src instanceof URLSearchParams) return src.get(k) ?? undefined;
    const v = src[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const num = (k: string) => {
    const v = get(k);
    return v !== undefined && v !== "" ? Number(v) : undefined;
  };
  const s = (k: string) => (get(k) ? get(k) : undefined);
  return {
    q: s("q"),
    verification_status: s("verification_status"),
    lifecycle_status: s("lifecycle_status"),
    provider_type: s("provider_type"),
    education_level: s("education_level"),
    state: s("state"),
    category: s("category"),
    min_confidence: num("min_confidence"),
    deadline_from: s("deadline_from"),
    deadline_to: s("deadline_to"),
    verified_within_days: num("verified_within_days"),
    sort: s("sort"),
    page: num("page"),
    page_size: num("page_size"),
    scope: parseScope(get("scope")),
  };
}
