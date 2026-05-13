import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { counterparties, matters } from '@legal/db';
import { protectedProcedure, router } from '../trpc.js';

export const counterpartiesRouter = router({
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const cp = await ctx.db.query.counterparties.findFirst({
        where: eq(counterparties.id, input.id),
      });
      if (!cp) return null;

      const history = await ctx.db
        .select({
          id: matters.id,
          shortId: matters.shortId,
          title: matters.title,
          practiceArea: matters.practiceArea,
          priority: matters.priority,
          status: matters.status,
          createdAt: matters.createdAt,
          closedAt: matters.closedAt,
        })
        .from(matters)
        .where(eq(matters.counterpartyId, cp.id))
        .orderBy(desc(matters.createdAt))
        .limit(20);

      return { ...cp, history };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(counterparties).orderBy(counterparties.name);
  }),
});
