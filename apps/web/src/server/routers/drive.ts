import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { matters, matterEvents, auditLog } from '@legal/db';
import { staffProcedure, router } from '../trpc.js';
import {
  appendToDriveDocument,
  createDriveDocument,
  fetchDriveDocument,
  isGoogleDriveConfigured,
  searchDrive,
} from '../integrations/google-drive.js';

export const driveRouter = router({
  status: staffProcedure.query(() => ({ configured: isGoogleDriveConfigured() })),

  search: staffProcedure
    .input(z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => searchDrive(input.query, input.limit)),

  fetchDoc: staffProcedure
    .input(z.object({ fileId: z.string().min(8) }))
    .query(async ({ input }) => {
      const doc = await fetchDriveDocument(input.fileId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Doc not found or Drive not configured.' });
      return doc;
    }),

  saveMatterToDrive: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        appendToDocId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
        with: { notes: true, counterparty: true, requester: true, assignee: true },
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND' });

      const lines: string[] = [];
      lines.push(`Matter: ${matter.shortId} — ${matter.title}`);
      lines.push(
        `Status: ${matter.status}${matter.priority ? ` · ${matter.priority}` : ''}${
          matter.practiceArea ? ` · ${matter.practiceArea}` : ''
        }`,
      );
      if (matter.requester?.name) lines.push(`Requester: ${matter.requester.name}`);
      if (matter.assignee?.name) lines.push(`Assignee: ${matter.assignee.name}`);
      if (matter.counterparty?.name) lines.push(`Counterparty: ${matter.counterparty.name}`);
      lines.push('', 'Original Request:', matter.requestText);
      if (matter.summary) lines.push('', 'AI Summary:', matter.summary);
      if (matter.notes?.length) {
        lines.push('', 'Notes:');
        for (const n of matter.notes) lines.push(`- (${n.source}) ${n.body}`);
      }
      const body = lines.join('\n');

      let result: { id: string; webViewLink: string } | null = null;
      if (input.appendToDocId) {
        const ok = await appendToDriveDocument(input.appendToDocId, body);
        if (!ok) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Drive not configured.' });
        result = {
          id: input.appendToDocId,
          webViewLink: `https://docs.google.com/document/d/${input.appendToDocId}`,
        };
      } else {
        const title = input.title ?? `${matter.shortId} — ${matter.title}`;
        try {
          const created = await createDriveDocument({ title, body });
          if (!created) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Drive not configured.' });
          result = created;
        } catch (e) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message });
        }
      }

      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'drive.saved',
        payload: { fileId: result.id, url: result.webViewLink, appended: !!input.appendToDocId },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'drive.saved',
        details: { fileId: result.id, url: result.webViewLink, appended: !!input.appendToDocId },
      });
      return result;
    }),
});
