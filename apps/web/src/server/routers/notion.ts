import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { matters, matterEvents, auditLog } from '@legal/db';
import { staffProcedure, router } from '../trpc.js';
import {
  appendToNotionPage,
  createNotionPage,
  fetchNotionPage,
  getNotion,
  searchNotion,
} from '../integrations/notion.js';

export const notionRouter = router({
  status: staffProcedure.query(() => {
    return { configured: getNotion() !== null };
  }),

  search: staffProcedure
    .input(z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).default(10) }))
    .query(async ({ input }) => {
      return searchNotion(input.query, input.limit);
    }),

  fetchPage: staffProcedure
    .input(z.object({ pageId: z.string().min(8) }))
    .query(async ({ input }) => {
      const page = await fetchNotionPage(input.pageId);
      if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Page not found or Notion not configured.' });
      return page;
    }),

  saveMatterToNotion: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        appendToPageId: z.string().optional(),
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
      lines.push('');
      lines.push('Original Request:');
      lines.push(matter.requestText);
      if (matter.summary) {
        lines.push('');
        lines.push('AI Summary:');
        lines.push(matter.summary);
      }
      if (matter.notes && matter.notes.length > 0) {
        lines.push('');
        lines.push('Notes:');
        for (const n of matter.notes) {
          lines.push(`- (${n.source}) ${n.body}`);
        }
      }
      const body = lines.join('\n');

      let result: { id: string; url: string } | null = null;
      if (input.appendToPageId) {
        const ok = await appendToNotionPage(input.appendToPageId, body);
        if (!ok) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Notion not configured.' });
        }
        result = {
          id: input.appendToPageId,
          url: `https://www.notion.so/${input.appendToPageId.replace(/-/g, '')}`,
        };
      } else {
        const title = input.title ?? `${matter.shortId} — ${matter.title}`;
        try {
          const created = await createNotionPage({ title, body });
          if (!created) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Notion not configured.' });
          }
          result = created;
        } catch (e) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message });
        }
      }

      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'notion.saved',
        payload: { pageId: result.id, url: result.url, appended: !!input.appendToPageId },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'notion.saved',
        details: { pageId: result.id, url: result.url, appended: !!input.appendToPageId },
      });
      return result;
    }),
});
