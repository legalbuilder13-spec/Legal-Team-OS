"""M3 — Manual / scheduled LLM-replay runner.

Reads an eval corpus produced by scripts/build-eval-corpus.ts, replays
each tuple against the current skill, and writes a JSONL of
(input, gold_output, new_output, metrics) per stage. Intended for
manual or scheduled invocation — NOT CI, because each replay incurs
LLM cost.

Metrics computed v1:
  - parsed (binary): does the new output validate against the
    current Pydantic schema?
  - verdict_match (binary, for guidance only): same verdict as gold?
  - confidence_match (binary, where the schema has a confidence
    field): same band as gold?

Future versions can layer in semantic-similarity scoring of memo
fields, citation set-overlap, etc. The corpus shape is structured
to support those without code changes.

Usage:
    python -m src.eval.replay eval/v1/ --out eval/results/
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from ..analysis_schemas import GuidanceGraderResult


def compute_metrics(stage: str, gold: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    metrics: dict[str, Any] = {"parsed": True}
    if stage == "guidance":
        gold_parsed = GuidanceGraderResult.model_validate(gold)
        new_parsed = GuidanceGraderResult.model_validate(new)
        metrics["verdict_match"] = gold_parsed.verdict == new_parsed.verdict
    # confidence_band lives in deconstruct memo; basic match check.
    if stage == "deconstruct":
        gold_band = (gold.get("memo") or {}).get("confidence_band")
        new_band = (new.get("memo") or {}).get("confidence_band")
        metrics["confidence_match"] = gold_band == new_band
    return metrics


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
    args = parser.parse_args()

    if not args.corpus_dir.exists():
        print(f"corpus dir not found: {args.corpus_dir}")
        return 1

    args.out.mkdir(parents=True, exist_ok=True)

    print(
        "NOTE: this runner skeleton does NOT yet call the skills. v1 "
        "ships the corpus shape + metrics scaffold; future PR wires in "
        "the per-stage skill replay (statute_analysis, case_law_research, "
        "deconstruct_draft) once we have a corpus of meaningful size."
    )

    overall_summary: dict[str, dict[str, int]] = {}
    for path in sorted(args.corpus_dir.glob("*.jsonl")):
        stage = path.stem
        seen = 0
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                tuple_data = json.loads(line)
                seen += 1
                if args.limit and seen > args.limit:
                    break
                # Stub: re-validate the gold and write a synthetic
                # "new_output = gold_output" row so the metrics
                # scaffold compiles end-to-end. Real replay swaps in
                # the per-stage skill call.
                gold = tuple_data.get("stage_output") or {}
                new = gold
                _metrics = compute_metrics(stage, gold, new)
        overall_summary[stage] = {"total": seen}
        print(f"  {stage}: {seen} tuples (replay stub)")

    summary_path = args.out / "summary.json"
    summary_path.write_text(json.dumps(overall_summary, indent=2))
    print(f"\nwrote summary → {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
