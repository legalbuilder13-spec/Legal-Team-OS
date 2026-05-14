import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  matterAnalyses,
  matterAnalysisStages,
  matterAnalysisSources,
  auditLog,
} from '@legal/db';
import { staffProcedure, router } from '../trpc.js';

// PRD §6 — read-only API for the matter detail page's Analysis panel.
// Returns the latest analysis run + its stages + source rows for any
// stage the lawyer expands. Tool invocation is in routers/tools.ts.
// PR10 adds the overrideStage mutation for accept/reject controls.

const StageDecisionInput = z.object({
  stageId: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected', 'escalated']),
  reason: z.string().max(2000).optional(),
});

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

  // PR10 — accept/reject. Required when:
  //   - decision='rejected'  → reason mandatory (feeds eval set)
  //   - decision='escalated' → reason mandatory (tells senior reviewer
  //                            what's wrong)
  // 'accepted' may omit reason. Emits a structured audit_log row so
  // tool-suggestion intelligence (PR8) can use real acceptance data
  // instead of the tool.*_complete proxy.
  overrideStage: staffProcedure
    .input(StageDecisionInput)
    .mutation(async ({ ctx, input }) => {
      if ((input.decision === 'rejected' || input.decision === 'escalated') && !input.reason?.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A reason is required when rejecting or escalating a stage.',
        });
      }
      const stage = await ctx.db.query.matterAnalysisStages.findFirst({
        where: eq(matterAnalysisStages.id, input.stageId),
      });
      if (!stage) throw new TRPCError({ code: 'NOT_FOUND' });

      const analysis = await ctx.db.query.matterAnalyses.findFirst({
        where: eq(matterAnalyses.id, stage.analysisId),
      });
      const matterId = analysis?.matterId;

      await ctx.db
        .update(matterAnalysisStages)
        .set({
          lawyerDecision: input.decision,
          lawyerDecisionReason: input.reason ?? null,
          lawyerDecidedAt: new Date(),
          lawyerDecidedByUserId: ctx.user.id,
        })
        .where(eq(matterAnalysisStages.id, input.stageId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        matterId: matterId ?? null,
        action: `analysis.stage_${input.decision}`,
        details: {
          stageId: input.stageId,
          stageName: stage.stageName,
          reason: input.reason ?? null,
          worker_confidence: stage.confidence,
        },
      });

      return { ok: true };
    }),
});
