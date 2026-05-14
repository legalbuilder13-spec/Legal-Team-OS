import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { jobs, matters, auditLog } from '@legal/db';
import { staffProcedure, router } from '../trpc.js';
import {
  StatutoryToolInvocationSchema,
  StatutoryToolInvocationBaseSchema,
  CaseLawToolInvocationSchema,
  DeconstructToolInvocationSchema,
  extractStatuteCitations,
  extractCaseCitations,
  detectStatuteKeywords,
  normalizeJurisdictions,
} from '@legal/types';
import { getHistoricalToolHints } from '../integrations/tool_history.js';

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

      // PR8 — historical signal. Run alongside the deterministic
      // hints so the deterministic version remains the primary signal;
      // history is additive. Wrapped in try/catch so a slow / failing
      // tsvector query doesn't block the toolbar from rendering.
      let history: Awaited<ReturnType<typeof getHistoricalToolHints>> = {
        similarMattersConsidered: 0,
        signals: [],
        topSimilarIds: [],
      };
      try {
        history = await getHistoricalToolHints(ctx.db, {
          matterId: input.matterId,
          requestText: matter.requestText,
          k: 10,
        });
      } catch (err) {
        console.warn('tools.context: historical hint fetch failed', { err: String(err) });
      }
      const sigBy = new Map(history.signals.map((s) => [s.tool, s] as const));
      const HISTORICAL_HINT_THRESHOLD = 0.4;

      return {
        availability: TOOL_AVAILABILITY,
        hints: {
          statutory: {
            suggested: suggestStatutory,
            citations: statuteCitations.slice(0, 5),
            keywords: statuteKeywords.slice(0, 5),
            historical: sigBy.get('statutory') ?? null,
            historicallySuggested:
              (sigBy.get('statutory')?.invocationRate ?? 0) >= HISTORICAL_HINT_THRESHOLD,
          },
          caseLaw: {
            suggested: suggestCaseLaw,
            citations: caseCitations.slice(0, 5),
            historical: sigBy.get('case_law') ?? null,
            historicallySuggested:
              (sigBy.get('case_law')?.invocationRate ?? 0) >= HISTORICAL_HINT_THRESHOLD,
          },
          deconstruct: {
            // PR8 — deconstruct is suggested historically when similar
            // matters consistently ran it after their research tools.
            suggested:
              (sigBy.get('deconstruct')?.invocationRate ?? 0) >= HISTORICAL_HINT_THRESHOLD,
            historical: sigBy.get('deconstruct') ?? null,
            historicallySuggested:
              (sigBy.get('deconstruct')?.invocationRate ?? 0) >= HISTORICAL_HINT_THRESHOLD,
          },
        },
        detectedJurisdictionHint: statuteCitations[0]?.jurisdictionHint ?? null,
        historyMetadata: {
          similarMattersConsidered: history.similarMattersConsidered,
          topSimilarIds: history.topSimilarIds,
        },
      };
    }),

  invokeStatutory: staffProcedure
    .input(
      StatutoryToolInvocationBaseSchema.omit({ invokedByUserId: true }).refine(
        (v) => Boolean(v.jurisdictions?.length || v.jurisdiction),
        'Must supply either jurisdictions[] or jurisdiction',
      ),
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

      // PR7 — multi-jurisdiction. Fan out one job per jurisdiction;
      // each writes its own statutory stage row. The deconstruct tool
      // aggregates across all stage rows for the matter.
      const jurisdictions = normalizeJurisdictions(input);
      const insertedJobIds: string[] = [];
      for (const jurisdiction of jurisdictions) {
        const [job] = await ctx.db
          .insert(jobs)
          .values({
            kind: 'run_statutory',
            matterId: input.matterId,
            payload: {
              matter_id: input.matterId,
              jurisdiction,
              candidate_statutes: input.candidateStatutes,
              invoked_by_user_id: ctx.user.id,
            },
          })
          .returning({ id: jobs.id });
        insertedJobIds.push(job!.id);
      }
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'tool.invoked',
        details: {
          tool: 'statutory',
          jurisdictions,
          jobIds: insertedJobIds,
          candidate_statutes: input.candidateStatutes,
        },
      });
      return { jobIds: insertedJobIds, jurisdictions };
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
