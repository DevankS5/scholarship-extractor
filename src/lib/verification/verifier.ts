/**
 * Deterministic, versioned confidence policy (rule-based estimate, NOT a calibrated probability).
 * No LLM is involved. Same evidence + same policy version => same score.
 */
import type { ExtractionResult } from "../extraction/extractor";
import { daysBetween, quoteInText } from "../util";
import type { SourceResolution } from "./resolver";

export const POLICY_VERSION = "1.0";
export const VERIFIER_VERSION = "verifier-1.0";
export const VERIFIED_THRESHOLD = 95;

export const COMPONENT_MAX = { authority: 25, presence: 15, critical_fields: 25, application: 10, freshness: 10, consistency: 10, provenance: 5 } as const;
export const FIELD_WEIGHTS = { name: 5, provider: 5, eligibility: 7, deadline: 5, benefit: 3 } as const;
export const PRIMARY_DOCUMENT_AUTHORITY_SCORE = 18; // policy: document-only evidence cannot reach 95 without an explicit policy change

export type FieldSupport = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "CONFLICTING" | "NOT_STATED";

export interface Penalty {
  code: string;
  points: number;
  reason: string;
}

export interface VerificationResult {
  score: number;
  status: "VERIFIED" | "REVIEW_REQUIRED";
  components: Record<keyof typeof COMPONENT_MAX, number>;
  penalties: Penalty[];
  gates: Record<string, boolean>;
  fieldResults: Record<string, FieldSupport>;
  reasons: string[];
  flags: string[];
  policyVersion: string;
  verifierVersion: string;
}

export interface VerifyInput {
  extraction: ExtractionResult;
  resolution: SourceResolution;
  text: string;
  observationOk: boolean;
  observedAt: Date;
  now: Date;
  requiresIndiaEvidence?: boolean;
  freshnessWindowDays?: number;
}

export function calculateConfidence(components: Record<string, number>, penalties: number[]): number {
  const base = Object.values(components).reduce((a, b) => a + b, 0);
  return Math.round(Math.max(0, Math.min(100, base - penalties.reduce((a, b) => a + b, 0))) * 10) / 10;
}

export function decideStatus(score: number, gates: Record<string, boolean>): "VERIFIED" | "REVIEW_REQUIRED" {
  const failed = Object.entries(gates).filter(([, ok]) => !ok);
  return score >= VERIFIED_THRESHOLD && failed.length === 0 ? "VERIFIED" : "REVIEW_REQUIRED";
}

export function freshnessPoints(ageDays: number): number {
  if (ageDays <= 7) return 10;
  if (ageDays <= 14) return 8;
  if (ageDays <= 30) return 5;
  if (ageDays <= 60) return 2;
  return 0;
}

export function verify(input: VerifyInput): VerificationResult {
  const { extraction: ex, resolution: res, text } = input;
  const reasons: string[] = [];
  const penalties: Penalty[] = [];
  const f = ex.fields;
  const primary = res.authority === "PRIMARY_CONFIRMED" || res.authority === "PRIMARY_DOCUMENT_CONFIRMED";

  // ---- field-level support
  const conflictOn = (name: string) => ex.conflicts.some((c) => c.field === name);
  const sup = (k: string): FieldSupport => (f[k] ? (f[k].support as FieldSupport) : "NOT_STATED");
  const fieldResults: Record<string, FieldSupport> = {
    name: f.name ? sup("name") : "UNSUPPORTED",
    provider: f.provider_name ? (res.providerMatch ? sup("provider_name") : "PARTIALLY_SUPPORTED") : "UNSUPPORTED",
    eligibility: f.eligibility_summary ? sup("eligibility_summary") : "NOT_STATED",
    deadline: conflictOn("closing_date") ? "CONFLICTING" : f.closing_date ? sup("closing_date") : "NOT_STATED",
    benefit: f.amount || f.benefit_type ? sup(f.amount ? "amount" : "benefit_type") : "NOT_STATED",
  };

  // ---- A. official source authority
  let authority = 0;
  if (res.authority === "PRIMARY_CONFIRMED") authority = 25;
  else if (res.authority === "PRIMARY_DOCUMENT_CONFIRMED") authority = PRIMARY_DOCUMENT_AUTHORITY_SCORE;
  else if (res.authority === "PRIMARY_LIKELY") authority = 8;
  if (authority < 25) reasons.push(`Official-source authority is ${res.authority} (${authority}/25).`);

  // ---- B. current official presence
  let presence = 0;
  const cycleContext = !!(f.closing_date || f.opening_date || f.academic_cycle || ex.signals.explicitOpen);
  if (input.observationOk && primary) presence = cycleContext ? 15 : 10;
  else if (input.observationOk && res.authority === "PRIMARY_LIKELY") presence = 5;
  if (presence < 15) reasons.push(presence === 10 ? "Official page present but no cycle/open-state evidence (10/15)." : `Current official presence not established (${presence}/15).`);

  // ---- C. critical field coverage
  let critical = 0;
  for (const [k, w] of Object.entries(FIELD_WEIGHTS)) {
    const r = fieldResults[k];
    if (r === "SUPPORTED") critical += w;
    else if (r === "PARTIALLY_SUPPORTED") critical += w / 2;
    else if (r === "NOT_STATED" && (k === "deadline" || k === "benefit")) critical += w; // optional fields: absence != unsupported assertion
    if (r !== "SUPPORTED" && !(r === "NOT_STATED" && (k === "deadline" || k === "benefit"))) reasons.push(`Critical field "${k}" is ${r}.`);
  }

  // ---- D. application pathway
  let application = 0;
  if (f.application_url && res.applicationValidated && primary) application = 10;
  else if (f.application_url && primary) application = 4;
  else if (f.application_instructions && primary) application = 7;
  if (application < 10) reasons.push(f.application_url ? "Application URL is not validated against official/application domains." : application === 7 ? "Instructions published but no direct application URL (7/10)." : "No application pathway published on the source (0/10).");

  // ---- E. freshness
  const ageDays = Math.max(0, daysBetween(input.observedAt, input.now));
  const freshness = input.observationOk ? freshnessPoints(ageDays) : 0;
  if (freshness < 10) reasons.push(`Last successful observation is ${ageDays} day(s) old (${freshness}/10).`);

  // ---- F. consistency
  const consistency = ex.conflicts.length ? 0 : 10;
  for (const c of ex.conflicts) reasons.push(`Conflicting values for ${c.field}: ${c.values.join(" vs ")}.`);

  // ---- G. provenance
  const invalid = Object.values(f).filter((x) => !x.quote || !quoteInText(text, x.quote));
  const provenance = invalid.length ? 0 : ex.droppedFields.length ? 3 : 5;
  if (invalid.length) reasons.push(`${invalid.length} field(s) lack verifiable evidence.`);
  if (ex.droppedFields.length) reasons.push(`Dropped unsupported field(s): ${ex.droppedFields.join(", ")}.`);

  const components = { authority, presence, critical_fields: critical, application, freshness, consistency, provenance };

  // ---- penalties (no double counting with component zeroing)
  if (res.authority === "PRIMARY_LIKELY") penalties.push({ code: "WEAK_PROVIDER_RELATIONSHIP", points: 10, reason: "Source is on a registered domain but provider/ownership is not fully confirmed." });
  if (Object.values(fieldResults).includes("PARTIALLY_SUPPORTED") && f.eligibility_summary?.method === "LLM_VALIDATED")
    penalties.push({ code: "PARTIAL_EVIDENCE", points: 15, reason: "Eligibility was proposed by an LLM and only partially supported." });
  else if (["name", "provider", "eligibility"].some((k) => fieldResults[k] === "PARTIALLY_SUPPORTED"))
    penalties.push({ code: "PARTIAL_EVIDENCE", points: 15, reason: "An important field has a partial/ambiguous evidence span." });
  if (input.observationOk && ageDays > (input.freshnessWindowDays ?? 60)) penalties.push({ code: "STALE_OBSERVATION", points: 25, reason: "Official observation older than the freshness window." });

  const score = calculateConfidence(components, penalties.map((p) => p.points));

  // ---- gates (all mandatory)
  const gates: Record<string, boolean> = {
    primary_source_confirmed: primary,
    official_presence_confirmed: primary && input.observationOk && !!f.name && ageDays <= (input.freshnessWindowDays ?? 60),
    critical_fields_supported: fieldResults.name === "SUPPORTED" && fieldResults.provider === "SUPPORTED" && fieldResults.eligibility === "SUPPORTED" && fieldResults.deadline !== "CONFLICTING" && fieldResults.deadline !== "PARTIALLY_SUPPORTED",
    critical_provenance_complete: invalid.length === 0,
    no_unresolved_critical_conflict: ex.conflicts.length === 0,
  };
  if (input.requiresIndiaEvidence) {
    gates.india_eligibility_supported = !!f.india_eligibility;
    if (!gates.india_eligibility_supported) reasons.push("International provider: the page does not state eligibility for applicants from India.");
  }
  for (const [g, ok] of Object.entries(gates)) if (!ok) reasons.push(`Mandatory gate failed: ${g}.`);
  for (const p of penalties) reasons.push(`Penalty −${p.points}: ${p.reason}`);

  const flags = [...ex.flags];
  if (fieldResults.eligibility !== "SUPPORTED") flags.push("ELIGIBILITY_PARTIAL");
  if (ageDays > (input.freshnessWindowDays ?? 60)) flags.push("STALE_OBSERVATION");
  const status = decideStatus(score, gates);
  if (status === "VERIFIED") reasons.unshift(`Score ${score} ≥ ${VERIFIED_THRESHOLD} and all mandatory gates passed.`);
  return { score, status, components, penalties, gates, fieldResults, reasons, flags: [...new Set(flags)], policyVersion: POLICY_VERSION, verifierVersion: VERIFIER_VERSION };
}
