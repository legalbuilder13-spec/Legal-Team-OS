"""Unit tests for compact_matter skill fast-paths."""

from src.compact_matter import (
    CompactMatterRequest,
    compact_matter,
)


def test_no_stages_returns_synthetic_summary() -> None:
    # No stages = no LLM call. The skill returns a thin synthetic
    # summary derived from the request text so the matter still has
    # a retrievable artifact.
    result = compact_matter(
        CompactMatterRequest(
            matter_id="m-1",
            title="Question about NDA term length",
            request_text="Counterparty wants 7-year term; our default is 3 years.",
            stages=[],
            sources=[],
        ),
    )
    assert result.matter_id == "m-1"
    assert "NDA term length" in result.headline
    assert "Issue" in result.summary_md
    assert "Counterparty wants 7-year term" in result.summary_md
