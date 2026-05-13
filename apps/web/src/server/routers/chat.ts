import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { chatMessages } from '@legal/db';
import { protectedProcedure, router } from '../trpc.js';

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
});
