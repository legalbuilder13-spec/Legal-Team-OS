"""M3 / Item 8 — LLM-replay runner.

Reads an eval corpus produced by scripts/build-eval-corpus.ts and
replays each tuple against the current skill in-process. Each row's
skill_input is the structured request the worker actually sent; the
runner calls the matching skill function directly and compares the
new output to the gold (lawyer-accepted) output.

Per-stage handlers below cover the five skill-driven stage types:
pre_merits / guidance / statutory / case_law / deconstruct. Rows
without skill_input (pre-Item-8 stages) are skipped — they can't be
replayed without re-deriving the input from the matter tree, which
duplicates worker logic and risks drift.

This runner is manual/scheduled — NOT CI — because each replayed
tuple incurs LLM cost. The Pydantic-only schema check in
schema_check.py is what runs in CI.

Usage:
    python -m src.eval.replay eval/v1/ --out eval/results/
    python -m src.eval.replay eval/v1/ --out eval/results/ --limit 5
    python -m src.eval.replay eval/v1/ --stages statutory,case_law
"""

import argparse
import json
import logging
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from ..analysis_schemas import (
    GuidanceGraderRequest,
    GuidanceGraderResult,
    ThresholdSpotterRequest,
    ThresholdSpotterResult,
)
from ..case_law_research import (
    CaseLawRequest,
    CaseLawResult,
    research_case_law,
)
from ..deconstruct_draft import (
    DeconstructRequest,
    DeconstructResult,
    deconstruct_and_draft,
)
from ..guidance_grader import grade_guidance
from ..statute_analysis import (
    StatuteAnalysisRequest,
    StatuteAnalysisResult,
    analyze_statute,
)
from ..threshold_spotter import spot_thresholds

logger = logging.getLogger(__name__)


SkillFn = Callable[[Any], BaseModel]

# Per-stage replay configuration: how to build the request from
# skill_input, what skill to call, how to validate the gold output,
# and stage-specific metrics. New stages added in future M3 follow-ups
# extend this table.
STAGE_REPLAY: dict[str, dict[str, Any]] = {
    "pre_merits": {
        "request_cls": ThresholdSpotterRequest,
        "result_cls": ThresholdSpotterResult,
        "fn": spot_thresholds,
    },
    "guidance": {
        "request_cls": GuidanceGraderRequest,
        "result_cls": GuidanceGraderResult,
        "fn": grade_guidance,
    },
    "statutory": {
        "request_cls": StatuteAnalysisRequest,
        "result_cls": StatuteAnalysisResult,
        "fn": analyze_statute,
    },
    "case_law": {
        "request_cls": CaseLawRequest,
        "result_cls": CaseLawResult,
        "fn": research_case_law,
    },
    "deconstruct": {
        "request_cls": DeconstructRequest,
        "result_cls": DeconstructResult,
        "fn": deconstruct_and_draft,
    },
}


def compute_metrics(stage: str, gold: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Stage-specific structural comparisons between gold + new outputs.

    Deliberately narrow: each metric should be a binary that flips when
    the new run drifts from the lawyer-accepted gold. Semantic-similarity
    scoring (memo fields, citation set overlap) is a follow-up.
    """
    metrics: dict[str, Any] = {"parsed": True}

    if stage == "guidance":
        gold_parsed = GuidanceGraderResult.model_validate(gold)
        new_parsed = GuidanceGraderResult.model_validate(new)
        metrics["verdict_match"] = gold_parsed.verdict == new_parsed.verdict

    elif stage == "deconstruct":
        gold_band = (gold.get("memo") or {}).get("confidence_band")
        new_band = (new.get("memo") or {}).get("confidence_band")
        metrics["confidence_match"] = gold_band == new_band
        # Mirror-image present in both?
        gold_mirror = bool((gold.get("memo") or {}).get("mirror_image_argument"))
        new_mirror = bool((new.get("memo") or {}).get("mirror_image_argument"))
        metrics["mirror_image_match"] = gold_mirror == new_mirror

    elif stage == "statutory":
        # Compare the set of cited operative provisions.
        def _cites(out: dict[str, Any]) -> set[str]:
            return {
                str(p.get("citation"))
                for p in (out.get("operative_provisions") or [])
                if p.get("citation")
            }
        gold_set = _cites(gold)
        new_set = _cites(new)
        if gold_set:
            overlap = len(gold_set & new_set) / len(gold_set)
            metrics["operative_provision_recall"] = round(overlap, 3)

    elif stage == "case_law":
        def _auth(out: dict[str, Any]) -> set[str]:
            return {
                str(c.get("citation"))
                for c in (out.get("controlling_authority") or [])
                if c.get("citation")
            }
        gold_set = _auth(gold)
        new_set = _auth(new)
        if gold_set:
            overlap = len(gold_set & new_set) / len(gold_set)
            metrics["controlling_authority_recall"] = round(overlap, 3)

    elif stage == "pre_merits":
        # Per-finding status match across the threshold registry.
        def _statuses(out: dict[str, Any]) -> dict[str, str]:
            return {
                str(f.get("threshold_id")): str(f.get("status"))
                for f in (out.get("findings") or [])
                if f.get("threshold_id")
            }
        gold_map = _statuses(gold)
        new_map = _statuses(new)
        if gold_map:
            matches = sum(1 for k, v in gold_map.items() if new_map.get(k) == v)
            metrics["finding_status_agreement"] = round(matches / len(gold_map), 3)

    return metrics


def replay_one(
    stage: str,
    tuple_data: dict[str, Any],
) -> dict[str, Any] | None:
    """Replay a single corpus tuple. Returns None when un-replayable."""
    config = STAGE_REPLAY.get(stage)
    if config is None:
        return None

    skill_input = tuple_data.get("skill_input")
    if not skill_input:
        return None

    request_cls: type[BaseModel] = config["request_cls"]
    fn: SkillFn = config["fn"]
    gold = tuple_data.get("stage_output") or {}

    try:
        request = request_cls.model_validate(skill_input)
    except Exception as e:  # noqa: BLE001
        return {
            "stage": stage,
            "matter_id": tuple_data.get("matter_id"),
            "replayed": False,
            "error": f"request_validation: {type(e).__name__}: {e}",
        }

    try:
        new_result = fn(request)
        new_output = new_result.model_dump(mode="json")
    except Exception as e:  # noqa: BLE001
        return {
            "stage": stage,
            "matter_id": tuple_data.get("matter_id"),
            "replayed": False,
            "error": f"skill_call: {type(e).__name__}: {e}",
        }

    metrics = compute_metrics(stage, gold, new_output)
    return {
        "stage": stage,
        "matter_id": tuple_data.get("matter_id"),
        "replayed": True,
        "gold_output": gold,
        "new_output": new_output,
        "metrics": metrics,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus_dir", type=Path)
    parser.add_argument("--out", type=Path, default=Path("eval/results"))
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit per stage (0 = no limit)",
    )
    parser.add_argument(
        "--stages",
        type=str,
        default="",
        help="Comma-separated stage allowlist (default: all stages with replay support)",
    )
    args = parser.parse_args()

    if not args.corpus_dir.exists():
        print(f"corpus dir not found: {args.corpus_dir}")
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    allowlist = (
        {s.strip() for s in args.stages.split(",") if s.strip()}
        if args.stages
        else set(STAGE_REPLAY.keys())
    )

    overall_summary: dict[str, dict[str, Any]] = {}
    for path in sorted(args.corpus_dir.glob("*.jsonl")):
        stage = path.stem
        if stage not in allowlist:
            continue

        replayed = 0
        skipped_no_input = 0
        skill_errors = 0
        results_path = args.out / f"{stage}.results.jsonl"
        results_path.parent.mkdir(parents=True, exist_ok=True)
        with path.open() as in_f, results_path.open("w") as out_f:
            for line in in_f:
                line = line.strip()
                if not line:
                    continue
                tuple_data = json.loads(line)
                if args.limit and replayed >= args.limit:
                    break

                if not tuple_data.get("skill_input"):
                    skipped_no_input += 1
                    continue

                result = replay_one(stage, tuple_data)
                if result is None:
                    skipped_no_input += 1
                    continue
                if not result["replayed"]:
                    skill_errors += 1
                else:
                    replayed += 1
                out_f.write(json.dumps(result) + "\n")

        overall_summary[stage] = {
            "replayed": replayed,
            "skipped_no_input": skipped_no_input,
            "skill_errors": skill_errors,
            "results_path": str(results_path),
        }
        print(
            f"  {stage}: replayed={replayed} skipped_no_input={skipped_no_input} "
            f"errors={skill_errors}"
        )

    summary_path = args.out / "summary.json"
    summary_path.write_text(json.dumps(overall_summary, indent=2))
    print(f"\nwrote summary → {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
