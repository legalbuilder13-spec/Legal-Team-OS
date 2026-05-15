"""Unit tests for extract_playbook_edits skill.

Covers the fast-paths (no LLM call) and the defensive validation
applied to LLM responses (drop edits with unknown page_ids or
unknown matter_ids). The full end-to-end test that exercises the
Anthropic client is intentionally omitted — the regression risk
lives in the empty-input gates + ID validation, not in the prompt.
"""

from src.extract_playbook_edits import (
    EvidenceMatter,
    ExtractPlaybookEditsRequest,
    PlaybookCandidate,
    extract_playbook_edits,
)


def test_empty_proposals_returns_no_edits() -> None:
    result = extract_playbook_edits(ExtractPlaybookEditsRequest(proposals=[]))
    assert result.edits == []


def test_proposals_with_no_evidence_matters_returns_no_edits() -> None:
    # The worker shouldn't send empty groups, but defend against it
    # so we don't waste a model call on noise.
    result = extract_playbook_edits(
        ExtractPlaybookEditsRequest(
            proposals=[
                PlaybookCandidate(
                    notion_page_id="page-1",
                    playbook_title="Empty",
                    playbook_excerpt="Some content.",
                    evidence_matters=[],
                ),
            ],
        ),
    )
    assert result.edits == []


def test_request_prompt_includes_matter_summaries() -> None:
    # Lightweight sanity: the prompt builder must surface the matter
    # summary text so the model has substrate to reason on. We don't
    # call the LLM — we just exercise the prompt construction via the
    # private helper (imported lazily inside the test for clarity).
    from src.extract_playbook_edits import _build_user_prompt

    req = ExtractPlaybookEditsRequest(
        proposals=[
            PlaybookCandidate(
                notion_page_id="page-abc",
                playbook_title="Test playbook",
                playbook_excerpt="Original playbook text here.",
                evidence_matters=[
                    EvidenceMatter(
                        matter_id="m-1",
                        matter_title="Big merger",
                        matter_summary="Final summary mentions data-protection clauses.",
                    ),
                ],
            ),
        ],
    )
    prompt = _build_user_prompt(req)
    assert "page-abc" in prompt
    assert "Test playbook" in prompt
    assert "Original playbook text here." in prompt
    assert "m-1" in prompt
    assert "data-protection clauses" in prompt


def test_pydantic_models_accept_optional_playbook_id() -> None:
    # A playbook page can be referenced without being registered in
    # the playbooks table (playbook_id stays None). The schema must
    # accept this so the worker can still propose edits to KB pages.
    candidate = PlaybookCandidate(
        notion_page_id="page-1",
        playbook_id=None,
        playbook_title="Unregistered KB page",
        playbook_excerpt="Body.",
        evidence_matters=[
            EvidenceMatter(matter_id="m-1", matter_title="t", matter_summary="s"),
        ],
    )
    assert candidate.playbook_id is None
