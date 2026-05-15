import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  templates,
  clauseExtractions,
  type Db,
  type Job,
} from '@legal/db';
import { env } from '../env.js';

// PR #6 — Worker handler for extract_template_clauses jobs.
// Calls AI service /extract-template-clauses and writes one
// clause_extractions row per proposed clause, all sharing one
// extraction_run_id so a re-run on the same template can be
// distinguished from prior runs.
//
// Idempotent in the sense that re-running on the same template just
// creates a new run; prior pending proposals stay around (so accept/
// dismiss decisions aren't lost).

interface ExtractPayload {
  template_id: string;
}

interface AIServiceResponse {
  template_id: string;
  proposed_clauses: Array<{
    name: string;
    body: string;
    suggested_jurisdictions: string[];
    rationale: string;
  }>;
}

export async function handleExtractTemplateClausesJob(
  db: Db,
  job: Job,
): Promise<void> {
  const payload = job.payload as unknown as ExtractPayload;
  const templateId = payload.template_id;
  if (!templateId) {
    console.warn('extract_template_clauses: missing template_id in payload');
    return;
  }

  const template = await db.query.templates.findFirst({
    where: eq(templates.id, templateId),
  });
  if (!template) {
    console.warn(`extract_template_clauses: template ${templateId} not found`);
    return;
  }
  if (!template.body || template.body.trim().length < 200) {
    console.log(
      `extract_template_clauses: template ${templateId} body too short, skipping`,
    );
    return;
  }

  const res = await fetch(`${env.AI_SERVICE_URL}/extract-template-clauses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AI_SERVICE_TOKEN
        ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      template_id: templateId,
      template_name: template.name,
      practice_area: template.practiceArea,
      matter_type: template.matterType,
      body: template.body,
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `extract_template_clauses AI failed: ${res.status} ${errorBody.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as AIServiceResponse;
  const proposals = data.proposed_clauses ?? [];

  if (proposals.length === 0) {
    console.log(
      `extract_template_clauses: template ${templateId} produced 0 proposals (body didn't decompose cleanly)`,
    );
    return;
  }

  const runId = randomUUID();
  for (let i = 0; i < proposals.length; i += 1) {
    const p = proposals[i]!;
    await db.insert(clauseExtractions).values({
      sourceTemplateId: templateId,
      proposedName: p.name,
      proposedBody: p.body,
      proposedJurisdictions: p.suggested_jurisdictions ?? [],
      proposedPosition: i,
      rationale: p.rationale,
      extractionRunId: runId,
    });
  }

  console.log(
    `extract_template_clauses: template ${templateId} → ${proposals.length} proposals (run ${runId.slice(0, 8)})`,
  );
}
