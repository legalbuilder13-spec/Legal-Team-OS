#!/usr/bin/env bash
# Guard against the two silent-skip failure modes documented in
# the project's migration workflow notes:
#
#   Failure mode 2 — drizzle's migrator only reads entries in
#   packages/db/drizzle/meta/_journal.json. A .sql file in the
#   drizzle/ folder without a matching journal entry is silently
#   ignored at deploy time; the migrator prints "Migrations
#   applied" but runs zero SQL.
#
#   Failure mode 3 — drizzle's pg-core migrator gates each entry
#   on `lastDbMigration.created_at < entry.when`. A new entry with
#   a `when` value <= the previous applied entry's `created_at`
#   is also silently skipped.
#
# This script fails CI when either condition is detected, before
# the broken migration reaches Railway. Exits 0 when everything
# lines up.

set -euo pipefail

DRIZZLE_DIR="packages/db/drizzle"
JOURNAL="$DRIZZLE_DIR/meta/_journal.json"

if [[ ! -f "$JOURNAL" ]]; then
  echo "ERROR: journal not found at $JOURNAL"
  exit 1
fi

# Set of "NNNN_name" tags derived from .sql filenames
sql_tags=$(find "$DRIZZLE_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' -type f \
  | xargs -n1 basename \
  | sed 's/\.sql$//' \
  | sort)

# Set of tags from the journal
journal_tags=$(jq -r '.entries[].tag' "$JOURNAL" | sort)

missing_in_journal=$(comm -23 <(echo "$sql_tags") <(echo "$journal_tags"))
missing_in_files=$(comm -13 <(echo "$sql_tags") <(echo "$journal_tags"))

ok=true

if [[ -n "$missing_in_journal" ]]; then
  echo "FAIL: .sql files without a matching journal entry (would silently NOT run in prod):"
  echo "$missing_in_journal" | sed 's/^/  - /'
  ok=false
fi

if [[ -n "$missing_in_files" ]]; then
  echo "FAIL: journal entries without a matching .sql file:"
  echo "$missing_in_files" | sed 's/^/  - /'
  ok=false
fi

# The latest journal entry (highest idx) must also hold the maximum
# 'when' value in the journal. drizzle's pg-core migrator iterates
# entries in idx order and silently skips any whose 'when' is <= the
# previously-applied row's created_at. As long as the highest-idx
# entry is also the largest 'when', drizzle will apply it. This is a
# permissive form of monotonicity that tolerates the historical
# bootstrap anomaly (idx=0 has a 2026 timestamp; idx=1..19 have 2025
# timestamps) but catches the case that bit PR #47: appending new
# entries with 'when' values <= an existing entry.
last_when=$(jq -r '.entries | sort_by(.idx) | last | .when' "$JOURNAL")
last_tag=$(jq -r '.entries | sort_by(.idx) | last | .tag' "$JOURNAL")
max_when=$(jq -r '[.entries[].when] | max' "$JOURNAL")

if [[ "$last_when" != "$max_when" ]]; then
  max_tag=$(jq -r --argjson mw "$max_when" '.entries | sort_by(.idx) | map(select(.when == $mw)) | last | .tag' "$JOURNAL")
  echo "FAIL: latest journal entry by idx is not the latest by 'when':"
  echo "  highest-idx entry: $last_tag (when=$last_when)"
  echo "  highest-when entry: $max_tag (when=$max_when)"
  echo
  echo "Drizzle's pg-core migrator silently skips any entry whose 'when' is <="
  echo "the previously-applied row's created_at. The highest-idx entry must"
  echo "therefore have the largest 'when' value, or it will never run in prod."
  ok=false
fi

if [[ "$ok" == "false" ]]; then
  echo
  echo "Fix: re-run 'pnpm --filter @legal/db generate' to regenerate the journal,"
  echo "     or hand-edit packages/db/drizzle/meta/_journal.json to add the missing"
  echo "     entries with strictly-greater 'when' values than the latest existing entry."
  exit 1
fi

sql_count=$(echo "$sql_tags" | grep -c '^' || true)
echo "OK: $sql_count migrations registered in journal, all monotonic"
