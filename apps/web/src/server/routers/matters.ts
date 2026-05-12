import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { matters, matterNotes, matterEvents, users, auditLog, jobs } from '@legal/db';
import { MatterStatusSchema, PracticeAreaSchema, PrioritySchema } from '@legal/types';
import { protectedProcedure, staffProcedure, router } from '../trpc.js';
import { TRPCError } from '@trpc/server';

const ListInput = z
  .object({
    status: MatterStatusSchema.optional(),
    practiceArea: PracticeAreaSchema.optional(),
    assigneeId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .default({});

const STATUS_LABEL: Record<string, string> = {
  open: 'open',
  in_review: 'in review',
  waiting_on_requester: 'waiting on requester',
  waiting_on_third_party: 'waiting on third party',
  closed: 'closed',
  cancelled: 'cancelled',
};

export const mattersRouter = router({
  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    const conditions = [];
    if (input.status) conditions.push(eq(matters.status, input.status));
    if (input.practiceArea) conditions.push(eq(matters.practiceArea, input.practiceArea));
    if (input.assigneeId) conditions.push(eq(matters.assigneeId, input.assigneeId));

    return ctx.db
      .select({
        id: matters.id,
        shortId: matters.shortId,
        title: matters.title,
        status: matters.status,
        priority: matters.priority,
        practiceArea: matters.practiceArea,
        assigneeId: matters.assigneeId,
        assigneeName: users.name,
        slaDueAt: matters.slaDueAt,
        createdAt: matters.createdAt,
      })
      .from(matters)
      .leftJoin(users, eq(matters.assigneeId, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(matters.createdAt))
      .limit(input.limit);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.id),
        with: {
          requester: true,
          assignee: true,
          counterparty: true,
          notes: { orderBy: [desc(matterNotes.createdAt)] },
          events: { orderBy: [desc(matterEvents.createdAt)], limit: 50 },
          attachments: true,
        },
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND' });
      return matter;
    }),

  addNote: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), body: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [note] = await ctx.db
        .insert(matterNotes)
        .values({
          matterId: input.matterId,
          body: input.body,
          authorId: ctx.user.id,
          source: 'web',
        })
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'note.added',
        payload: { noteId: note?.id, source: 'web' },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'note.added',
        details: { noteId: note?.id },
      });
      return note;
    }),

  setStatus: staffProcedure
    .input(z.object({ matterId: z.string().uuid(), status: MatterStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      const closedAt = input.status === 'closed' ? new Date() : null;
      const [updated] = await ctx.db
        .update(matters)
        .set({
          status: input.status,
          closedAt,
          updatedAt: new Date(),
        })
        .where(eq(matters.id, input.matterId))
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'status.changed',
        payload: { status: input.status },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'matter.status_changed',
        details: { status: input.status },
      });
      if (updated?.slackChannelId) {
        await ctx.db.insert(jobs).values({
          kind: 'slack_notify',
          matterId: updated.id,
          payload: {
            matter_id: updated.id,
            text: `Status changed to *${STATUS_LABEL[input.status] ?? input.status}* by ${ctx.user.name}.`,
          },
        });
      }
      return updated;
    }),

  assign: staffProcedure
    .input(z.object({ matterId: z.string().uuid(), assigneeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(matters)
        .set({ assigneeId: input.assigneeId, updatedAt: new Date() })
        .where(eq(matters.id, input.matterId))
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'assigned',
        payload: { assigneeId: input.assigneeId },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'matter.assigned',
        details: { assigneeId: input.assigneeId },
      });
      return updated;
    }),

  myQueue: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(matters)
      .where(
        and(
          eq(matters.assigneeId, ctx.user.id),
          sql`${matters.status} not in ('closed', 'cancelled')`,
        ),
      )
      .orderBy(desc(matters.createdAt));
  }),
});
