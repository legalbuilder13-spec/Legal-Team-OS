import { eq } from 'drizzle-orm';
import {
  matterDocuments,
  matterDocumentClauses,
  auditLog,
  jobs,
  type Db,
  type Job,
} from '@legal/db';
import { env } from '../env.js';

interface ParsePayload {
  document_id: string;
}

interface ParsedClauseDTO {
  ordinal: number;
  heading_path: string | null;
  clause_text: string;
  char_start: number;
  char_end: number;
  page_number: number | null;
}

interface ParseResponse {
  document_id: string;
  parser_version: string;
  clauses: ParsedClauseDTO[];
  page_count: number | null;
  char_count: number;
}

// Document parser worker. Downloads the original file from matter_documents,
// sends it base64-encoded to the AI service /parse-document endpoint, and
// writes the returned clause segments to matter_document_clauses. Parse
// status transitions: pending -> parsing -> parsed | failed.
export async function handleParseDocumentJob(db: Db, job: Job) {
  const payload = job.payload as unknown as ParsePayload;
  const doc = await db.query.matterDocuments.findFirst({
    where: eq(matterDocuments.id, payload.document_id),
  });
  if (!doc) {
    throw new Error(`document ${payload.document_id} not found`);
  }

  await db
    .update(matterDocuments)
    .set({ parseStatus: 'parsing' })
    .where(eq(matterDocuments.id, doc.id));

  try {
    const contentBase64 = Buffer.from(doc.content as Buffer).toString('base64');
    const res = await fetch(`${env.AI_SERVICE_URL}/parse-document`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN
          ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        document_id: doc.id,
        filename: doc.filename,
        mime_type: doc.mimeType,
        content_base64: contentBase64,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`parse failed: ${res.status} ${body.slice(0, 500)}`);
    }

    const parsed = (await res.json()) as ParseResponse;

    // Wipe + reinsert clauses. Idempotent re-parse.
    await db
      .delete(matterDocumentClauses)
      .where(eq(matterDocumentClauses.documentId, doc.id));

    if (parsed.clauses.length > 0) {
      await db.insert(matterDocumentClauses).values(
        parsed.clauses.map((c) => ({
          documentId: doc.id,
          ordinal: c.ordinal,
          headingPath: c.heading_path,
          clauseText: c.clause_text,
          charStart: c.char_start,
          charEnd: c.char_end,
          pageNumber: c.page_number,
        })),
      );
    }

    await db
      .update(matterDocuments)
      .set({
        parseStatus: 'parsed',
        parseError: null,
        parserVersion: parsed.parser_version,
        clauseCount: parsed.clauses.length,
        pageCount: parsed.page_count,
        charCount: parsed.char_count,
        parsedAt: new Date(),
      })
      .where(eq(matterDocuments.id, doc.id));

    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: doc.matterId,
      action: 'document.parsed',
      details: {
        documentId: doc.id,
        filename: doc.filename,
        clauseCount: parsed.clauses.length,
        pageCount: parsed.page_count,
        parserVersion: parsed.parser_version,
      },
    });

    // Auto-trigger Stage 4 analysis. The coordinator fans out per-clause
    // sub-jobs which each call the AI service for tagging.
    if (parsed.clauses.length > 0) {
      await db.insert(jobs).values({
        kind: 'analyze_document_clauses',
        matterId: doc.matterId,
        payload: { document_id: doc.id },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(matterDocuments)
      .set({ parseStatus: 'failed', parseError: message.slice(0, 1000) })
      .where(eq(matterDocuments.id, doc.id));
    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: doc.matterId,
      action: 'document.parse_failed',
      details: { documentId: doc.id, error: message.slice(0, 500) },
    });
    throw err;
  }
}
