import { eq, inArray } from 'drizzle-orm';
import {
  matterAnalysisStages,
  auditLog,
  playbooks,
  type Db,
  type Matter,
} from '@legal/db';
import {
  GuidanceStageOutputSchema,
  type AnalysisConfidence,
  type GuidanceCandidate,
  type GuidanceStageOutput,
} from '@legal/types';
import { env } from '../../env.js';
import { searchNotion, fetchNotionPageExcerpt } from '../../integrations/notion.js';
import { hashContent, recordSource } from './sources.js';

// PRD §7.5 / §7.3 — Stage 1 playbook / guidance check.
// Hardcoded: topical query construction, Notion retrieval, candidate
// dedup, source-row writes, verdict-band classification (no, the model
// does not pick the verdict — that is a hardcoded gate after grading).
// Skill: per-candidate on-point grading + (if matched) headline-answer
// synthesis.

interface GuidanceGraderRequest {
  matter_id: string;
  request_text: string;
  practice_area: string;
  candidates: Array<{
    source: 'notion_playbook' | 'notion_kb' | 'notion_saved_matter';
    title: string;
    url: string | null;
    notion_page_id: string | null;
    excerpt: string;
    retrieved_at: string;
  }>;
}

interface GuidanceGraderResult {
  matter_id: string;
  verdict: 'matched' | 'related_only' | 'no_hit';
  grades: Array<{
    candidate_index: number;
    on_point_score: number;
    jurisdiction_match: boolean;
    fact_pattern_overlap: number;
    age_concern: boolean;
    citation_anchor: string | null;
    one_line_rationale: string;
  }>;
  top_match_index: number | null;
  headline_answer: {
    summary: string;
    citation: string;
    source_url: string | null;
  } | null;
  notes_for_lawyer: string | null;
}

export interface Stage1Result {
  stageId: string;
  status: 'complete' | 'failed' | 'skipped';
  confidence: AnalysisConfidence;
  output: GuidanceStageOutput | { error: string };
  verdict: 'matched' | 'related_only' | 'no_hit' | 'skipped';
}

// M4 — canon-tier weighting. After the LLM grader returns on-point
// scores per candidate, we boost the score for candidates whose Notion
// page is registered as a higher-tier playbook in the `playbooks` table
// and re-pick the top match using the boosted scores. The verdict
// itself remains the LLM grader's call; only top_match_index is
// re-ranked. Boost values are deliberately conservative — a draft
// playbook with a high on-point score still beats a low-scoring
// industry-tier candidate. Tuned so a same-on-point-score tie always
// breaks toward the higher tier.
type CanonTier = 'draft' | 'org' | 'industry';
const TIER_BOOST: Record<CanonTier, number> = {
  industry: 0.15,
  org: 0.10,
  draft: 0,
};

async function fetchCanonTiers(
  db: Db,
  notionPageIds: string[],
): Promise<Map<string, CanonTier>> {
  if (notionPageIds.length === 0) return new Map();
  const rows = await db
    .select({
      notionPageId: playbooks.notionPageId,
      canonTier: playbooks.canonTier,
    })
    .from(playbooks)
    .where(inArray(playbooks.notionPageId, notionPageIds));
  const map = new Map<string, CanonTier>();
  for (const r of rows) {
    if (r.notionPageId) {
      map.set(r.notionPageId, r.canonTier as CanonTier);
    }
  }
  return map;
}

// Build topical search queries from triage output. The existing Notion
// integration searches by counterparty name; here we want guidance hits,
// so we query on the matter title + practice area key terms. Multiple
// queries widen recall; we dedup by Notion page id before grading.
function buildQueries(matter: Matter): string[] {
  const queries = new Set<string>();
  if (matter.title) queries.add(matter.title);
  if (matter.summary) {
    // First 12 words of summary — keeps the query tight without losing
    // domain terms.
    queries.add(matter.summary.split(/\s+/).slice(0, 12).join(' '));
  }
  if (matter.practiceArea) {
    // A practice-area-anchored query helps surface playbook entries even
    // when the title doesn't share vocabulary with the playbook headers.
    queries.add(`${matter.practiceArea} playbook`);
  }
  return Array.from(queries).filter((q) => q.length > 2);
}

interface RetrievedHit {
  pageId: string;
  title: string;
  url: string;
  lastEditedAt: string | null;
}

async function retrieveCandidates(apiKey: string, queries: string[]): Promise<RetrievedHit[]> {
  const hits = new Map<string, RetrievedHit>();
  for (const q of queries) {
    try {
      const results = await searchNotion(apiKey, q, 8);
      for (const r of results) {
        if (r.type !== 'page') continue;
        if (!hits.has(r.id)) {
          hits.set(r.id, {
            pageId: r.id,
            title: r.title,
            url: r.url,
            lastEditedAt: r.lastEditedAt,
          });
        }
      }
    } catch (err) {
      // A single failed query doesn't sink the stage — log and continue.
      console.warn('stage-1-guidance: Notion search failed', { query: q, err: String(err) });
    }
  }
  // Cap at 8 candidates per stage call to keep prompt size bounded.
  return Array.from(hits.values()).slice(0, 8);
}

export async function runStage1(
  db: Db,
  analysisId: string,
  matter: Matter,
): Promise<Stage1Result> {
  const queries = buildQueries(matter);
  const inputHash = hashContent(matter.id, JSON.stringify(queries));

  const [stage] = await db
    .insert(matterAnalysisStages)
    .values({
      analysisId,
      stageName: 'guidance',
      status: 'running',
      inputHash,
      model: 'claude-opus-4-7',
    })
    .returning({ id: matterAnalysisStages.id });
  const stageId = stage!.id;

  const startedAt = Date.now();

  // Without a Notion key the stage cannot run — skip gracefully so the
  // pipeline still completes; the lawyer just sees "no guidance retrieval
  // configured" instead of an error.
  if (!env.NOTION_API_KEY) {
    const skipped: GuidanceStageOutput = {
      verdict: 'no_hit',
      queriesRun: queries,
      grades: [],
      topMatch: null,
      headlineAnswer: null,
      notesForLawyer: 'Notion integration not configured; guidance check skipped.',
    };
    await db
      .update(matterAnalysisStages)
      .set({
        status: 'skipped',
        outputJson: skipped as unknown as Record<string, unknown>,
        confidence: 'N_A',
        durationMs: Date.now() - startedAt,
        auditNotes: 'NOTION_API_KEY not set',
      })
      .where(eq(matterAnalysisStages.id, stageId));
    return { stageId, status: 'skipped', confidence: 'N_A', output: skipped, verdict: 'no_hit' };
  }

  try {
    const hits = await retrieveCandidates(env.NOTION_API_KEY, queries);

    // Fetch excerpts in parallel; cap excerpt length per page.
    const candidates: GuidanceCandidate[] = await Promise.all(
      hits.map(async (h) => {
        let excerpt = '';
        try {
          excerpt = await fetchNotionPageExcerpt(env.NOTION_API_KEY!, h.pageId, 1500);
        } catch (err) {
          console.warn('stage-1-guidance: page excerpt fetch failed', {
            pageId: h.pageId,
            err: String(err),
          });
        }
        return {
          source: 'notion_kb',
          title: h.title,
          url: h.url,
          notionPageId: h.pageId,
          excerpt,
          retrievedAt: new Date().toISOString(),
        };
      }),
    );

    // Record each candidate as a source row up front so the trace shows
    // what was retrieved, regardless of whether the grader uses it.
    for (const c of candidates) {
      await recordSource(db, {
        stageId,
        sourceType: 'guidance',
        citation: c.title,
        url: c.url ?? undefined,
        rawExcerpt: c.excerpt,
      });
    }

    const skillRequest: GuidanceGraderRequest = {
      matter_id: matter.id,
      request_text: matter.requestText,
      practice_area: matter.practiceArea ?? 'other',
      candidates: candidates.map((c) => ({
        source: c.source,
        title: c.title,
        url: c.url ?? null,
        notion_page_id: c.notionPageId ?? null,
        excerpt: c.excerpt,
        retrieved_at: c.retrievedAt,
      })),
    };

    const res = await fetch(`${env.AI_SERVICE_URL}/guidance-grader`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(skillRequest),
    });
    if (!res.ok) {
      throw new Error(`guidance-grader ${res.status}: ${await res.text()}`);
    }
    const raw = (await res.json()) as GuidanceGraderResult;

    const grades = raw.grades.map((g) => ({
      candidate: candidates[g.candidate_index]!,
      onPointScore: g.on_point_score,
      jurisdictionMatch: g.jurisdiction_match,
      factPatternOverlap: g.fact_pattern_overlap,
      ageConcern: g.age_concern,
      citationAnchor: g.citation_anchor,
      oneLineRationale: g.one_line_rationale,
    }));

    // M4 — canon-tier weighting. Look up each candidate's playbook tier
    // (if any) and re-pick top_match using on_point_score + tier_boost.
    // Verdict stays as the LLM's call; only the surfaced top match
    // changes. When no candidate has a playbook entry (or when the
    // boost doesn't change the leader), the grader's pick is preserved.
    const candidateNotionPageIds = candidates
      .map((c) => c.notionPageId)
      .filter((id): id is string => Boolean(id));
    const tierMap = await fetchCanonTiers(db, candidateNotionPageIds);
    const candidateTiers: Array<CanonTier | null> = candidates.map((c) =>
      c.notionPageId ? (tierMap.get(c.notionPageId) ?? null) : null,
    );

    let effectiveTopIndex: number | null = raw.top_match_index;
    let tierBoostChangedTopMatch = false;
    if (raw.grades.length > 0) {
      let bestIdx = raw.grades[0]!.candidate_index;
      let bestScore =
        raw.grades[0]!.on_point_score +
        (candidateTiers[bestIdx] ? TIER_BOOST[candidateTiers[bestIdx]!] : 0);
      for (const g of raw.grades.slice(1)) {
        const tier = candidateTiers[g.candidate_index] ?? null;
        const boosted = g.on_point_score + (tier ? TIER_BOOST[tier] : 0);
        if (boosted > bestScore) {
          bestIdx = g.candidate_index;
          bestScore = boosted;
        }
      }
      tierBoostChangedTopMatch =
        raw.top_match_index !== null && bestIdx !== raw.top_match_index;
      // Only override the grader when the verdict says there's a match
      // worth surfacing. For related_only / no_hit, trust the grader's
      // top_match_index (which may be null).
      if (raw.verdict === 'matched') {
        effectiveTopIndex = bestIdx;
      }
    }

    const topGrade =
      effectiveTopIndex !== null
        ? grades.find(
            (g) => g.candidate.notionPageId === candidates[effectiveTopIndex!]?.notionPageId,
          ) ?? null
        : null;

    const output: GuidanceStageOutput = {
      verdict: raw.verdict,
      queriesRun: queries,
      grades,
      topMatch: topGrade,
      headlineAnswer: raw.headline_answer
        ? {
            summary: raw.headline_answer.summary,
            citation: raw.headline_answer.citation,
            sourceUrl: raw.headline_answer.source_url ?? undefined,
          }
        : null,
      notesForLawyer: raw.notes_for_lawyer ?? undefined,
    };
    GuidanceStageOutputSchema.parse(output);

    // Confidence: HIGH for a matched verdict (the headline answer
    // exists), MEDIUM for related_only, LOW for no_hit with empty grades.
    let confidence: AnalysisConfidence;
    switch (raw.verdict) {
      case 'matched':
        confidence = 'HIGH';
        break;
      case 'related_only':
        confidence = 'MEDIUM';
        break;
      case 'no_hit':
        confidence = grades.length === 0 ? 'LOW' : 'MEDIUM';
        break;
    }

    await db
      .update(matterAnalysisStages)
      .set({
        status: 'complete',
        outputJson: output as unknown as Record<string, unknown>,
        confidence,
        durationMs: Date.now() - startedAt,
        // Item 8 — capture skill request for eval-corpus replay.
        skillInputJson: skillRequest as unknown as Record<string, unknown>,
      })
      .where(eq(matterAnalysisStages.id, stageId));

    // M4 — record the matched candidate's notion_page_id so the
    // promote-playbooks cron can attribute matches to specific
    // playbooks. Only fires on matched verdicts; related_only / no_hit
    // emit nothing. Also records the tier signal + whether the tier
    // boost changed the top match relative to the grader's pick, so
    // the promotion telemetry can distinguish boost-driven matches
    // from LLM-only matches.
    if (raw.verdict === 'matched' && topGrade?.candidate.notionPageId) {
      const effectiveTier =
        effectiveTopIndex !== null ? candidateTiers[effectiveTopIndex] ?? null : null;
      await db.insert(auditLog).values({
        actorKind: 'system',
        matterId: matter.id,
        action: 'playbook.matched_in_guidance',
        details: {
          notion_page_id: topGrade.candidate.notionPageId,
          stage_id: stageId,
          on_point_score: topGrade.onPointScore,
          canon_tier: effectiveTier,
          grader_top_match_index: raw.top_match_index,
          tier_boost_changed_top_match: tierBoostChangedTopMatch,
        },
      });
    }

    return { stageId, status: 'complete', confidence, output, verdict: raw.verdict };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(matterAnalysisStages)
      .set({
        status: 'failed',
        outputJson: { error: msg } as Record<string, unknown>,
        confidence: 'LOW',
        durationMs: Date.now() - startedAt,
        auditNotes: msg.slice(0, 4000),
      })
      .where(eq(matterAnalysisStages.id, stageId));
    return {
      stageId,
      status: 'failed',
      confidence: 'LOW',
      output: { error: msg },
      verdict: 'no_hit',
    };
  }
}
