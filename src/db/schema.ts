import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Source registry: providers/portals with trust policy (synced from config/source_policy.yaml). */
export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  providerName: text("provider_name").notNull(),
  providerAliases: jsonb("provider_aliases").$type<string[]>().notNull().default([]),
  sourceType: text("source_type").notNull(),
  authorityLevel: text("authority_level").notNull(), // PRIMARY | SECONDARY | UNKNOWN
  homepage: text("homepage"),
  officialDomains: jsonb("official_domains").$type<string[]>().notNull().default([]),
  applicationDomains: jsonb("application_domains").$type<string[]>().notNull().default([]),
  seedUrls: jsonb("seed_urls").$type<string[]>().notNull().default([]),
  maxDepth: integer("max_depth").notNull().default(1),
  requestDelaySeconds: real("request_delay_seconds").notNull().default(2),
  enabled: boolean("enabled").notNull().default(false),
  reviewed: boolean("reviewed").notNull().default(false),
  reviewedOn: text("reviewed_on"),
  rationale: text("rationale"),
  isFixture: boolean("is_fixture").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const crawlRuns = pgTable("crawl_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  triggerType: text("trigger_type").notNull(), // SCHEDULED | MANUAL | CLI | TEST
  scope: text("scope").notNull().default("ALL"),
  status: text("status").notNull().default("RUNNING"), // RUNNING | SUCCESS | PARTIAL | FAILED
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  simulatedNow: ts("simulated_now"),
  seedCount: integer("seed_count").notNull().default(0),
  candidateCount: integer("candidate_count").notNull().default(0),
  pagesAttempted: integer("pages_attempted").notNull().default(0),
  fetchSuccessCount: integer("fetch_success_count").notNull().default(0),
  fetchFailureCount: integer("fetch_failure_count").notNull().default(0),
  extractionSuccessCount: integer("extraction_success_count").notNull().default(0),
  persistedCount: integer("persisted_count").notNull().default(0),
  verifiedCount: integer("verified_count").notNull().default(0),
  reviewRequiredCount: integer("review_required_count").notNull().default(0),
  changeEventCount: integer("change_event_count").notNull().default(0),
  errorSummary: jsonb("error_summary").$type<string[]>().notNull().default([]),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
  configVersion: text("config_version"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const discoveredCandidates = pgTable(
  "discovered_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id),
    discoveredUrl: text("discovered_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    discoverySourceUrl: text("discovery_source_url"),
    discoveryMethod: text("discovery_method").notNull(),
    anchorText: text("anchor_text"),
    candidateTitle: text("candidate_title"),
    sourceId: uuid("source_id").references(() => sources.id),
    candidateFingerprint: text("candidate_fingerprint"),
    classification: text("classification").notNull().default("UNKNOWN"), // OFFICIAL | LEAD | UNKNOWN
    sourceType: text("source_type"),
    relevanceScore: integer("relevance_score").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    processingStatus: text("processing_status").notNull().default("DISCOVERED"),
    statusReason: text("status_reason"),
    timesSeen: integer("times_seen").notNull().default(1),
    isFixture: boolean("is_fixture").notNull().default(false),
    scholarshipId: uuid("scholarship_id"),
    firstDiscoveredAt: ts("first_discovered_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    lastProcessedAt: ts("last_processed_at"),
  },
  (t) => [uniqueIndex("candidates_normalized_url_uq").on(t.normalizedUrl)],
);

export const fetchObservations = pgTable(
  "fetch_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").references(() => discoveredCandidates.id),
    sourceId: uuid("source_id").references(() => sources.id),
    scholarshipId: uuid("scholarship_id"),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    contentHash: text("content_hash"),
    normalizedTextHash: text("normalized_text_hash"),
    normalizedText: text("normalized_text"),
    title: text("title"),
    fetchStatus: text("fetch_status").notNull(), // SUCCESS | FAILED
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    fetcherVersion: text("fetcher_version"),
    parserVersion: text("parser_version"),
  },
  (t) => [
    index("obs_scholarship_idx").on(t.scholarshipId),
    index("obs_candidate_idx").on(t.candidateId),
  ],
);

export const scholarships = pgTable(
  "scholarships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    sourceId: uuid("source_id").references(() => sources.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    providerName: text("provider_name"),
    providerType: text("provider_type").notNull().default("UNKNOWN"),
    academicCycle: text("academic_cycle"),
    description: text("description"),
    benefitType: text("benefit_type"),
    amountMin: real("amount_min"),
    amountMax: real("amount_max"),
    amountCurrency: text("amount_currency"),
    amountRaw: text("amount_raw"),
    benefitFrequency: text("benefit_frequency"),
    eligibilitySummary: text("eligibility_summary"),
    eligibilityStructured: jsonb("eligibility_structured").$type<Record<string, unknown>>().notNull().default({}),
    academicRequirements: jsonb("academic_requirements").$type<unknown[]>().notNull().default([]),
    incomeCriteria: jsonb("income_criteria").$type<Record<string, unknown> | null>(),
    ageCriteria: jsonb("age_criteria").$type<Record<string, unknown> | null>(),
    genderCriteria: text("gender_criteria"),
    categoryCriteria: jsonb("category_criteria").$type<string[]>().notNull().default([]),
    domicileRequirements: jsonb("domicile_requirements").$type<string[]>().notNull().default([]),
    institutionRequirements: jsonb("institution_requirements").$type<string[]>().notNull().default([]),
    otherConditions: jsonb("other_conditions").$type<string[]>().notNull().default([]),
    openingDate: date("opening_date", { mode: "string" }),
    closingDate: date("closing_date", { mode: "string" }),
    dateRaw: text("date_raw"),
    documentsRequired: jsonb("documents_required").$type<string[]>().notNull().default([]),
    selectionProcess: text("selection_process"),
    renewalRequirements: text("renewal_requirements"),
    applicationInstructions: text("application_instructions"),
    officialSourceUrl: text("official_source_url"),
    applicationUrl: text("application_url"),
    termsUrl: text("terms_url"),
    sourceType: text("source_type").notNull().default("UNKNOWN"),
    sourceDomain: text("source_domain"),
    authority: text("authority").notNull().default("UNKNOWN"),
    discoveryUrl: text("discovery_url"),
    verificationStatus: text("verification_status").notNull().default("REVIEW_REQUIRED"),
    lifecycleStatus: text("lifecycle_status").notNull().default("UNKNOWN"),
    statusReason: text("status_reason"),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    signals: jsonb("signals").$type<Record<string, boolean>>().notNull().default({}),
    confidenceScore: real("confidence_score").notNull().default(0),
    confidencePolicyVersion: text("confidence_policy_version"),
    lastVerifiedAt: ts("last_verified_at"),
    lastSeenAt: ts("last_seen_at"),
    lastAttemptedAt: ts("last_attempted_at"),
    firstDiscoveredAt: ts("first_discovered_at").notNull().defaultNow(),
    nextCheckAt: ts("next_check_at"),
    lastChangedAt: ts("last_changed_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastFailureCode: text("last_failure_code"),
    currentVersionId: uuid("current_version_id"),
    isFixture: boolean("is_fixture").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scholarships_fingerprint_uq").on(t.fingerprint),
    index("scholarships_status_idx").on(t.verificationStatus, t.lifecycleStatus),
    index("scholarships_official_url_idx").on(t.officialSourceUrl),
  ],
);

export const scholarshipVersions = pgTable(
  "scholarship_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scholarshipId: uuid("scholarship_id").notNull().references(() => scholarships.id),
    versionNumber: integer("version_number").notNull(),
    recordSnapshot: jsonb("record_snapshot").$type<Record<string, unknown>>().notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    verificationStatus: text("verification_status").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    confidenceScore: real("confidence_score").notNull(),
    createdFromObservationId: uuid("created_from_observation_id").references(() => fetchObservations.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("versions_sch_num_uq").on(t.scholarshipId, t.versionNumber)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fetchObservationId: uuid("fetch_observation_id").notNull().references(() => fetchObservations.id),
    scholarshipId: uuid("scholarship_id"),
    sourceUrl: text("source_url").notNull(),
    fieldName: text("field_name").notNull(),
    evidenceText: text("evidence_text").notNull(),
    textStartOffset: integer("text_start_offset"),
    textEndOffset: integer("text_end_offset"),
    pageNumber: integer("page_number"),
    sectionHeading: text("section_heading"),
    evidenceType: text("evidence_type").notNull(), // HTML_TEXT | PDF_TEXT | METADATA | LINK_TARGET | OCR_TEXT
    contentHash: text("content_hash"),
    capturedAt: ts("captured_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("evidence_sch_idx").on(t.scholarshipId)],
);

export const fieldEvidence = pgTable("field_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  scholarshipVersionId: uuid("scholarship_version_id").notNull().references(() => scholarshipVersions.id),
  fieldName: text("field_name").notNull(),
  normalizedValue: jsonb("normalized_value").$type<unknown>(),
  rawValue: text("raw_value"),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  supportStatus: text("support_status").notNull(),
  extractionMethod: text("extraction_method").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const verificationResults = pgTable("verification_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  scholarshipId: uuid("scholarship_id").notNull().references(() => scholarships.id),
  scholarshipVersionId: uuid("scholarship_version_id").references(() => scholarshipVersions.id),
  fetchObservationId: uuid("fetch_observation_id").references(() => fetchObservations.id),
  score: real("score").notNull(),
  status: text("status").notNull(),
  componentScores: jsonb("component_scores").$type<Record<string, number>>().notNull(),
  penalties: jsonb("penalties").$type<{ code: string; points: number; reason: string }[]>().notNull().default([]),
  gateResults: jsonb("gate_results").$type<Record<string, boolean>>().notNull(),
  fieldResults: jsonb("field_results").$type<Record<string, string>>().notNull().default({}),
  reasons: jsonb("reasons").$type<string[]>().notNull(),
  resolution: jsonb("resolution").$type<Record<string, unknown>>().notNull().default({}),
  policyVersion: text("policy_version").notNull(),
  verifierVersion: text("verifier_version").notNull(),
  evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
});

export const changeEvents = pgTable(
  "change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scholarshipId: uuid("scholarship_id").notNull().references(() => scholarships.id),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id),
    fieldName: text("field_name").notNull(),
    changeType: text("change_type").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    detectedAt: ts("detected_at").notNull().defaultNow(),
    sourceObservationId: uuid("source_observation_id").references(() => fetchObservations.id),
    evidenceId: uuid("evidence_id").references(() => evidence.id),
    reason: text("reason"),
    accepted: boolean("accepted").notNull().default(true),
    resolution: text("resolution").notNull().default("AUTO_ACCEPTED"), // AUTO_ACCEPTED | PENDING_REVIEW | APPROVED | REJECTED | INFO
    isSimulated: boolean("is_simulated").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("changes_sch_idx").on(t.scholarshipId)],
);

export const reviewActions = pgTable("review_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scholarshipId: uuid("scholarship_id").notNull().references(() => scholarships.id),
  reviewer: text("reviewer").notNull(),
  decision: text("decision").notNull(),
  rationale: text("rationale").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const jobLocks = pgTable("job_locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  lockedUntil: ts("locked_until").notNull(),
});

/** Controls which version/failure-mode each *fixture* page currently serves (demo lab only). */
export const fixtureState = pgTable("fixture_state", {
  slug: text("slug").primaryKey(),
  mode: text("mode").notNull().default("A"), // A | B | ERROR_503 | NOT_FOUND
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
