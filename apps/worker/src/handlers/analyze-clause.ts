import { and, eq, sql } from 'drizzle-orm';
import {
  matters,
  matterDocumentClauses,
  playbookPositions,
  playbooks,
  clauseAnalyses,
  knowledgeArticles,
  auditLog,
  type Db,
  type Job,
} from '@legal/db';
import { env } from '../env.js';
import { evaluateCondition, type CompiledRule } from '../rule-evaluator.js';

interface AnalyzeClausePayload {
  clause_id: string;
  document_id: string;
  matter_id: string;
}

interface PlaybookPositionDTO {
  id: string;
  topic: string;
  trigger: string;
  standard_position: string;
  acceptable_range: string | null;
  flagged_conditions: string | null;
  suggested_redline: string | null;
  citation: string | null;
}

interface CitationDTO {
  source: 'playbook_position' | 'prior_matter' | 'knowledge_article';
  identifier: string;
  excerpt?: string | null;
}

interface AnalyzeResponse {
  clause_id: string;
  tag: 'STANDARD' | 'MODIFIED' | 'FLAGGED';
  selected_position_id: string | null;
  reasoning: string;
  suggested_redline: string | null;
  citations: CitationDTO[];
  model_version: string;
}

// Per-clause analysis. Calls AI service /analyze-clause with the clause
// text + relevant playbook positions (filtered by the matter's practice
// area). Upserts into clause_analyses via the (clause_id) unique
// constraint — idempotent re-analysis just replaces the row.
export async function handleAnalyzeClauseJob(db: Db, job: Job) {
  const payload = job.payload as unknown as AnalyzeClausePayload;

  const clause = await db.query.matterDocumentClauses.findFirst({
    where: eq(matterDocumentClauses.id, payload.clause_id),
  });
  if (!clause) throw new Error(`clause ${payload.clause_id} not found`);

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) throw new Error(`matter ${payload.matter_id} not found`);

  const allPositions = matter.practiceArea
    ? await db
        .select({
          id: playbookPositions.id,
          topic: playbookPositions.topic,
          trigger: playbookPositions.trigger,
          standardPosition: playbookPositions.standardPosition,
          acceptableRange: playbookPositions.acceptableRange,
          flaggedConditions: playbookPositions.flaggedConditions,
          suggestedRedline: playbookPositions.suggestedRedline,
          citation: playbookPositions.citation,
          compiledTrigger: playbookPositions.compiledTrigger,
        })
        .from(playbookPositions)
        .innerJoin(playbooks, eq(playbookPositions.playbookId, playbooks.id))
        .where(
          and(
            eq(playbookPositions.isActive, true),
            eq(playbooks.isActive, true),
            eq(playbooks.practiceArea, matter.practiceArea),
          ),
        )
    : [];

  // G4 pre-filter: if a position has a compiled trigger, evaluate it
  // against the clause text + heading_path. If it doesn't match, skip
  // the position before the LLM call — sharpens focus + saves tokens.
  // Positions without a compiled trigger pass through unchanged.
  const clauseCtx = {
    clause: {
      text: clause.clauseText,
      heading_path: clause.headingPath ?? '',
    },
  };
  const positions = allPositions.filter((p) => {
    const compiled = p.compiledTrigger as Record<string, unknown> | null;
    if (!compiled || !('when' in compiled)) return true; // not compiled → keep
    const rule = compiled as unknown as CompiledRule;
    if (rule.fallback_llm) return true; // compiler said LLM needed → keep
    const result = evaluateCondition(rule.when, clauseCtx);
    if (result.needs_llm) return true; // condition itself defers to LLM
    return result.matched;
  });

  const matterContext = [
    matter.title,
    matter.summary,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1500);

  const positionsPayload: PlaybookPositionDTO[] = positions.map((p) => ({
    id: p.id,
    topic: p.topic,
    trigger: p.trigger,
    standard_position: p.standardPosition,
    acceptable_range: p.acceptableRange,
    flagged_conditions: p.flaggedConditions,
    suggested_redline: p.suggestedRedline,
    citation: p.citation,
  }));

  // Prior similar matters — pull the top 3 by tsvector match on the
  // clause text against prior closed matters in the same practice area.
  // Once vectors are populated for both clauses and matters, this should
  // switch to cosine similarity over embeddings for tighter matches.
  const priorMattersResult = matter.practiceArea
    ? await db.execute(sql`
        SELECT short_id AS id, title, summary, practice_area
        FROM matters
        WHERE id != ${matter.id}
          AND status = 'closed'
          AND practice_area = ${matter.practiceArea}
          AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))
              @@ plainto_tsquery('english', ${clause.clauseText.slice(0, 300)})
        ORDER BY ts_rank(
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '')),
          plainto_tsquery('english', ${clause.clauseText.slice(0, 300)})
        ) DESC
        LIMIT 3
      `)
    : [];
  const priorMatters = (priorMattersResult as unknown as Array<{
    id: string;
    title: string;
    summary: string | null;
    practice_area: string | null;
  }>).map((m) => ({
    id: m.id,
    title: m.title,
    summary: m.summary,
    practice_area: m.practice_area,
    outcome: null,
  }));

  // Knowledge base articles — by practice area, active only, top 3 by
  // text relevance to the clause.
  const kbResult = matter.practiceArea
    ? await db.execute(sql`
        SELECT id::text AS id, title, body, tags
        FROM knowledge_articles
        WHERE is_active = true
          AND practice_area = ${matter.practiceArea}
          AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
              @@ plainto_tsquery('english', ${clause.clauseText.slice(0, 300)})
        ORDER BY ts_rank(
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')),
          plainto_tsquery('english', ${clause.clauseText.slice(0, 300)})
        ) DESC
        LIMIT 3
      `)
    : [];
  const knowledgeArticlesPayload = (kbResult as unknown as Array<{
    id: string;
    title: string;
    body: string;
    tags: string[] | null;
  }>).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    tags: a.tags ?? [],
  }));

  const res = await fetch(`${env.AI_SERVICE_URL}/analyze-clause`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AI_SERVICE_TOKEN
        ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      clause_id: clause.id,
      clause_text: clause.clauseText,
      heading_path: clause.headingPath,
      matter_context: matterContext,
      practice_area: matter.practiceArea,
      positions: positionsPayload,
      prior_matters: priorMatters,
      knowledge_articles: knowledgeArticlesPayload,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`analyze_clause failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const analysis = (await res.json()) as AnalyzeResponse;

  const citations = analysis.citations.map((c) => ({
    source: c.source,
    identifier: c.identifier,
    excerpt: c.excerpt ?? undefined,
  }));

  // Upsert on the unique clause_id constraint — idempotent re-runs.
  await db.execute(sql`
    INSERT INTO clause_analyses (
      clause_id, document_id, matter_id, playbook_position_id,
      tag, reasoning, suggested_redline, model_version, citations
    )
    VALUES (
      ${clause.id}, ${payload.document_id}, ${payload.matter_id},
      ${analysis.selected_position_id},
      ${analysis.tag}, ${analysis.reasoning},
      ${analysis.suggested_redline}, ${analysis.model_version},
      ${JSON.stringify(citations)}::jsonb
    )
    ON CONFLICT (clause_id) DO UPDATE SET
      playbook_position_id = EXCLUDED.playbook_position_id,
      tag = EXCLUDED.tag,
      reasoning = EXCLUDED.reasoning,
      suggested_redline = EXCLUDED.suggested_redline,
      model_version = EXCLUDED.model_version,
      citations = EXCLUDED.citations,
      attorney_decision = NULL,
      attorney_modified_redline = NULL,
      decided_by_id = NULL,
      decided_at = NULL,
      created_at = now()
  `);

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: payload.matter_id,
    action: 'clause.analyzed',
    details: {
      clauseId: clause.id,
      tag: analysis.tag,
      selectedPositionId: analysis.selected_position_id,
      modelVersion: analysis.model_version,
    },
  });
}
