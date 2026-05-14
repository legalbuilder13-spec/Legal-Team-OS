import { eq } from 'drizzle-orm';
import {
  matterAnalysisStages,
  auditLog,
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

    const topGrade =
      raw.top_match_index !== null
        ? grades.find((g) => g.candidate.notionPageId === candidates[raw.top_match_index!]?.notionPageId) ??
          null
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
      })
      .where(eq(matterAnalysisStages.id, stageId));

    // M4 — record the matched candidate's notion_page_id so the
    // promote-playbooks cron can attribute matches to specific
    // playbooks. Only fires on matched verdicts; related_only / no_hit
    // emit nothing.
    if (raw.verdict === 'matched' && topGrade?.candidate.notionPageId) {
      await db.insert(auditLog).values({
        actorKind: 'system',
        matterId: matter.id,
        action: 'playbook.matched_in_guidance',
        details: {
          notion_page_id: topGrade.candidate.notionPageId,
          stage_id: stageId,
          on_point_score: topGrade.onPointScore,
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
