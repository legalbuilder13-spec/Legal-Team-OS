# Launch-gate review — 2026-05-15

> **Two reads in this document.** The first-read section below records the original review that diagnosed the missing-Notion-pages problem. The [second-read section at the bottom](#second-read--2026-05-15-after-pr-62--re-trigger) records the gate re-read after PR #62 seeded the Notion pages and the 9 existing matters were re-analyzed against the new content.
>
> **Headline of second read: still DO NOT PROMOTE.** Matched-rate is still 0%. Root cause has shifted from "no Notion content to retrieve" (PR #62 fixed that — retrieval now works) to "seed playbook content is too generic to win on-point grades against specific fact patterns." Fix is content quality, not infrastructure.

## First read (initial review)

Result: **DO NOT PROMOTE.** The pipeline is healthy on every dimension the gate measures *except* matched-rate, which is 0% across every practice area. The cause is a data problem (the playbooks-in-Notion pipeline isn't seeded), not a pipeline problem. Fix the data, then re-run the gate.

## Window

7-day window ending 2026-05-15. **N = 9 matters analyzed** across 5 practice areas. This sample size is small enough that any gate read should be considered weak signal — but the matched-rate finding is bimodal (0 of 9), so confidence is high that the bottleneck is structural rather than statistical.

## Gates

| Gate (PRD §20.1) | Threshold | Measured | Pass |
|---|---|---|---|
| Matched-rate (any practice area) | > 20% | **0.0%** in all 5 areas | ❌ |
| LOW-confidence rate | < 30% | 0.0% (0 of 9) | ✅ |
| p50 end-to-end latency | < 60s | 12.1s (p95 22.1s) | ✅ |
| Stage failure rate (auto pipeline) | < 5% | pre_merits 0%, guidance 0% | ✅ |
| Override rate on matched | < 15% | n/a — no matched verdicts | — |

The auto pipeline (Stage 0 + Stage 1) is **fast, reliable, and confident** — it's just confidently producing "no_hit" on every matter.

## Root cause of 0% matched-rate

Three data-shape problems compound:

1. **Only 3 playbooks exist** in `playbooks` (NDA & MSA, Contractor Classification, DSR Protocol). Seed state, never extended.
2. **None of the 3 have `notion_page_id` set.** Stage 1 searches Notion workspace-wide for guidance pages. The playbooks registry's role is to canon-tier-boost candidates that ALSO appear in Notion search results — but the registry can't help if its rows don't point at Notion pages.
3. **All 3 are `canon_tier='draft'`.** Even after a Notion search hit, draft tier gets +0 boost — so they'd lose ties to anything tier-tagged. (Moot until #2 is fixed.)

The Notion workspace tree exists (Saved Matters / Playbooks / KB / Templates, see `reference_notion.md`), but the Playbooks tree is empty or invisible to the integration. Stage 1's `searchNotion` call returns zero candidates → grader has nothing to score → verdict is no_hit for every matter.

This explains **why the pipeline runs fast** too — no candidates means no Notion fetches, no AI grading round-trip.

## What "ready" would look like

For a meaningful gate read:

1. **At least 5 playbook pages live in the Notion Playbooks tree**, shared with the Legal Team OS integration, with content the grader can ground on (jurisdiction, facts, position).
2. **`playbooks.notion_page_id` populated** for each, via the existing `savePlaybookFromStage` flow or manual UPDATE.
3. **At least 1 playbook promoted to `org` tier**, so the canon-tier boost has something to amplify. Otherwise the M4 promote-playbooks cron has no signal — drafts get +0 today.
4. **Re-run the gate after 30+ matters analyzed** post-fix. Statistical noise at N=9 is too high to draw conclusions either way.

## Out-of-scope but worth noting

- **Statutory tool failed 2/2 times** with `audit_notes='all fetches failed'`. Lawyer-invoked tool, not part of the auto-pipeline gate, but worth a separate investigation — likely CourtListener anonymous-tier rate limit (~100 req/day). The `COURTLISTENER_API_KEY` env var is unset on the worker.
- **Verification status:** 6 sources in `pending` state, 0 verified. Screenshot-and-compare verification is off (`SCREENSHOTS_ENABLED=false`, per `feedback_migrations.md` follow-up #4). Not a launch gate, but the snapshot loop won't run until that's wired.
- **0 lawyer decisions** in window (no `analysis.stage_accepted` or `analysis.stage_rejected` audit rows). Override-rate gate is unmeasurable until lawyers start actioning stages.

## Recommendation

**Do not flip `ANALYSIS_PIPELINE_ENABLED=shadow → true`.** Doing so today would surface a "lawyer review needed" Slack message on every analyzed matter, which (a) provides no signal lift over the current shadow output and (b) creates noise that erodes lawyer trust in the system before there's any wins to point at.

Action items, ordered:

1. Populate the Notion Playbooks tree with at least 5 substantive playbook pages.
2. Wire each into the `playbooks` registry with `notion_page_id` set.
3. Promote a couple to `canon_tier='org'` manually (this is what M4 will eventually automate).
4. Let the pipeline run for 30+ matters in shadow mode.
5. Re-run `scripts/shadow-mode-metrics.sql`. If matched-rate clears 20% in at least one practice area, flip to `true`.

---

## Second read — 2026-05-15 (after PR #62 + re-trigger)

Result: **STILL DO NOT PROMOTE.** Matched-rate is 0% again. Root cause has shifted, though — retrieval now works, the grader is functioning, but the seed playbook content is too generic to win on-point grades against the specific fact patterns we have. This is a content-quality problem, not an infrastructure problem. Fix is to flesh out the playbook content, not to touch code.

### Method

Steps 1–3 of the first-read remediation plan were executed in PR [#62](https://github.com/legalbuilder13-spec/Legal-Team-OS/pull/62):

1. Seeded 3 Notion pages under the Playbooks tree (NDA & MSA — commercial; Contractor Classification — employment; DSR Response Protocol — privacy).
2. Wired each `playbooks.notion_page_id` to the corresponding page.
3. Manually promoted NDA & MSA to `canon_tier='org'`.

Step 4 of the original plan — wait for 30 new matters — was deferred because this environment has zero new matters since the seed (organic volume too low to wait for). Instead, the 9 existing matters were **re-enqueued through `analyze`** so Stage 1 retrieval and grading would execute against the now-seeded Notion content. Stage 0 ran clean on all 9 (no failures, MEDIUM confidence across the board), and Stage 1 retrieved candidates for every matter — see telemetry below.

### Gates (post re-trigger, N=9)

| Gate | Threshold | First read | Second read | Pass |
|---|---|---|---|---|
| Matched-rate | > 20% | 0.0% all areas | **0.0% all areas** | ❌ |
| LOW-confidence rate | < 30% | 0.0% | 0.0% | ✅ |
| p50 latency | < 60s | 12.1s | 23.3s (p95 28.0s) | ✅ |
| Auto-pipeline stage failures | < 5% | 0% | 0% | ✅ |
| Override rate on matched | < 15% | n/a | n/a | — |

Latency roughly doubled (12s → 23s) because Stage 1 now actually does work — Notion search returned candidates, the worker fetched each candidate's excerpt, and the grader scored them. The previous run had Stage 1 short-circuiting on zero candidates. The new latency is still well within the gate.

### What retrieval looked like

Verdicts: 0 matched, 1 related_only, 8 no_hit.

- **2 commercial matters** retrieved `NDA & MSA Review Checklist` → both `no_hit`. The commercial matters are actually a litigation threat ("Acme Logistics over conveyor damage") and a vendor renegotiation issue — neither is an NDA or MSA review.
- **2 privacy matters** retrieved `DSR Response Protocol` → both `no_hit`. The privacy matters are about *AI subprocessor disclosure in DPAs* and *DPIA scope for a new feature* — adjacent to DSR but not the same topic.
- **3 IP matters** all retrieved generic candidates (NDA & MSA, Contractor Classification) → 2 `no_hit`, 1 `related_only`. The `related_only` was M-P7NDUQJL (IP-assignment gap for a former contractor turned employee) which correctly mapped to Contractor Classification with on_point ≈ 0.55 — the grader said *related but not on-point*, which is the right call given the playbook is about classification, not assignment.
- **1 regulatory, 1 litigation matter** retrieved no relevant playbook (none seeded for those areas).

In other words, **the grader is doing its job.** When it sees an NDA-related playbook retrieved for a conveyor-damage litigation, it correctly says no_hit. When it sees a Contractor Classification playbook retrieved for an IP-assignment question about a former contractor, it correctly says related_only. Generic checklist playbooks against specific fact patterns will earn `no_hit` or `related_only` more often than `matched`. That's expected behavior, not a bug.

### Noise problem (newly visible from the trace)

Stage 1's Notion search returns the **Playbooks tree page itself** (`📚 Playbooks`) and **`[Template] Playbook`** as candidates for every matter. Neither is a playbook — the tree is just a container, and the `[Template] ` prefix is a documented convention from the Notion setup memory note (intended to be filtered from retrieval but never wired in).

This adds 2 noise rows to every retrieval set, eating into the candidate cap (currently 8). Not a launch-gate blocker — the grader correctly ignores them — but worth fixing because (a) it wastes the grader's tokens and (b) any AI-generated headline citing the tree page would look broken.

Cheap fix: in `apps/worker/src/handlers/analyze/stage-1-guidance.ts`, after the `searchNotion` call, drop hits whose title starts with `[Template] ` or matches the configured tree IDs (Playbooks / Saved Matters / KB / Templates). Worth a follow-up PR.

### Action items (revised, in priority order)

1. **Replace the 3 generic-checklist playbooks with substantive content.** Each should walk through the most common fact patterns in its area, the standard position, jurisdictional carve-outs, and example language. The grader needs substrate to score against, not bullet-point checklists.
2. **Wire the `[Template] ` + tree-page filter** into `stage-1-guidance.ts` so the candidate pool isn't diluted with non-playbook pages. Small change; high signal-to-noise improvement.
3. **Add playbooks for the practice areas we actually see matters in.** Current seed covers commercial/employment/privacy, but matter volume so far is heavily IP (3), with one each of regulatory/litigation. No playbook = guaranteed no_hit.
4. **Re-run this gate** (re-trigger the 9 matters again) after 1+2 land. With richer content + cleaner retrieval, a few of the topic-adjacent matches should clear the on-point threshold and matched-rate should move off zero.
5. **Until then, do not flip `ANALYSIS_PIPELINE_ENABLED` to `true`.** Per the original gate condition: flip only when matched-rate clears 20% somewhere.

### Flip decision

**Not flipped.** Honoring the original conditional ("flip only if matched-rate clears 20% somewhere") — the condition is not met. Worker `ANALYSIS_PIPELINE_ENABLED` remains at `shadow`.
