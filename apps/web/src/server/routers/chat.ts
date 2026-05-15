import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import {
  auditLog,
  chatMessages,
  entityLinks,
  knowledgeArticles,
} from '@legal/db';
import { PracticeAreaSchema } from '@legal/types';
import { protectedProcedure, staffProcedure, router } from '../trpc.js';
import { enqueueEmbedContent } from '../lib/embed-enqueue.js';

export const chatRouter = router({
  list: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.matterId, input.matterId))
        .orderBy(asc(chatMessages.createdAt));
    }),

  clear: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(chatMessages).where(eq(chatMessages.matterId, input.matterId));
    }),

  // PR #8 — Promote a successful chat exchange into a draft Knowledge
  // article. Closes the loop where the copilot's best answers are
  // currently buried in one matter's chat history; the next lawyer
  // with the same question re-asks from scratch.
  //
  // The new article is created with is_active=false (draft state)
  // so it doesn't immediately enter the triage prompt — admin
  // reviews it on /admin/knowledge before activating. An entity_link
  // (relationship='derived_from') connects the article to its source
  // matter for traceability.
  promoteToKnowledge: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        // The assistant message that contained the good answer. The
        // server will also pull the immediately-preceding user
        // message as the "question" context.
        chatMessageId: z.string().uuid(),
        title: z.string().min(3).max(120),
        body: z.string().min(50),
        practiceArea: PracticeAreaSchema,
        tags: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const message = await db.query.chatMessages.findFirst({
        where: eq(chatMessages.id, input.chatMessageId),
      });
      if (!message) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat message not found.' });
      }
      if (message.matterId !== input.matterId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Chat message does not belong to this matter.',
        });
      }
      if (message.role !== 'assistant') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only assistant messages can be promoted to Knowledge.',
        });
      }

      const [created] = await db
        .insert(knowledgeArticles)
        .values({
          practiceArea: input.practiceArea,
          title: input.title.trim(),
          body: input.body.trim(),
          tags: input.tags,
          isActive: false,
          createdById: ctx.user.id,
        })
        .returning();
      if (!created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create knowledge article.',
        });
      }

      // Cross-link to the source matter for traceability (relies on
      // the entity_links table from PR #2).
      try {
        await db.insert(entityLinks).values({
          sourceType: 'knowledge_article',
          sourceId: created.id,
          targetType: 'matter',
          targetId: input.matterId,
          relationship: 'derived_from',
          note: `Promoted from copilot chat message ${input.chatMessageId.slice(0, 8)}`,
          createdById: ctx.user.id,
        });
      } catch {
        // Link creation failure shouldn't block the article creation.
      }

      await db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'knowledge.promoted_from_chat',
        details: {
          chatMessageId: input.chatMessageId,
          knowledgeArticleId: created.id,
          title: input.title,
        },
      });

      // Embed the new article so it's findable in PR #3's global
      // search even before activation.
      await enqueueEmbedContent(db, 'knowledge_article', created.id);

      return { knowledgeArticleId: created.id };
    }),

  // List chat messages from this matter that have already been
  // promoted to Knowledge — used by the UI to show a "promoted" badge
  // on the corresponding chat bubble so we don't propose duplicating.
  promotedChatMessageIds: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ details: auditLog.details })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.matterId, input.matterId),
            eq(auditLog.action, 'knowledge.promoted_from_chat'),
          ),
        );
      const ids = new Set<string>();
      for (const r of rows) {
        const id = (r.details as Record<string, unknown> | null)?.['chatMessageId'];
        if (typeof id === 'string') ids.add(id);
      }
      return Array.from(ids);
    }),
});
