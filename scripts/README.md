# Rollout + ops scripts

Operational scripts for the pre-review analysis pipeline (see
[`PRD-Analysis-Pipeline.md`](../) in the repo root once published).

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
