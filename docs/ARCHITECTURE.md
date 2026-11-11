# Architecture map

Request path: `app/api/v1/*` (thin) → `lib/services/*` (workflows) → `lib/{discovery,crawling,extraction,verification,lifecycle}` (pure logic) → Drizzle repositories in `services/persist.ts` / `queries.ts`.

Run lifecycle (`services/crawl.ts`): lock → registry sync → queue (re-verification targets, pending candidates, seeds, sitemaps, search leads) → per item: robots → fetch → candidate/observation rows → link harvest → extraction → resolution → verification → persist → lifecycle sweep → run summary → unlock.

Policy lives in `config/*.yaml` (crawl budget, lifecycle windows, source registry) and `verification/verifier.ts` (versioned score policy).
