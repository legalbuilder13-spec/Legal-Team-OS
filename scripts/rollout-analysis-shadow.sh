#!/usr/bin/env bash
# rollout-analysis-shadow.sh
#
# One-shot rollout for the pre-review analysis pipeline (PRD-Analysis-Pipeline.md).
# Run after PRs #32–#35 have merged to main and the Railway deploys are green.
# Idempotent — re-running won't double-flip env vars.
#
# What this does:
#   1. Verifies the Railway CLI is installed + authenticated.
#   2. Confirms the matter_analyses tables exist (migration 0020 ran).
#   3. Sets ANALYSIS_PIPELINE_ENABLED=shadow on the worker service so the
#      pipeline runs end-to-end but never surfaces to lawyers. The auto
#      stages still write matter_analyses + stage rows; the Slack-notify
#      drop-in is suppressed (per analyze.ts shadowMode branch).
#   4. Triggers a redeploy of the worker so the new env var is picked up.
#   5. Optional: pre-seeds shadow_mode_metadata on existing open matters
#      so the retrospective accuracy review starts from a known baseline.
#
# Phases 2-4 (statutory / case-law / deconstruct tools) are NOT enabled by
# this script. They're gated by their own TOOL_AVAILABILITY flags inside
# the web router and stay disabled in shadow mode by design — the auto
# pipeline is the only thing under shadow.
#
# Usage:
#   scripts/rollout-analysis-shadow.sh [--dry-run]
#
# Requires:
#   - Railway CLI at $RAILWAY_CLI (default: /tmp/railway-bin/railway).
#     Re-download if missing: curl -fsSL https://railway.com/install.sh | sh -O /tmp/railway-bin/railway
#   - RAILWAY_TOKEN env var with an account-scope token.
#   - psql in $PATH OR python3 + pg8000 in the worker's image for the
#     migration-check step. Falls back to skipping that check if neither
#     is available.
#
# Refs: PRD-Analysis-Pipeline.md §19.1 (Phase 1 MVP scope + feature
# flag + shadow mode), §6.1 (matter detail page — auto-pipeline
# section), §20.1 (shadow-mode validation as the launch gate).

set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
  esac
done

RAILWAY_CLI="${RAILWAY_CLI:-/tmp/railway-bin/railway}"
RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-16eac46f-590f-4652-9944-b72294508b1c}"
WORKER_SERVICE="${WORKER_SERVICE:-worker}"
TARGET_VALUE="${ANALYSIS_PIPELINE_ENABLED_TARGET:-shadow}"

say() { printf '\033[1;36m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '\033[1;33m[dry-run]\033[0m %s\n' "$*"
  else
    eval "$@"
  fi
}

say "Step 1: verifying Railway CLI…"
[ -x "$RAILWAY_CLI" ] || fail "Railway CLI not found at $RAILWAY_CLI. Re-download with: curl -fsSL https://railway.com/install.sh | sh -O /tmp/railway-bin/railway"
[ -n "${RAILWAY_TOKEN:-}" ] || fail "RAILWAY_TOKEN not set. Create an account-scope token at https://railway.com/account/tokens"
ok "Railway CLI ready: $($RAILWAY_CLI --version)"

say "Step 2: confirming pipeline migration ran…"
# Try psql first, then pg8000 via python. The migration creates the
# matter_analyses table — if it doesn't exist the rollout is premature.
MIGRATION_CHECKED=0
if command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  if psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'matter_analyses'" | grep -q '^1$'; then
    ok "matter_analyses table present"
    MIGRATION_CHECKED=1
  else
    fail "matter_analyses table not found. PR #32's migration 0020 hasn't run yet — wait for the deploy + preDeploy hook to complete."
  fi
elif command -v python3 >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  if python3 -c "
import os, sys
try:
    import pg8000.native
except ImportError:
    sys.exit(2)
url = os.environ['DATABASE_URL']
# pg8000 doesn't parse URL — do it lazily.
from urllib.parse import urlparse
u = urlparse(url)
conn = pg8000.native.Connection(
    host=u.hostname, port=u.port or 5432, database=u.path[1:],
    user=u.username, password=u.password,
)
rows = conn.run(\"SELECT 1 FROM information_schema.tables WHERE table_name = 'matter_analyses'\")
sys.exit(0 if rows else 1)
"; then
    ok "matter_analyses table present"
    MIGRATION_CHECKED=1
  else
    code=$?
    if [ "$code" = "2" ]; then
      say "pg8000 not installed; skipping migration check"
    else
      fail "matter_analyses table not found. PR #32's migration 0020 hasn't run yet."
    fi
  fi
fi
[ "$MIGRATION_CHECKED" = "1" ] || say "(migration check skipped — neither psql nor pg8000 available)"

say "Step 3: setting ANALYSIS_PIPELINE_ENABLED=$TARGET_VALUE on $WORKER_SERVICE…"
# --skip-deploys: set the value without triggering a redeploy yet; we
# bundle the redeploy into one explicit step so the operator sees a
# single deploy timing.
run "$RAILWAY_CLI variables -s $WORKER_SERVICE --skip-deploys --set ANALYSIS_PIPELINE_ENABLED=$TARGET_VALUE"
ok "Env var queued"

say "Step 4: redeploying $WORKER_SERVICE so the new env takes effect…"
run "$RAILWAY_CLI redeploy --service $WORKER_SERVICE --yes"
ok "Redeploy triggered. Watch logs with: $RAILWAY_CLI logs -s $WORKER_SERVICE --deployment"

cat <<EOF

\033[1;32mRollout complete.\033[0m

The auto pipeline (Stage 0 pre-merits + Stage 1 playbook check) now runs
on every new matter, writes matter_analyses + matter_analysis_stages
rows, but is invisible to lawyers (the slack_notify drop-in is
suppressed in shadow mode).

Verification window:
  1. Wait 24-72h after the next batch of /legal intakes.
  2. Compare matter_analysis_stages rows against the lawyer's own
     conclusions captured in matter_notes / triage_metadata.
  3. The launch gate from PRD §20.1: <15% lawyer override rate on
     Stage 1 'matched' verdicts, and >20% true-positive match rate.

When ready to flip to live:
  $RAILWAY_CLI variables -s $WORKER_SERVICE --skip-deploys \\
      --set ANALYSIS_PIPELINE_ENABLED=true
  $RAILWAY_CLI redeploy --service $WORKER_SERVICE --yes

To roll back to off:
  $RAILWAY_CLI variables -s $WORKER_SERVICE --skip-deploys \\
      --set ANALYSIS_PIPELINE_ENABLED=false
  $RAILWAY_CLI redeploy --service $WORKER_SERVICE --yes

EOF
