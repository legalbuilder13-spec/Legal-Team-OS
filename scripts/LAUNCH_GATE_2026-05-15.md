# Launch-gate review — 2026-05-15

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
