import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import {
  matterAnalyses,
  matterAnalysisStages,
  matterAnalysisSources,
} from '@legal/db';
import { staffProcedure, router } from '../trpc.js';

// PRD §6 — read-only API for the matter detail page's Analysis panel.
// Returns the latest analysis run + its stages + source rows for any
// stage the lawyer expands. Tool invocation is in routers/tools.ts.

export const analysisRouter = router({
  forMatter: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const latest = await ctx.db
        .select()
        .from(matterAnalyses)
        .where(eq(matterAnalyses.matterId, input.matterId))
        .orderBy(desc(matterAnalyses.createdAt))
        .limit(1);

      const analysis = latest[0];
      if (!analysis) return null;

      const stages = await ctx.db
        .select()
        .from(matterAnalysisStages)
        .where(eq(matterAnalysisStages.analysisId, analysis.id))
        .orderBy(matterAnalysisStages.createdAt);

      return { analysis, stages };
    }),

  stageSources: staffProcedure
    .input(z.object({ stageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sources = await ctx.db
        .select()
        .from(matterAnalysisSources)
        .where(eq(matterAnalysisSources.stageId, input.stageId))
        .orderBy(matterAnalysisSources.createdAt);
      return sources;
    }),
});
