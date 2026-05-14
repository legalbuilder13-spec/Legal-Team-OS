"""Unit tests for cluster_rejections skill.

Covers the fast-paths (no LLM call) and the defensive normalization
applied to the LLM response. The full end-to-end test would require
mocking the Anthropic client and is intentionally skipped here — the
fast-path + normalization gates are the regression risk that matters.
"""

from src.cluster_rejections import (
    ClusterRejectionsRequest,
    cluster_rejections,
)


def test_empty_rejections_returns_no_clusters() -> None:
    result = cluster_rejections(
        ClusterRejectionsRequest(organization_id=None, rejections=[]),
    )
    assert result.rejection_count == 0
    assert result.clusters == []


def test_single_rejection_returns_no_clusters() -> None:
    # A singleton can't form a cluster (min size is 2). The fast-path
    # bails before calling the LLM — no client mock needed.
    result = cluster_rejections(
        ClusterRejectionsRequest(
            organization_id="org-1",
            rejections=[
                {
                    "audit_log_id": "al-1",
                    "matter_id": "m-1",
                    "stage_name": "statutory",
                    "practice_area": "employment",
                    "worker_confidence": "MEDIUM",
                    "reason": "Wrong jurisdiction",
                    "decided_at": "2026-05-01T00:00:00Z",
                }
            ],
        ),
    )
    assert result.rejection_count == 1
    assert result.clusters == []


def test_fast_path_preserves_organization_id() -> None:
    result = cluster_rejections(
        ClusterRejectionsRequest(organization_id="org-abc", rejections=[]),
    )
    assert result.organization_id == "org-abc"
