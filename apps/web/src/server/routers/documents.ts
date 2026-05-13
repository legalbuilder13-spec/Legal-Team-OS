import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  matterDocuments,
  matterDocumentClauses,
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
