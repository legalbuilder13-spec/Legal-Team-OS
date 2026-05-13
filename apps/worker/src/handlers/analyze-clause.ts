import { and, eq, sql } from 'drizzle-orm';
import {
  matters,
  matterDocumentClauses,
  playbookPositions,
  playbooks,
  clauseAnalyses,
  auditLog,
  type Db,
  type Job,
} from '@legal/db';
import { env } from '../env.js';

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

  const positions = matter.practiceArea
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
