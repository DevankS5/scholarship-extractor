# Technical note (≤3 pages)

**Goal.** Maintain a continuously refreshed, auditable repository of scholarships for Indian students, where every fact answers: *where from, is the source authoritative, what exact text supports it, when was it last seen, what changed, why is it trusted.*

**Design.** Modular monolith (Next.js + Drizzle/PostgreSQL). Pipeline: discovery (seeds, sitemaps, listing traversal, official cross-links, aggregator/search leads) → fetch (robots, delays, retries, PDF) → normalisation → deterministic evidence-first extraction (+ optional quote-validated local LLM) → source resolution → deterministic confidence (policy v1.0) with five mandatory gates → one-transaction persistence (change events, immutable version, current record, verification result) → lifecycle.

**Confidence.** Authority 25, presence 15, critical-field evidence 25, application pathway 10, freshness 10, consistency 10, provenance 5, minus explicit penalties. VERIFIED needs ≥95 and all gates; an LLM never sets a score. A document-only primary source scores 18/25 on authority by policy and therefore cannot reach 95 without an explicit policy change.

**Change & staleness.** Normalised fields are diffed; auto-accept only from confirmed primary sources; eligibility changes, removals and conflicts wait for a reviewer. Failures are observations; NO_LONGER_VERIFIABLE needs ≥3 consecutive failures and a 14-day grace period; REMOVED requires explicit provider wording; reappearance is recorded and re-verified.

**Honesty.** Real and simulated (fixture) data are separated everywhere. Fixtures prove behaviour (idempotency, 2 change events, 2 expiries, 1 stale transition) without pretending to be provider announcements. Real-source yield depends on reachability and page structure; the dashboard reports discovered / extracted / primary-checked / verified / review-required separately.

**Limitations / next steps.** Playwright rendering and OCR (lower-confidence path), provider-specific parsers for the largest portals, gold-set calibration of the score, per-source crawl cadence tuning, multi-worker queue.
