# Rollout + ops scripts

Operational scripts for the pre-review analysis pipeline (see
[`PRD-Analysis-Pipeline.md`](../) in the repo root once published).

## M3 — Eval corpus

Extract a regression-replay corpus from production:

```bash
DATABASE_URL=postgres://... pnpm tsx scripts/build-eval-corpus.ts \
  --out eval/v1/ --lookback-days 365 --limit 500
```

Outputs one JSONL per stage (`statutory.jsonl`, `case_law.jsonl`, ...)
plus a `manifest.json`. CI validates committed corpus files against
the current Pydantic output schemas (no LLM cost). Full LLM-replay is
manual: `python -m src.eval.schema_check eval/latest/` and
`python -m src.eval.replay eval/v1/ --out eval/results/`.

## Phase 1 rollout (auto pipeline → shadow mode)

After PRs #32–#35 merge:

```bash
# Re-download the Railway CLI if missing.
curl -fsSL https://railway.com/install.sh | sh -O /tmp/railway-bin/railway

# Set RAILWAY_TOKEN from https://railway.com/account/tokens (account-scope).
export RAILWAY_TOKEN=...

# Dry-run first to see exactly what will run.
scripts/rollout-analysis-shadow.sh --dry-run

# Then for real.
scripts/rollout-analysis-shadow.sh
```

The script:
1. Confirms the Railway CLI is present + authenticated.
2. Confirms migration 0020 ran (the `matter_analyses` table exists).
3. Sets `ANALYSIS_PIPELINE_ENABLED=shadow` on the worker service.
4. Redeploys the worker so the new env var is picked up.

Override the targets via env if needed:

```bash
RAILWAY_PROJECT_ID=<id> WORKER_SERVICE=<name> scripts/rollout-analysis-shadow.sh
```

## Shadow-mode validation (before flipping to live)

Wait 24–72h after rollout. Then evaluate the launch gates from PRD §20.1:

```bash
psql "$DATABASE_URL" -f scripts/shadow-mode-metrics.sql
```

The script prints:

| Metric | Target | What it tells you |
|---|---|---|
| `matched_pct` | > 20% per practice area | The relevance grader isn't too strict. |
| `low_pct` | < 30% | Pipeline isn't consistently failing upstream. |
| `p50_seconds` | < 60 | End-to-end latency is acceptable. |
| `failure_pct` | < 5% per stage | Skills + handlers are stable. |
| verification breakdown | mostly `pending` or `verified` | The verification gate isn't producing material discrepancies. |

The **override-rate gate** from §20.1 (< 15% lawyer overrides on matched verdicts) isn't computable from `audit_log` alone — the override mutations don't currently emit audit events. Track it manually from `matter_notes` for the first 2–3 weeks of shadow mode.

## Seeding playbook Notion pages (launch-gate prerequisite)

If `shadow-mode-metrics.sql` shows 0% matched-rate (see [`LAUNCH_GATE_2026-05-15.md`](LAUNCH_GATE_2026-05-15.md) for the assessment that ran into this), the cause is usually that `playbooks.notion_page_id` is NULL for every row. Stage 1's Notion search returns 0 candidates → grader has nothing to score → no_hit on every matter.

This script creates a Notion child page for each unwired playbook and updates the DB row:

```bash
# Dry-run first.
DATABASE_URL=postgres://... \
  NOTION_API_KEY=secret_... \
  PLAYBOOKS_PARENT_PAGE_ID=35f598cc-a369-8145-83ba-cf7786ff2d33 \
    pnpm --filter @legal/web exec tsx ../../scripts/seed-playbook-notion-pages.ts --dry-run

# For real.
DATABASE_URL=postgres://... \
  NOTION_API_KEY=secret_... \
  PLAYBOOKS_PARENT_PAGE_ID=35f598cc-a369-8145-83ba-cf7786ff2d33 \
    pnpm --filter @legal/web exec tsx ../../scripts/seed-playbook-notion-pages.ts
```

The script is idempotent — rows that already have `notion_page_id` set are skipped. After running, manually promote at least one playbook to `canon_tier='org'` so the M4 canon-tier boost has something to amplify:

```sql
UPDATE playbooks SET canon_tier='org', last_promoted_at=now()
  WHERE title='NDA & MSA Review Checklist';
```

## Flipping to live

After the shadow window meets the gates:

```bash
/tmp/railway-bin/railway variables -s worker --skip-deploys --set ANALYSIS_PIPELINE_ENABLED=true
/tmp/railway-bin/railway redeploy --service worker --yes
```

Lawyers immediately start seeing the auto-pipeline output in the matter detail page. PRs #33–#35 (the lawyer-invoked research tools) light up their buttons because the `TOOL_AVAILABILITY` flags in `apps/web/src/server/routers/tools.ts` are set to `enabled: true` by the merged code — no additional env var needed.

## Rolling back

```bash
/tmp/railway-bin/railway variables -s worker --skip-deploys --set ANALYSIS_PIPELINE_ENABLED=false
/tmp/railway-bin/railway redeploy --service worker --yes
```

The pipeline silently no-ops on every triage-emitted `analyze` job; the matter detail page shows "The pre-review analysis pipeline has not run for this matter yet." until the flag flips back on.

## Optional: PR6 screenshot verification

PR #37 ships behind its own flag. Activation requires more than env tweaks because it adds runtime dependencies. See the PR description on GitHub for the full deploy steps.

```bash
# Install the optional deps + the chromium binary in the worker.
pnpm install
pnpm --filter @legal/worker exec playwright install chromium --with-deps

# Configure S3-compatible bucket (Cloudflare R2 recommended for cost).
/tmp/railway-bin/railway variables -s worker --skip-deploys \
  --set SCREENSHOTS_ENABLED=true \
  --set SNAPSHOTS_BUCKET=<bucket> \
  --set SNAPSHOTS_S3_ENDPOINT=<endpoint> \
  --set SNAPSHOTS_S3_REGION=auto \
  --set SNAPSHOTS_S3_ACCESS_KEY_ID=<key> \
  --set SNAPSHOTS_S3_SECRET_ACCESS_KEY=<secret> \
  --set SNAPSHOTS_PUBLIC_BASE_URL=<pub-url>

/tmp/railway-bin/railway redeploy --service worker --yes
```
