import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, detectedConflicts, jobs } from '@legal/db';
import { adminProcedure, router } from '../trpc.js';

// PR #7 / M8 — Conflict queue admin endpoints.
// - list: filter by status (active by default)
// - dismiss: not a real conflict — won't re-fire because of the
//   unique-on-active partial index
// - resolve: actual fix landed (e.g. archived one of the duplicates)
// - runNow: enqueue a fresh detection cycle without waiting for the
//   weekly Sunday cron

export const conflictsRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          status: z
            .enum(['active', 'dismissed', 'resolved'])
            .default('active'),
        })
        .default({ status: 'active' }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(detectedConflicts)
        .where(eq(detectedConflicts.status, input.status))
        .orderBy(
          desc(detectedConflicts.severity),
          desc(detectedConflicts.createdAt),
        )
        .limit(200);
    }),

  dismiss: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.detectedConflicts.findFirst({
        where: eq(detectedConflicts.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conflict not found.' });
      }
      await ctx.db
        .update(detectedConflicts)
        .set({
          status: 'dismissed',
          resolvedById: ctx.user.id,
          resolvedAt: new Date(),
          resolutionNote: input.reason ?? null,
        })
        .where(eq(detectedConflicts.id, input.id));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'conflict.dismissed',
        details: { id: input.id, kind: existing.kind, reason: input.reason },
      });
      return { dismissed: true };
    }),

  resolve: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        resolutionNote: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.detectedConflicts.findFirst({
        where: eq(detectedConflicts.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conflict not found.' });
      }
      await ctx.db
        .update(detectedConflicts)
        .set({
          status: 'resolved',
          resolvedById: ctx.user.id,
          resolvedAt: new Date(),
          resolutionNote: input.resolutionNote,
        })
        .where(eq(detectedConflicts.id, input.id));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'conflict.resolved',
        details: {
          id: input.id,
          kind: existing.kind,
          note: input.resolutionNote,
        },
      });
      return { resolved: true };
    }),

  runNow: adminProcedure.mutation(async ({ ctx }) => {
    await ctx.db.insert(jobs).values({
      kind: 'detect_conflicts',
      payload: {},
    });
    await ctx.db.insert(auditLog).values({
      actorId: ctx.user.id,
      action: 'conflict.detection_enqueued',
      details: {},
    });
    return { enqueued: true };
  }),
});
