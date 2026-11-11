/**
 * Crawl orchestration:
 * discover → classify → fetch → extract → resolve official source → verify → score → persist → lifecycle
 * Safe to run repeatedly on the same database (idempotent identities, no duplicate events).
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { crawlRuns, discoveredCandidates, fetchObservations, scholarships } from "@/db/schema";
import { getCrawlPolicy, getSettings } from "../config";
import { fetchAndNormalize, fetchText } from "../crawling/fetcher";
import { robotsAllowed } from "../crawling/robots";
import { extractCandidateLinks, parseSitemap, scoreLink, searchLeads, type DiscoveryMethod } from "../discovery/discovery";
import { extractScholarship } from "../extraction/extractor";
import { augmentWithLlm } from "../extraction/llm";
import { findSourceForUrl, resolveSource, type SourceRow } from "../verification/resolver";
import { verify } from "../verification/verifier";
import { hostMatchesAny, identityFingerprint, normalizeUrl } from "../util";
import { persistExtraction, recordFailure, refreshLifecycles } from "./persist";
import { requiresIndiaEvidence, syncSourceRegistry } from "./registry";

export interface RunOptions {
  trigger: "SCHEDULED" | "MANUAL" | "CLI" | "TEST";
  scope: "LIVE" | "FIXTURES" | "ALL";
  asOf?: string | null; // simulated clock (YYYY-MM-DD) — used for labelled demos only
  sourceKeys?: string[];
  scholarshipIds?: string[];
  reverifyOnly?: boolean;
  dueOnly?: boolean;
  maxPages?: number;
}

interface QItem {
  url: string;
  norm: string;
  depth: number;
  method: DiscoveryMethod;
  parent: string | null;
  anchor: string | null;
  score: number;
  source: SourceRow | null;
  reverifyId?: string;
}

const LOCK = "crawl";

async function acquireLock(owner: string, ttlMs = 30 * 60_000): Promise<boolean> {
  const until = new Date(Date.now() + ttlMs).toISOString();
  const r = await db.execute(sql`
    insert into job_locks (name, owner, locked_until) values (${LOCK}, ${owner}, ${until}::timestamptz)
    on conflict (name) do update set owner = excluded.owner, locked_until = excluded.locked_until
    where job_locks.locked_until < now() returning name`);
  return r.rows.length > 0;
}
async function releaseLock(owner: string) {
  await db.execute(sql`delete from job_locks where name = ${LOCK} and owner = ${owner}`);
}

export async function startRun(opts: RunOptions): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const owner = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLock(owner))) return { ok: false, error: "Another crawl run is already in progress (job lock held)." };
  try {
    const now = opts.asOf ? new Date(`${opts.asOf}T12:00:00Z`) : null;
    const [run] = await db
      .insert(crawlRuns)
      .values({ triggerType: opts.trigger, scope: opts.scope, simulatedNow: now, options: opts as never, configVersion: getCrawlPolicy().version })
      .returning({ id: crawlRuns.id });
    void executeRun(run.id, opts, owner);
    return { ok: true, runId: run.id };
  } catch (e) {
    await releaseLock(owner);
    return { ok: false, error: (e as Error).message };
  }
}

/** Starts a run and waits for completion (CLI / tests). */
export async function runAndWait(opts: RunOptions): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const r = await startRun(opts);
  if (!r.ok) return r;
  for (;;) {
    await new Promise((res) => setTimeout(res, 800));
    const row = (await db.select().from(crawlRuns).where(eq(crawlRuns.id, r.runId)).limit(1))[0];
    if (row && row.status !== "RUNNING") return { ok: row.status !== "FAILED", runId: r.runId };
  }
}

async function executeRun(runId: string, opts: RunOptions, owner: string) {
  const policy = getCrawlPolicy();
  const settings = getSettings();
  const now = opts.asOf ? new Date(`${opts.asOf}T12:00:00Z`) : new Date();
  const simulated = !!opts.asOf;
  const log: string[] = [];
  const errors: string[] = [];
  const c = { seed: 0, cand: 0, pages: 0, ok: 0, fail: 0, extracted: 0, persisted: 0, verified: 0, review: 0, changes: 0 };
  const say = (m: string) => {
    log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    if (log.length > 400) log.shift();
  };
  const flush = async (final?: { status: string }) => {
    await db
      .update(crawlRuns)
      .set({
        seedCount: c.seed, candidateCount: c.cand, pagesAttempted: c.pages, fetchSuccessCount: c.ok, fetchFailureCount: c.fail,
        extractionSuccessCount: c.extracted, persistedCount: c.persisted, verifiedCount: c.verified, reviewRequiredCount: c.review,
        changeEventCount: c.changes, errorSummary: errors.slice(0, 50), log: [...log],
        ...(final ? { status: final.status, finishedAt: new Date() } : {}),
      })
      .where(eq(crawlRuns.id, runId));
  };

  try {
    const allSources = await syncSourceRegistry();
    const inScope = (s: SourceRow | null) => {
      if (!s) return opts.scope !== "FIXTURES";
      if (opts.scope === "LIVE" && s.isFixture) return false;
      if (opts.scope === "FIXTURES" && !s.isFixture) return false;
      return true;
    };
    const active = allSources.filter((s) => s.enabled && inScope(s) && (!opts.sourceKeys?.length || opts.sourceKeys.includes(s.key)));
    say(`Run ${runId} started — scope=${opts.scope}${simulated ? ` SIMULATED clock ${opts.asOf}` : ""}; ${active.length} enabled source(s).`);

    const queue = new Map<string, QItem>();
    const done = new Set<string>();
    const enqueue = (it: Omit<QItem, "norm"> & { norm?: string }) => {
      const norm = it.norm ?? normalizeUrl(it.url);
      if (!norm || queue.has(norm) || done.has(norm)) return false;
      queue.set(norm, { ...it, norm } as QItem);
      return true;
    };

    // ---------------- re-verification targets: existing records are re-observed every run
    const conds = [];
    if (opts.scholarshipIds?.length) conds.push(sql`${scholarships.id} in (${sql.join(opts.scholarshipIds.map((i) => sql`${i}::uuid`), sql`,`)})`);
    if (opts.dueOnly) conds.push(or(isNull(scholarships.nextCheckAt), lte(scholarships.nextCheckAt, now))!);
    const existing = await db.select().from(scholarships).where(conds.length ? and(...conds) : undefined);
    const leadUrls = new Map<string, string>(); // records without an official URL are re-observed at the page they were extracted from
    for (const cd of await db.select({ sid: discoveredCandidates.scholarshipId, url: discoveredCandidates.normalizedUrl }).from(discoveredCandidates).where(sql`${discoveredCandidates.scholarshipId} is not null`)) {
      if (cd.sid && !leadUrls.has(cd.sid)) leadUrls.set(cd.sid, cd.url);
    }
    for (const s of existing) {
      const url = s.officialSourceUrl ?? leadUrls.get(s.id) ?? s.discoveryUrl;
      if (!url) continue;
      if (opts.scope === "LIVE" && s.isFixture) continue;
      if (opts.scope === "FIXTURES" && !s.isFixture) continue;
      const src = findSourceForUrl(url, allSources);
      if (src && opts.sourceKeys?.length && !opts.sourceKeys.includes(src.key)) continue;
      enqueue({ url, depth: 0, method: "REVERIFY", parent: null, anchor: s.name, score: 1000, source: src, reverifyId: s.id });
    }
    say(`Queued ${queue.size} existing record(s) for re-verification.`);

    // ---------------- pending candidates (manually submitted URLs / search leads never fetched yet)
    if (!opts.reverifyOnly) {
      const pending = await db.select().from(discoveredCandidates).where(and(eq(discoveredCandidates.processingStatus, "QUEUED"), isNull(discoveredCandidates.lastProcessedAt)));
      let n = 0;
      for (const p of pending) {
        const src = findSourceForUrl(p.normalizedUrl, allSources);
        if ((opts.scope === "LIVE" && p.isFixture) || (opts.scope === "FIXTURES" && !p.isFixture)) continue;
        if (enqueue({ url: p.discoveredUrl, norm: p.normalizedUrl, depth: p.depth, method: p.discoveryMethod as DiscoveryMethod, parent: p.discoverySourceUrl, anchor: p.anchorText, score: 7, source: src })) n++;
      }
      if (n) say(`Queued ${n} pending candidate(s) (manual submissions / leads).`);
    }

    // ---------------- discovery: seeds, sitemaps, optional search leads
    if (!opts.reverifyOnly) {
      for (const s of active) {
        for (const u of s.seedUrls) {
          if (enqueue({ url: u, depth: 0, method: "SEED", parent: null, anchor: s.name, score: 10, source: s })) c.seed++;
        }
        try {
          const first = s.seedUrls[0];
          if (!first) continue;
          const fu = new URL(first);
          const origin = `${fu.protocol}//${fu.host}`;
          const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`]);
          if (!s.isFixture) {
            const rb = await robotsAllowed(first).catch(() => null);
            rb?.sitemaps.slice(0, 3).forEach((u) => sitemapUrls.add(u));
          }
          let found = 0;
          const todo = [...sitemapUrls];
          let guard = 0;
          while (todo.length && guard++ < 6) {
            const sm = todo.shift()!;
            const r = await fetchText(sm, s.requestDelaySeconds);
            if (!r.ok) continue;
            const parsed = parseSitemap(r.text);
            todo.push(...parsed.sitemaps.slice(0, 4));
            for (const u of parsed.urls) {
              if (found >= policy.budget.max_sitemap_urls_per_source) break;
              if (!hostMatchesAny(u, s.officialDomains)) continue;
              if (scoreLink(u, "", { officialEnabled: true }) < policy.budget.link_relevance_min_to_fetch) continue;
              if (enqueue({ url: u, depth: 1, method: "SITEMAP", parent: sm, anchor: null, score: 6, source: s })) found++;
            }
          }
          if (found) say(`Sitemap discovery for ${s.key}: ${found} candidate URL(s).`);
        } catch (e) {
          errors.push(`sitemap ${s.key}: ${(e as Error).message}`);
        }
      }
      if (opts.scope !== "FIXTURES") {
        for (const lead of await searchLeads()) {
          const n = normalizeUrl(lead.url);
          if (!n) continue;
          const src = findSourceForUrl(n, allSources);
          await upsertCandidate({ url: lead.url, norm: n, depth: 0, method: "SEARCH_LEAD", parent: `search:${lead.query}`, anchor: lead.title, score: 0, source: src }, runId, src && src.enabled ? "QUEUED" : "DISCOVERED", src ? null : "Search lead outside the source registry — needs reviewer classification", () => c.cand++);
          if (src && src.enabled && inScope(src)) enqueue({ url: n, depth: 1, method: "SEARCH_LEAD", parent: `search:${lead.query}`, anchor: lead.title, score: 4, source: src });
        }
      }
    }

    // ---------------- main loop (single worker, per-domain delay in the fetcher)
    const budget = opts.maxPages ?? policy.budget.max_pages_per_run;
    let liveFetched = 0;
    while (queue.size) {
      const item = [...queue.values()].sort((a, b) => b.score - a.score || a.depth - b.depth)[0];
      queue.delete(item.norm);
      done.add(item.norm);
      const isFixtureItem = item.url.startsWith("fixture://");
      if (!isFixtureItem && liveFetched >= budget) {
        await upsertCandidate(item, runId, "DEFERRED", "Crawl budget (max pages per run) exhausted", () => c.cand++);
        continue;
      }
      if (!isFixtureItem) liveFetched++;
      try {
        await processItem(item);
      } catch (e) {
        errors.push(`${item.url}: ${(e as Error).message}`);
        say(`ERROR processing ${item.url}: ${(e as Error).message}`);
      }
      if (c.pages % 5 === 0) await flush();
    }

    // ---------------- lifecycle sweep (deadline-driven state transitions)
    const swept = await refreshLifecycles(now, runId, policy, simulated, opts.scope === "LIVE" ? false : opts.scope === "FIXTURES" ? true : undefined);
    c.changes += swept;
    if (swept) say(`Lifecycle sweep updated ${swept} record(s).`);

    const status = c.pages > 0 && c.ok === 0 ? "FAILED" : c.fail > 0 || errors.length ? "PARTIAL" : "SUCCESS";
    say(`Run finished: ${status}. pages=${c.pages} ok=${c.ok} fail=${c.fail} extracted=${c.extracted} persisted=${c.persisted} verified=${c.verified} review=${c.review} changes=${c.changes}`);
    await flush({ status });

    // ============ inner helpers (closures over counters/queue) ============
    async function processItem(item: QItem) {
      const src = item.source;
      c.pages++;
      const cand = await upsertCandidate(item, runId, "QUEUED", null, () => c.cand++);
      const delay = src?.requestDelaySeconds ?? 2;

      // robots.txt
      const rb = await robotsAllowed(item.url).catch(() => ({ allowed: true, sitemaps: [] as string[] }));
      if (!rb.allowed) {
        const [obs] = await db.insert(fetchObservations).values({ candidateId: cand.id, sourceId: src?.id ?? null, crawlRunId: runId, requestedUrl: item.url, fetchStatus: "FAILED", errorCode: "ROBOTS_DISALLOWED", errorMessage: "Disallowed by robots.txt", fetcherVersion: settings.fetcher_version, parserVersion: settings.parser_version }).returning({ id: fetchObservations.id });
        await setCand(cand.id, "SKIPPED_ROBOTS", "Disallowed by robots.txt");
        c.fail++;
        say(`SKIP (robots.txt) ${item.url}`);
        if (item.reverifyId) await recordFailure({ scholarshipId: item.reverifyId, code: "ROBOTS_DISALLOWED", now, runId, observationId: obs.id, policy, simulated });
        return;
      }

      const out = await fetchAndNormalize(item.url, delay);
      if (!out.ok || !out.doc) {
        const [obs] = await db.insert(fetchObservations).values({ candidateId: cand.id, sourceId: src?.id ?? null, crawlRunId: runId, requestedUrl: item.url, finalUrl: out.finalUrl, httpStatus: out.status, contentType: out.contentType, contentHash: out.contentHash, fetchStatus: "FAILED", errorCode: out.errorCode, errorMessage: out.errorMessage, fetcherVersion: out.fetcherVersion, parserVersion: out.parserVersion }).returning({ id: fetchObservations.id });
        await setCand(cand.id, "FETCH_FAILED", `${out.errorCode}: ${out.errorMessage}`);
        c.fail++;
        say(`FAIL ${out.errorCode} ${item.url}`);
        if (item.reverifyId) {
          const r = await recordFailure({ scholarshipId: item.reverifyId, code: out.errorCode ?? "UNKNOWN", now, runId, observationId: obs.id, policy, simulated });
          if (r) {
            if (r.changed) c.changes++;
            say(`  record failure #${r.failures}; lifecycle → ${r.status}${r.changed ? " (CHANGED)" : " (unchanged — failure alone is not removal)"}`);
          }
        }
        return;
      }
      c.ok++;
      const finalUrl = normalizeUrl(out.finalUrl ?? item.url) ?? item.url;
      const pageSource = findSourceForUrl(finalUrl, allSources) ?? (item.source && hostMatchesAny(finalUrl, item.source.officialDomains) ? item.source : null);
      const doc = out.doc;

      // ---- link harvesting (traversal + cross-links); candidates retained even when not fetched
      const maxDepth = pageSource?.maxDepth ?? 1;
      if (doc.kind === "HTML" && !opts.reverifyOnly) {
        const links = extractCandidateLinks(doc, finalUrl, pageSource, allSources).filter((l) => l.score >= policy.budget.link_relevance_min_to_store).slice(0, policy.budget.max_candidates_stored_per_page);
        let queued = 0;
        for (const l of links) {
          const target = l.targetSource;
          const isAgg = pageSource?.sourceType === "AGGREGATOR";
          const method: DiscoveryMethod = l.scope === "OFFICIAL_CROSSLINK" ? "OFFICIAL_CROSSLINK" : isAgg ? "AGGREGATOR_LINK" : "LISTING_TRAVERSAL";
          const fetchable =
            l.score >= policy.budget.link_relevance_min_to_fetch &&
            ((l.scope === "SAME_DOMAIN" && item.depth + 1 <= maxDepth) || (l.scope === "OFFICIAL_CROSSLINK" && !!target && target.enabled && inScope(target)));
          const reason = l.scope === "EXTERNAL" ? "Outside the source registry — not crawled" : fetchable ? null : "Below relevance threshold or beyond max depth";
          await upsertCandidate({ url: l.url, norm: l.url, depth: item.depth + 1, method, parent: finalUrl, anchor: l.anchor, score: l.score, source: target ?? pageSource }, runId, fetchable ? "QUEUED" : "DISCOVERED", reason, () => c.cand++);
          if (fetchable && enqueue({ url: l.url, norm: l.url, depth: l.scope === "OFFICIAL_CROSSLINK" ? 1 : item.depth + 1, method, parent: finalUrl, anchor: l.anchor, score: l.score, source: target ?? pageSource })) queued++;
        }
        if (queued) say(`  ${queued} link(s) queued from ${finalUrl}`);
      }

      // ---- extraction
      let ex = extractScholarship(doc, { providerName: pageSource?.providerName, providerAliases: pageSource?.providerAliases });
      ex = await augmentWithLlm(doc, ex);
      const forced = !!item.reverifyId && !!ex.fields.name && (ex.signals.explicitDiscontinued || ex.signals.explicitClosed);
      const isSch = ex.isScholarshipPage || forced;

      const [obs] = await db
        .insert(fetchObservations)
        .values({
          candidateId: cand.id, sourceId: pageSource?.id ?? null, crawlRunId: runId, requestedUrl: item.url, finalUrl, httpStatus: out.status, contentType: out.contentType,
          contentHash: out.contentHash, normalizedTextHash: out.textHash, normalizedText: isSch ? doc.text : null, title: doc.title, fetchStatus: "SUCCESS",
          fetcherVersion: out.fetcherVersion, parserVersion: out.parserVersion,
        })
        .returning({ id: fetchObservations.id });

      if (!isSch) {
        await setCand(cand.id, "NOT_SCHOLARSHIP_PAGE", `Insufficient scholarship signals (${ex.pageSignals.join(", ") || "none"}) — treated as listing/other page`, { candidateTitle: ex.fields.name?.value as string | undefined });
        if (item.reverifyId) {
          // page reachable but no longer recognisable: counts as a failed observation, never as removal by itself
          const r = await recordFailure({ scholarshipId: item.reverifyId, code: "CONTENT_NOT_RECOGNISED", now, runId, observationId: obs.id, policy, simulated });
          if (r?.changed) c.changes++;
          c.fail++;
          c.ok--;
          say(`  re-verify: page no longer shows scholarship content (${item.url})`);
        }
        return;
      }
      c.extracted++;

      const resolution = resolveSource({ finalUrl, source: pageSource, extraction: ex, doc, allSources });
      const verification = verify({
        extraction: ex, resolution, text: doc.text, observationOk: true, observedAt: now, now,
        requiresIndiaEvidence: requiresIndiaEvidence(pageSource?.key ?? null), freshnessWindowDays: policy.lifecycle.freshness_window_days,
      });

      // aggregator leads: queue the provider-controlled pages they point to
      for (const u of resolution.officialLinks) {
        const target = findSourceForUrl(u, allSources);
        if (target && target.enabled && inScope(target) && enqueue({ url: u, norm: u, depth: 1, method: "OFFICIAL_CROSSLINK", parent: finalUrl, anchor: null, score: 8, source: target })) say(`  lead → official page queued: ${u}`);
      }

      if (!ex.fields.name) {
        await setCand(cand.id, "EXTRACTION_FAILED", "EVIDENCE_NOT_FOUND: no scholarship name");
        return;
      }
      const outcome = await persistExtraction({
        runId, observationId: obs.id, candidateId: cand.id, url: finalUrl, doc, contentHash: out.contentHash, extraction: ex, resolution, verification,
        source: pageSource, now, simulated, discoveryUrl: item.parent ?? item.url, isFixture: !!pageSource?.isFixture || finalUrl.startsWith("fixture://"), policy,
      });
      if (outcome.action !== "DUPLICATE_LEAD") {
        c.persisted++;
        c.changes += outcome.changeEvents;
        if (outcome.status === "VERIFIED") c.verified++;
        else c.review++;
      }
      const fp = identityFingerprint((ex.fields.provider_name?.value as string) ?? pageSource?.providerName ?? null, ex.fields.name.value as string, (ex.fields.academic_cycle?.value as string) ?? null);
      await setCand(cand.id, outcome.action === "DUPLICATE_LEAD" ? "DUPLICATE_LEAD" : "PERSISTED", `${outcome.action} — ${verification.score} ${outcome.status} (${resolution.authority})`, { scholarshipId: outcome.scholarshipId, candidateFingerprint: fp, candidateTitle: ex.fields.name.value as string });
      say(outcome.action === "DUPLICATE_LEAD"
        ? `DUPLICATE_LEAD "${ex.fields.name.value}" — secondary page matches an existing primary-confirmed record; existing facts untouched`
        : `${outcome.action} "${ex.fields.name.value}" → ${outcome.status} ${verification.score} [${resolution.authority}]${outcome.changeEvents ? `, ${outcome.changeEvents} change event(s)` : ""}`);
    }
  } catch (e) {
    errors.push((e as Error).message);
    say(`FATAL: ${(e as Error).message}`);
    await flush({ status: "FAILED" });
  } finally {
    await releaseLock(owner);
  }
}

// ---------------------------------------------------------------- candidate helpers
async function upsertCandidate(
  item: Omit<QItem, "norm"> & { norm?: string },
  runId: string,
  status: string,
  reason: string | null,
  onNew: () => void,
) {
  const norm = item.norm ?? normalizeUrl(item.url) ?? item.url;
  const existing = (await db.select().from(discoveredCandidates).where(eq(discoveredCandidates.normalizedUrl, norm)).limit(1))[0];
  if (existing) {
    await db
      .update(discoveredCandidates)
      .set({ lastSeenAt: new Date(), timesSeen: existing.timesSeen + 1, ...(status === "QUEUED" ? { processingStatus: "QUEUED" } : {}) })
      .where(eq(discoveredCandidates.id, existing.id));
    return existing;
  }
  const src = item.source;
  const [row] = await db
    .insert(discoveredCandidates)
    .values({
      crawlRunId: runId, discoveredUrl: item.url, normalizedUrl: norm, discoverySourceUrl: item.parent, discoveryMethod: item.method, anchorText: item.anchor,
      sourceId: src?.id ?? null, classification: !src ? "UNKNOWN" : src.authorityLevel === "PRIMARY" ? "OFFICIAL" : "LEAD", sourceType: src?.sourceType ?? null,
      relevanceScore: item.score >= 1000 ? 99 : item.score, depth: item.depth, processingStatus: status, statusReason: reason, isFixture: item.url.startsWith("fixture://") || !!src?.isFixture,
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    onNew();
    return row;
  }
  return (await db.select().from(discoveredCandidates).where(eq(discoveredCandidates.normalizedUrl, norm)).limit(1))[0];
}

async function setCand(id: string, status: string, reason: string | null, extra: { scholarshipId?: string; candidateFingerprint?: string; candidateTitle?: string } = {}) {
  await db
    .update(discoveredCandidates)
    .set({ processingStatus: status, statusReason: reason, lastProcessedAt: new Date(), ...extra })
    .where(eq(discoveredCandidates.id, id));
}
