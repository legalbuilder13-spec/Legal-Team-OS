import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { escalations, matters, users, auditLog, matterEvents } from '@legal/db';
import { protectedProcedure, staffProcedure, router } from '../trpc.js';

const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
const StatusSchema = z.enum(['open', 'resolved']);

export const escalationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: StatusSchema.optional(),
          matterId: z.string().uuid().optional(),
          mineOnly: z.boolean().default(false),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.status) conditions.push(eq(escalations.status, input.status));
      if (input.matterId) conditions.push(eq(escalations.matterId, input.matterId));
      if (input.mineOnly) conditions.push(eq(matters.assigneeId, ctx.user.id));

      return ctx.db
        .select({
          id: escalations.id,
          matterId: escalations.matterId,
          matterShortId: matters.shortId,
          matterTitle: matters.title,
          matterAssigneeName: users.name,
          kind: escalations.kind,
          severity: escalations.severity,
          status: escalations.status,
          title: escalations.title,
          body: escalations.body,
          createdAt: escalations.createdAt,
          createdByKind: escalations.createdByKind,
          triggerRule: escalations.triggerRule,
        })
        .from(escalations)
        .innerJoin(matters, eq(escalations.matterId, matters.id))
        .leftJoin(users, eq(matters.assigneeId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(escalations.createdAt))
        .limit(input.limit);
    }),

  openCount: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(escalations)
      .where(eq(escalations.status, 'open'));
    return rows[0]?.count ?? 0;
  }),

  create: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        kind: z.string().min(1).max(64),
        severity: SeveritySchema.default('medium'),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(5000),
        triggerRule: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
        columns: { id: true },
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'matter not found' });

      const [created] = await ctx.db
        .insert(escalations)
        .values({
          matterId: input.matterId,
          kind: input.kind,
          severity: input.severity,
          title: input.title,
          body: input.body,
          triggerRule: input.triggerRule,
          createdByKind: 'user',
          createdById: ctx.user.id,
        })
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'escalation.created',
        payload: { escalationId: created?.id, severity: input.severity, kind: input.kind },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'escalation.created',
        details: { escalationId: created?.id, severity: input.severity, kind: input.kind },
      });
      return created;
    }),

  resolve: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        resolutionNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.escalations.findFirst({
        where: eq(escalations.id, input.id),
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      // Idempotent: already resolved → return without overwriting actor/time/note.
      if (existing.status === 'resolved') return existing;
      const [updated] = await ctx.db
        .update(escalations)
        .set({
          status: 'resolved',
          resolvedById: ctx.user.id,
          resolvedAt: new Date(),
          resolutionNote: input.resolutionNote,
        })
        .where(eq(escalations.id, input.id))
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: existing.matterId,
        actorId: ctx.user.id,
        kind: 'escalation.resolved',
        payload: { escalationId: input.id, note: input.resolutionNote },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: existing.matterId,
        action: 'escalation.resolved',
        details: { escalationId: input.id, note: input.resolutionNote },
      });
      return updated;
    }),
});
