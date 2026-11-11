import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface SourceConfig {
  key: string;
  name: string;
  provider_name: string;
  provider_aliases?: string[];
  source_type: string;
  authority_level: "PRIMARY" | "SECONDARY" | "UNKNOWN";
  homepage?: string;
  official_domains: string[];
  application_domains?: string[];
  seed_urls: string[];
  max_depth?: number;
  request_delay_seconds?: number;
  requires_india_eligibility_evidence?: boolean;
  enabled: boolean;
  reviewed?: boolean;
  reviewed_on?: string;
  rationale?: string;
  is_fixture?: boolean;
}

export interface CrawlPolicy {
  version: string;
  http: {
    connect_timeout_ms: number;
    read_timeout_ms: number;
    max_response_bytes: number;
    retries: number;
    backoff_base_ms: number;
    max_retry_after_ms: number;
    allowed_content_types: string[];
  };
  budget: {
    max_pages_per_run: number;
    max_candidates_stored_per_page: number;
    max_sitemap_urls_per_source: number;
    link_relevance_min_to_fetch: number;
    link_relevance_min_to_store: number;
  };
  lifecycle: {
    warning_window_days: number;
    stale_min_consecutive_failures: number;
    stale_grace_period_days: number;
    freshness_window_days: number;
    recheck_days_default: number;
    recheck_days_near_deadline: number;
  };
}

export interface Settings {
  fetcher_version: string;
  parser_version: string;
  extractor_version: string;
  verifier_version: string;
  confidence_policy_version: string;
}

const DEFAULT_POLICY: CrawlPolicy = {
  version: "1.0",
  http: {
    connect_timeout_ms: 15000,
    read_timeout_ms: 25000,
    max_response_bytes: 8_000_000,
    retries: 2,
    backoff_base_ms: 1000,
    max_retry_after_ms: 10000,
    allowed_content_types: ["text/html", "application/xhtml+xml", "application/pdf"],
  },
  budget: {
    max_pages_per_run: 120,
    max_candidates_stored_per_page: 60,
    max_sitemap_urls_per_source: 150,
    link_relevance_min_to_fetch: 3,
    link_relevance_min_to_store: 1,
  },
  lifecycle: {
    warning_window_days: 14,
    stale_min_consecutive_failures: 3,
    stale_grace_period_days: 14,
    freshness_window_days: 60,
    recheck_days_default: 7,
    recheck_days_near_deadline: 1,
  },
};

const DEFAULT_SETTINGS: Settings = {
  fetcher_version: "fetcher-1.0",
  parser_version: "parser-1.0",
  extractor_version: "extractor-1.0",
  verifier_version: "verifier-1.0",
  confidence_policy_version: "1.0",
};

function readYaml<T>(file: string): T | null {
  const p = path.join(process.cwd(), "config", file);
  try {
    return YAML.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

let cache: { policy?: CrawlPolicy; settings?: Settings; sources?: SourceConfig[] } = {};

export function getCrawlPolicy(): CrawlPolicy {
  if (!cache.policy) {
    const y = readYaml<Partial<CrawlPolicy>>("crawl_policy.yaml");
    cache.policy = {
      version: y?.version ?? DEFAULT_POLICY.version,
      http: { ...DEFAULT_POLICY.http, ...(y?.http ?? {}) },
      budget: { ...DEFAULT_POLICY.budget, ...(y?.budget ?? {}) },
      lifecycle: { ...DEFAULT_POLICY.lifecycle, ...(y?.lifecycle ?? {}) },
    };
  }
  return cache.policy;
}

export function getSettings(): Settings {
  if (!cache.settings) {
    cache.settings = { ...DEFAULT_SETTINGS, ...(readYaml<Partial<Settings>>("settings.yaml") ?? {}) };
  }
  return cache.settings;
}

export function getSourceConfigs(): SourceConfig[] {
  if (!cache.sources) {
    cache.sources = readYaml<{ sources: SourceConfig[] }>("source_policy.yaml")?.sources ?? [];
  }
  return cache.sources;
}

export function resetConfigCache() {
  cache = {};
}

export function userAgent(): string {
  return process.env.CRAWLER_USER_AGENT || "ScholarshipIntelligenceBot/1.0 (+mailto:contact@example.org)";
}
