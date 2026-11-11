import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { getSourceConfigs } from "../config";
import type { SourceRow } from "../verification/resolver";

/** Sync config/source_policy.yaml into the source registry table (config is the source of truth). */
export async function syncSourceRegistry(): Promise<SourceRow[]> {
  for (const c of getSourceConfigs()) {
    const values = {
      key: c.key,
      name: c.name,
      providerName: c.provider_name,
      providerAliases: c.provider_aliases ?? [],
      sourceType: c.source_type,
      authorityLevel: c.authority_level,
      homepage: c.homepage ?? null,
      officialDomains: c.official_domains,
      applicationDomains: c.application_domains ?? [],
      seedUrls: c.seed_urls,
      maxDepth: c.max_depth ?? 1,
      requestDelaySeconds: c.request_delay_seconds ?? 2,
      enabled: c.enabled,
      reviewed: !!c.reviewed,
      reviewedOn: c.reviewed_on ?? null,
      rationale: c.rationale ?? null,
      isFixture: !!c.is_fixture,
      updatedAt: new Date(),
    };
    await db.insert(sources).values(values).onConflictDoUpdate({ target: sources.key, set: values });
  }
  return db.select().from(sources);
}

export function requiresIndiaEvidence(key: string | null): boolean {
  if (!key) return false;
  return !!getSourceConfigs().find((c) => c.key === key)?.requires_india_eligibility_evidence;
}

export function providerTypeFor(sourceType: string): string {
  if (["GOVERNMENT_PORTAL", "GOVERNMENT_DEPARTMENT", "GOVERNMENT_MINISTRY", "STATUTORY_BODY"].includes(sourceType)) return "GOVERNMENT";
  if (sourceType === "UNIVERSITY") return "UNIVERSITY";
  if (sourceType === "CORPORATE_CSR") return "CSR";
  if (sourceType === "INTERNATIONAL_PROVIDER") return "INTERNATIONAL";
  if (sourceType === "NGO_TRUST" || sourceType === "FOUNDATION") return "NGO_TRUST";
  if (sourceType === "AGGREGATOR" || sourceType === "NEWS_MEDIA" || sourceType === "UNKNOWN") return "UNKNOWN";
  return "OTHER";
}

export async function getSourceByKey(key: string) {
  return (await db.select().from(sources).where(eq(sources.key, key)).limit(1))[0] ?? null;
}
