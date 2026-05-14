"""M3 — Schema validation for eval corpus JSONL files.

Cheap CI gate: parses every corpus tuple against the current Pydantic
output schemas for its stage. Catches schema drift (renamed field,
new required field) without making any LLM calls.

This runs in CI on every apps/ai change. The full LLM-replay runner
(replay.py) is manual / scheduled because it incurs per-call cost.

Usage:
    python -m src.eval.schema_check eval/v1/
"""

import argparse
import json
import sys
from pathlib import Path

from pydantic import BaseModel

from ..analysis_schemas import GuidanceGraderResult, ThresholdSpotterResult
from ..case_law_research import CaseLawResult
from ..deconstruct_draft import DeconstructResult
from ..statute_analysis import StatuteAnalysisResult

# Map stage_name (DB enum) → expected Pydantic result schema. New
# stages added in future milestones extend this map.
STAGE_RESULT_SCHEMAS: dict[str, type[BaseModel]] = {
    "pre_merits": ThresholdSpotterResult,
    "guidance": GuidanceGraderResult,
    "statutory": StatuteAnalysisResult,
    "case_law": CaseLawResult,
    "deconstruct": DeconstructResult,
}


def check_file(path: Path) -> tuple[int, int, list[str]]:
    """Returns (parsed_ok, total, error_messages[])."""
    if not path.exists():
        return 0, 0, [f"missing: {path}"]
    stage = path.stem  # 'eval/v1/statutory.jsonl' → 'statutory'
    schema = STAGE_RESULT_SCHEMAS.get(stage)
    if schema is None:
        return 0, 0, [f"unknown stage '{stage}' in {path.name} (skipping)"]

    ok = 0
    total = 0
    errors: list[str] = []
    with path.open() as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                tuple_data = json.loads(line)
                output = tuple_data.get("stage_output") or {}
                schema.model_validate(output)
                ok += 1
            except Exception as e:  # noqa: BLE001
                errors.append(f"{path.name}:{line_no} — {type(e).__name__}: {e}")
    return ok, total, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus_dir", type=Path)
    parser.add_argument(
        "--max-failures",
        type=int,
        default=0,
        help="Exit non-zero if more than this many tuples fail schema validation",
    )
    args = parser.parse_args()

    if not args.corpus_dir.exists():
        # No corpus committed yet — this is fine on a fresh checkout,
        # exit cleanly so CI doesn't block on absence.
        print(f"eval corpus dir not found: {args.corpus_dir} (skipping)")
        return 0

    total_ok = 0
    total_seen = 0
    total_errors: list[str] = []
    for path in sorted(args.corpus_dir.glob("*.jsonl")):
        ok, total, errors = check_file(path)
        total_ok += ok
        total_seen += total
        total_errors.extend(errors)
        print(f"  {path.name}: {ok}/{total} parsed")

    failures = total_seen - total_ok
    print(
        f"\nEval schema check: {total_ok}/{total_seen} tuples parsed "
        f"({failures} failures; threshold={args.max_failures})"
    )
    for err in total_errors[:20]:
        print(f"  ! {err}")
    if len(total_errors) > 20:
        print(f"  ... and {len(total_errors) - 20} more errors")

    return 1 if failures > args.max_failures else 0


if __name__ == "__main__":
    sys.exit(main())
