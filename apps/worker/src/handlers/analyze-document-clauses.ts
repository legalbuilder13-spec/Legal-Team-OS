import { eq, and } from 'drizzle-orm';
import {
  matterDocuments,
  matterDocumentClauses,
  matters,
  playbookPositions,
  playbooks,
  auditLog,
  jobs,
  type Db,
  type Job,
} from '@legal/db';

interface AnalyzeDocPayload {
  document_id: string;
}

// Document-level coordinator. Reads the document's parsed clauses, picks
// the active playbook positions for the matter's practice area, and
// enqueues one analyze_clause sub-job per clause. The sub-handler does
// the LLM call per clause, allowing each to fail/retry independently.
export async function handleAnalyzeDocumentClausesJob(db: Db, job: Job) {
  const payload = job.payload as unknown as AnalyzeDocPayload;
  const doc = await db.query.matterDocuments.findFirst({
    where: eq(matterDocuments.id, payload.document_id),
  });
  if (!doc) {
    throw new Error(`document ${payload.document_id} not found`);
  }
  if (doc.parseStatus !== 'parsed') {
    console.log(
      `analyze_document_clauses: document ${doc.id} status=${doc.parseStatus}, skipping`,
    );
    return;
  }

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, doc.matterId),
  });
  if (!matter) {
    throw new Error(`matter ${doc.matterId} not found`);
  }

  const clauses = await db
    .select({ id: matterDocumentClauses.id })
    .from(matterDocumentClauses)
    .where(eq(matterDocumentClauses.documentId, doc.id));

  if (clauses.length === 0) {
    console.log(`analyze_document_clauses: document ${doc.id} has no clauses, skipping`);
    return;
  }

  for (const c of clauses) {
    await db.insert(jobs).values({
      kind: 'analyze_clause',
      matterId: matter.id,
      payload: { clause_id: c.id, document_id: doc.id, matter_id: matter.id },
    });
  }

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'document.analysis_started',
    details: { documentId: doc.id, clauseCount: clauses.length },
  });
}
