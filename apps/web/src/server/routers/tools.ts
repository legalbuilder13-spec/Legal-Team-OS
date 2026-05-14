import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { jobs, matters, auditLog } from '@legal/db';
import { staffProcedure, router } from '../trpc.js';
import {
  StatutoryToolInvocationSchema,
  CaseLawToolInvocationSchema,
  DeconstructToolInvocationSchema,
  extractStatuteCitations,
  extractCaseCitations,
  detectStatuteKeywords,
} from '@legal/types';

// PRD §6.1 + §7.6 + §7.7 + §12 — lawyer-invoked research tools.
// In Phase 1 (this PR) the buttons exist and the routes enqueue jobs,
// but the worker no-ops them. Phase 2+ replaces the no-op with the real
// tool handler implementing the §8 methodology.
//
// The router validates input + writes audit_log so user intent is
// captured even when the tool is a placeholder. That lets us measure
// lawyer demand for each tool before the implementation lands.

// Per-tool gate. Edit here when a phase ships its tool implementation.
// `enabled: false` blocks invocation but still records the lawyer's
// intent in audit_log (demand signal — PRD §20.1).
const TOOL_AVAILABILITY: Record<'statutory' | 'case_law' | 'deconstruct', { enabled: boolean; reason: string }> = {
  statutory: { enabled: true, reason: '' },
  case_law: { enabled: true, reason: '' },
  deconstruct: { enabled: true, reason: '' },
};

export const toolsRouter = router({
  // Returns invocation context for the matter detail page: the toolbar
  // shows availability per tool + suggested-invocation hints derived
  // from the matter's text (PRD §6.1, §7.6, §7.7).
  context: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND' });

      const text = `${matter.requestText}\n${matter.title ?? ''}\n${matter.summary ?? ''}`;
      const statuteCitations = extractStatuteCitations(text);
      const statuteKeywords = detectStatuteKeywords(text);
      const caseCitations = extractCaseCitations(text);

      const suggestStatutory =
        statuteCitations.length > 0 ||
        statuteKeywords.length > 0 ||
        ['privacy', 'regulatory', 'employment', 'real_estate'].includes(matter.practiceArea ?? '');
      const suggestCaseLaw =
        caseCitations.length > 0 ||
        ['litigation', 'ip'].includes(matter.practiceArea ?? '');

      return {
        availability: TOOL_AVAILABILITY,
        hints: {
          statutory: {
            suggested: suggestStatutory,
            citations: statuteCitations.slice(0, 5),
            keywords: statuteKeywords.slice(0, 5),
          },
          caseLaw: {
            suggested: suggestCaseLaw,
            citations: caseCitations.slice(0, 5),
          },
          deconstruct: {
            // Deconstruction is meaningful after some research has run;
            // we'll suggest based on analysis history once Phase 2+ lands.
            suggested: false,
          },
        },
        detectedJurisdictionHint: statuteCitations[0]?.jurisdictionHint ?? null,
      };
    }),

  invokeStatutory: staffProcedure
    .input(
      StatutoryToolInvocationSchema.omit({ invokedByUserId: true }).extend({
        matterId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!TOOL_AVAILABILITY.statutory.enabled) {
        // Even when disabled we record the lawyer's intent for demand
        // signal; PRD §20.1 says under-invocation is a measured risk.
        await ctx.db.insert(auditLog).values({
          actorId: ctx.user.id,
          matterId: input.matterId,
          action: 'tool.invoke_blocked',
          details: { tool: 'statutory', reason: TOOL_AVAILABILITY.statutory.reason, input },
        });
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: TOOL_AVAILABILITY.statutory.reason,
        });
      }
      const [job] = await ctx.db
        .insert(jobs)
        .values({
          kind: 'run_statutory',
          matterId: input.matterId,
          payload: {
            matter_id: input.matterId,
            jurisdiction: input.jurisdiction,
            candidate_statutes: input.candidateStatutes,
            invoked_by_user_id: ctx.user.id,
          },
        })
        .returning({ id: jobs.id });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'tool.invoked',
        details: { tool: 'statutory', jobId: job!.id, input },
      });
      return { jobId: job!.id };
    }),

  invokeCaseLaw: staffProcedure
    .input(
      CaseLawToolInvocationSchema.omit({ invokedByUserId: true }).extend({
        matterId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!TOOL_AVAILABILITY.case_law.enabled) {
        await ctx.db.insert(auditLog).values({
          actorId: ctx.user.id,
          matterId: input.matterId,
          action: 'tool.invoke_blocked',
          details: { tool: 'case_law', reason: TOOL_AVAILABILITY.case_law.reason, input },
        });
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: TOOL_AVAILABILITY.case_law.reason,
        });
      }
      const [job] = await ctx.db
        .insert(jobs)
        .values({
          kind: 'run_case_law',
          matterId: input.matterId,
          payload: {
            matter_id: input.matterId,
            jurisdiction: input.jurisdiction,
            candidate_doctrines: input.candidateDoctrines,
            anchor_opinion_id: input.anchorOpinionId,
            invoked_by_user_id: ctx.user.id,
          },
        })
        .returning({ id: jobs.id });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'tool.invoked',
        details: { tool: 'case_law', jobId: job!.id, input },
      });
      return { jobId: job!.id };
    }),

  invokeDeconstruct: staffProcedure
    .input(
      DeconstructToolInvocationSchema.omit({ invokedByUserId: true }).extend({
        matterId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!TOOL_AVAILABILITY.deconstruct.enabled) {
        await ctx.db.insert(auditLog).values({
          actorId: ctx.user.id,
          matterId: input.matterId,
          action: 'tool.invoke_blocked',
          details: { tool: 'deconstruct', reason: TOOL_AVAILABILITY.deconstruct.reason, input },
        });
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: TOOL_AVAILABILITY.deconstruct.reason,
        });
      }
      const [job] = await ctx.db
        .insert(jobs)
        .values({
          kind: 'run_deconstruct',
          matterId: input.matterId,
          payload: { matter_id: input.matterId, invoked_by_user_id: ctx.user.id },
        })
        .returning({ id: jobs.id });
      return { jobId: job!.id };
    }),
});
