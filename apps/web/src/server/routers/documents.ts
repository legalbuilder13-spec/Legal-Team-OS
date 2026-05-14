import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  matterDocuments,
  matterDocumentClauses,
  clauseAnalyses,
  playbookPositions,
  jobs,
  auditLog,
} from '@legal/db';
import { protectedProcedure, staffProcedure, router } from '../trpc.js';

// Document size cap. PRD's worst-case is a 30-page contract (~150KB);
// 25MB gives plenty of headroom for redlined deals with embedded images.
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);

export const documentsRouter = router({
  upload: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        filename: z.string().min(1).max(255),
        mimeType: z.string().min(1),
        // base64-encoded file contents. Client encodes via FileReader.
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
        throw new Error(
          `Unsupported file type: ${input.mimeType}. Only .docx and .pdf supported in v2.`,
        );
      }
      const content = Buffer.from(input.contentBase64, 'base64');
      if (content.length === 0) {
        throw new Error('Empty file content');
      }
      if (content.length > MAX_BYTES) {
        throw new Error(`File too large: ${content.length} bytes (limit ${MAX_BYTES})`);
      }

      const [created] = await ctx.db
        .insert(matterDocuments)
        .values({
          matterId: input.matterId,
          uploadedById: ctx.user.id,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: content.length,
          content,
        })
        .returning();
      if (!created) throw new Error('document insert failed');

      // Enqueue the parse job. Worker picks it up on next poll.
      await ctx.db.insert(jobs).values({
        kind: 'parse_document',
        matterId: input.matterId,
        payload: { document_id: created.id },
      });

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'document.uploaded',
        details: {
          documentId: created.id,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: content.length,
        },
      });

      return {
        id: created.id,
        filename: created.filename,
        sizeBytes: created.sizeBytes,
        parseStatus: created.parseStatus,
      };
    }),

  listForMatter: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: matterDocuments.id,
          filename: matterDocuments.filename,
          mimeType: matterDocuments.mimeType,
          sizeBytes: matterDocuments.sizeBytes,
          parseStatus: matterDocuments.parseStatus,
          parseError: matterDocuments.parseError,
          clauseCount: matterDocuments.clauseCount,
          pageCount: matterDocuments.pageCount,
          charCount: matterDocuments.charCount,
          createdAt: matterDocuments.createdAt,
          parsedAt: matterDocuments.parsedAt,
        })
        .from(matterDocuments)
        .where(eq(matterDocuments.matterId, input.matterId))
        .orderBy(desc(matterDocuments.createdAt));
    }),

  listClauses: staffProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(matterDocumentClauses)
        .where(eq(matterDocumentClauses.documentId, input.documentId))
        .orderBy(asc(matterDocumentClauses.ordinal));
    }),

  // Clauses + their analyses joined together. Powers E4 review UI.
  listClausesWithAnalysis: staffProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          clauseId: matterDocumentClauses.id,
          ordinal: matterDocumentClauses.ordinal,
          headingPath: matterDocumentClauses.headingPath,
          clauseText: matterDocumentClauses.clauseText,
          pageNumber: matterDocumentClauses.pageNumber,
          analysisId: clauseAnalyses.id,
          tag: clauseAnalyses.tag,
          reasoning: clauseAnalyses.reasoning,
          suggestedRedline: clauseAnalyses.suggestedRedline,
          attorneyDecision: clauseAnalyses.attorneyDecision,
          attorneyModifiedRedline: clauseAnalyses.attorneyModifiedRedline,
          decidedAt: clauseAnalyses.decidedAt,
          citations: clauseAnalyses.citations,
          positionTopic: playbookPositions.topic,
          positionId: playbookPositions.id,
        })
        .from(matterDocumentClauses)
        .leftJoin(
          clauseAnalyses,
          eq(clauseAnalyses.clauseId, matterDocumentClauses.id),
        )
        .leftJoin(
          playbookPositions,
          eq(playbookPositions.id, clauseAnalyses.playbookPositionId),
        )
        .where(eq(matterDocumentClauses.documentId, input.documentId))
        .orderBy(asc(matterDocumentClauses.ordinal));
      return rows;
    }),

  // Re-trigger analysis for an already-parsed document. Used when
  // playbook positions change and existing analyses are stale.
  reanalyze: staffProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.query.matterDocuments.findFirst({
        where: eq(matterDocuments.id, input.documentId),
      });
      if (!doc) throw new Error('document not found');
      if (doc.parseStatus !== 'parsed') {
        throw new Error(`cannot analyze: parse_status=${doc.parseStatus}`);
      }
      await ctx.db.insert(jobs).values({
        kind: 'analyze_document_clauses',
        matterId: doc.matterId,
        payload: { document_id: doc.id },
      });
      return { enqueued: true };
    }),

  // Attorney decision on an analyzed clause. Per PRD §8.2.2:
  //   APPROVED — AI analysis accepted as-is
  //   MODIFIED — attorney edits the redline (capture the new text)
  //   FLAGGED  — needs further action (escalation, requester chat)
  decideClause: staffProcedure
    .input(
      z.object({
        analysisId: z.string().uuid(),
        decision: z.enum(['APPROVED', 'MODIFIED', 'FLAGGED']),
        modifiedRedline: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.clauseAnalyses.findFirst({
        where: eq(clauseAnalyses.id, input.analysisId),
      });
      if (!existing) throw new Error('analysis not found');

      await ctx.db
        .update(clauseAnalyses)
        .set({
          attorneyDecision: input.decision,
          attorneyModifiedRedline:
            input.decision === 'MODIFIED' ? (input.modifiedRedline ?? null) : null,
          decidedById: ctx.user.id,
          decidedAt: new Date(),
        })
        .where(eq(clauseAnalyses.id, input.analysisId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: existing.matterId,
        action: 'clause.decided',
        details: {
          analysisId: input.analysisId,
          clauseId: existing.clauseId,
          decision: input.decision,
          aiTag: existing.tag,
        },
      });

      return { decided: true };
    }),

  // Re-parse with the current parser version. Useful when the parser is
  // updated and we want existing documents to reflect the new logic.
  reparse: staffProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.query.matterDocuments.findFirst({
        where: eq(matterDocuments.id, input.documentId),
      });
      if (!doc) throw new Error('document not found');

      await ctx.db
        .update(matterDocuments)
        .set({ parseStatus: 'pending', parseError: null })
        .where(eq(matterDocuments.id, doc.id));

      await ctx.db.insert(jobs).values({
        kind: 'parse_document',
        matterId: doc.matterId,
        payload: { document_id: doc.id },
      });

      return { enqueued: true };
    }),
});
