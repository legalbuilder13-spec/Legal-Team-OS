import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { and } from 'drizzle-orm';
import {
  matterAnalyses,
  matterAnalysisStages,
  matterAnalysisSources,
  matterFrameFlips,
  matterAbsenceFindings,
  auditLog,
  matters,
  playbooks,
} from '@legal/db';
import { PracticeAreaSchema, ResearchDepthSchema } from '@legal/types';
import { staffProcedure, router } from '../trpc.js';
import { createNotionPage } from '../integrations/notion.js';

// PRD §6 — read-only API for the matter detail page's Analysis panel.
// Returns the latest analysis run + its stages + source rows for any
// stage the lawyer expands. Tool invocation is in routers/tools.ts.
// PR10 adds the overrideStage mutation for accept/reject controls.

const StageDecisionInput = z.object({
  stageId: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected', 'escalated']),
  reason: z.string().max(2000).optional(),
  // M5 — optional revised stage output. When the lawyer uses the
  // "revise → accept" affordance with a textarea, the revision is
  // captured here so the M5 mining cron can extract terminology /
  // verb / jurisdiction patterns from the diff.
  revisedOutput: z
    .object({
      text: z.string().min(1).max(20_000),
    })
    .optional(),
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

      // PR-A — also return any pending or resolved frame-flip proposals
      // so the UI banner has the latest state without a second roundtrip.
      const frameFlips = await ctx.db
        .select()
        .from(matterFrameFlips)
        .where(eq(matterFrameFlips.matterAnalysisId, analysis.id))
        .orderBy(desc(matterFrameFlips.createdAt));

      // PR-6 — absence findings for the missing-facts panel.
      const absenceFindings = await ctx.db
        .select()
        .from(matterAbsenceFindings)
        .where(eq(matterAbsenceFindings.matterAnalysisId, analysis.id))
        .orderBy(matterAbsenceFindings.createdAt);

      return { analysis, stages, frameFlips, absenceFindings };
    }),

  // PR-6 — resolve a missing-fact finding (the lawyer supplies the
  // missing fact's value) or dismiss it (the model was wrong / fact
  // isn't actually dispositive here).
  resolveAbsence: staffProcedure
    .input(
      z.object({
        findingId: z.string().uuid(),
        action: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('resolve'), value: z.string().min(1).max(2000) }),
          z.object({ kind: z.literal('dismiss') }),
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action.kind === 'resolve') {
        await ctx.db
          .update(matterAbsenceFindings)
          .set({
            resolved: true,
            resolvedValue: input.action.value,
            resolvedAt: new Date(),
            resolvedByUserId: ctx.user.id,
          })
          .where(eq(matterAbsenceFindings.id, input.findingId));
        await ctx.db.insert(auditLog).values({
          actorKind: 'user',
          actorId: ctx.user.id,
          action: 'analysis.absence_resolved',
          details: { findingId: input.findingId },
        });
      } else {
        await ctx.db
          .update(matterAbsenceFindings)
          .set({ dismissed: true, resolvedAt: new Date(), resolvedByUserId: ctx.user.id })
          .where(eq(matterAbsenceFindings.id, input.findingId));
        await ctx.db.insert(auditLog).values({
          actorKind: 'user',
          actorId: ctx.user.id,
          action: 'analysis.absence_dismissed',
          details: { findingId: input.findingId },
        });
      }
      return { ok: true };
    }),

  // PR-A — depth selector. Lawyer escalates depth on the same matter
  // (typically from client_advice -> filing_grade or bet_the_company
  // when stakes increase). Re-running the pipeline at the new depth
  // is the caller's responsibility; this mutation only persists.
  setDepth: staffProcedure
    .input(
      z.object({
        analysisId: z.string().uuid(),
        depth: ResearchDepthSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(matterAnalyses)
        .set({ researchDepth: input.depth })
        .where(eq(matterAnalyses.id, input.analysisId))
        .returning({ id: matterAnalyses.id, depth: matterAnalyses.researchDepth });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'analysis not found' });
      await ctx.db.insert(auditLog).values({
        actorKind: 'user',
        actorId: ctx.user.id,
        action: 'analysis.depth_changed',
        details: { analysisId: input.analysisId, depth: input.depth },
      });
      return row;
    }),

  // PR-A — frame-flip decision endpoints. Accept rewrites the
  // matter_analyses.doctrinal_frame; reject leaves the frame intact.
  decideFrameFlip: staffProcedure
    .input(
      z.object({
        flipId: z.string().uuid(),
        decision: z.enum(['accepted', 'rejected']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [flip] = await ctx.db
        .select()
        .from(matterFrameFlips)
        .where(eq(matterFrameFlips.id, input.flipId))
        .limit(1);
      if (!flip) throw new TRPCError({ code: 'NOT_FOUND', message: 'frame flip not found' });

      await ctx.db
        .update(matterFrameFlips)
        .set({
          lawyerDecision: input.decision,
          lawyerDecidedAt: new Date(),
          lawyerDecidedByUserId: ctx.user.id,
        })
        .where(eq(matterFrameFlips.id, input.flipId));

      if (input.decision === 'accepted') {
        // Rewrite the carried frame. The new primary_regime is to_frame;
        // the prior primary_regime becomes an alternative with prior=0.3.
        const [analysis] = await ctx.db
          .select()
          .from(matterAnalyses)
          .where(eq(matterAnalyses.id, flip.matterAnalysisId))
          .limit(1);
        if (analysis) {
          type StageLabel =
            | 'intake'
            | 'stage_0'
            | 'stage_1'
            | 'stage_2a'
            | 'stage_2b'
            | 'stage_3';
          const STAGE_LABELS: ReadonlySet<StageLabel> = new Set([
            'intake',
            'stage_0',
            'stage_1',
            'stage_2a',
            'stage_2b',
            'stage_3',
          ]);
          const stageLabel: StageLabel = STAGE_LABELS.has(flip.proposedByStage as StageLabel)
            ? (flip.proposedByStage as StageLabel)
            : 'intake';
          const prior = analysis.doctrinalFrame as {
            primary_regime: string;
            alternative_regimes: Array<{ regime: string; prior: number }>;
            last_updated_by_stage: StageLabel;
            flip_count: number;
          } | null;
          const nextFrame = {
            primary_regime: flip.toFrame,
            alternative_regimes: [
              ...(prior?.primary_regime
                ? [{ regime: prior.primary_regime, prior: 0.3 }]
                : []),
              ...(prior?.alternative_regimes ?? []),
            ],
            last_updated_by_stage: stageLabel,
            flip_count: (prior?.flip_count ?? 0) + 1,
          };
          await ctx.db
            .update(matterAnalyses)
            .set({ doctrinalFrame: nextFrame })
            .where(eq(matterAnalyses.id, flip.matterAnalysisId));
        }
      }

      await ctx.db.insert(auditLog).values({
        actorKind: 'user',
        actorId: ctx.user.id,
        action: `analysis.frame_flip_${input.decision}`,
        details: {
          flipId: input.flipId,
          fromFrame: flip.fromFrame,
          toFrame: flip.toFrame,
          proposedByStage: flip.proposedByStage,
        },
      });

      return { ok: true };
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
      if (!analysis) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Parent analysis not found for this stage.',
        });
      }
      const matterId = analysis.matterId;

      await ctx.db
        .update(matterAnalysisStages)
        .set({
          lawyerDecision: input.decision,
          lawyerDecisionReason: input.reason ?? null,
          lawyerDecidedAt: new Date(),
          lawyerDecidedByUserId: ctx.user.id,
          // M5 — preserve the revision if supplied. Don't clear on
          // accept-without-revision; an earlier reject's reason
          // history stays informative.
          ...(input.revisedOutput
            ? { lawyerRevisedOutput: input.revisedOutput as Record<string, unknown> }
            : {}),
        })
        .where(eq(matterAnalysisStages.id, input.stageId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        matterId,
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

  // PR15 — save an accepted tool output as a playbook so future
  // similar matters match in Stage 1 guidance. Closes the learning
  // loop: a matter that needed Stage 2+ research today becomes a
  // matched-playbook hit tomorrow.
  //
  // Only fires on accepted stages of the three lawyer-invoked tools
  // (statutory / case_law / deconstruct). Pre-merits + guidance
  // stages aren't useful as playbooks (they're checklist + retrieval,
  // not synthesized content). Worker confidence must be HIGH or
  // MEDIUM — LOW outputs are blocked from becoming guidance.
  savePlaybookFromStage: staffProcedure
    .input(
      z.object({
        stageId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        practiceArea: PracticeAreaSchema.optional(),
        body: z.string().min(20).optional(),
        alsoSaveToNotion: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stage = await ctx.db.query.matterAnalysisStages.findFirst({
        where: eq(matterAnalysisStages.id, input.stageId),
      });
      if (!stage) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!['statutory', 'case_law', 'deconstruct'].includes(stage.stageName)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Only statutory, case_law, and deconstruct stages can be saved as playbooks.',
        });
      }
      if (stage.lawyerDecision !== 'accepted') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Stage must be accepted before saving as a playbook.',
        });
      }
      if (stage.confidence === 'LOW') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'LOW-confidence outputs cannot be promoted to playbooks.',
        });
      }

      const analysis = await ctx.db.query.matterAnalyses.findFirst({
        where: eq(matterAnalyses.id, stage.analysisId),
      });
      if (!analysis) throw new TRPCError({ code: 'NOT_FOUND' });

      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, analysis.matterId),
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND' });

      const practiceArea = input.practiceArea ?? matter.practiceArea ?? 'other';
      const title = input.title ?? `${matter.title} — ${stage.stageName.replace('_', ' ')}`;
      const body = input.body ?? deriveDefaultBody(stage);

      // Insert the playbook row. Stage 1 guidance grader will surface
      // this in the next similar matter's auto pipeline run.
      const [created] = await ctx.db
        .insert(playbooks)
        .values({
          practiceArea,
          title: title.slice(0, 200),
          body,
          isActive: true,
          createdById: ctx.user.id,
        })
        .returning({ id: playbooks.id });

      // Optionally mirror to Notion so the playbook lives in the KB
      // structure too. Best-effort; failures here don't roll back the
      // database insert.
      let notionUrl: string | null = null;
      let notionPageId: string | null = null;
      if (input.alsoSaveToNotion) {
        try {
          const result = await createNotionPage({
            title: `Playbook · ${title}`,
            body: `${body}\n\n---\nDerived from ${matter.shortId} stage ${stage.stageName} accepted by ${ctx.user.name} on ${new Date().toISOString()}.`,
          });
          notionUrl = result?.url ?? null;
          notionPageId = result?.id ?? null;
        } catch (err) {
          console.warn('savePlaybookFromStage: Notion write failed', { err: String(err) });
        }
      }

      // M4 — persist the Notion page id so the promote-playbooks cron
      // can attribute future stage-1 matches back to this playbook
      // via the audit_log 'playbook.matched_in_guidance' event.
      if (notionPageId) {
        await ctx.db
          .update(playbooks)
          .set({ notionPageId, updatedAt: new Date() })
          .where(eq(playbooks.id, created!.id));
      }

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        matterId: matter.id,
        action: 'playbook.created_from_stage',
        details: {
          stageId: input.stageId,
          stageName: stage.stageName,
          playbookId: created!.id,
          practiceArea,
          notionUrl,
        },
      });

      return { playbookId: created!.id, notionUrl };
    }),
});

// PR15 — default body generation when the lawyer doesn't override.
// Pulls the most playbook-friendly sections out of each stage type.
function deriveDefaultBody(stage: {
  stageName: string;
  outputJson: unknown;
}): string {
  const o = (stage.outputJson ?? {}) as Record<string, unknown>;
  if (stage.stageName === 'deconstruct') {
    const memo = (o.memo ?? {}) as Record<string, unknown>;
    return [
      memo.issue ? `# Issue\n\n${memo.issue}` : null,
      memo.rule ? `# Rule\n\n${memo.rule}` : null,
      memo.application ? `# Application\n\n${memo.application}` : null,
      memo.conclusion ? `# Conclusion\n\n${memo.conclusion}` : null,
      memo.what_i_dont_know ? `## What I don't know\n\n${memo.what_i_dont_know}` : null,
      memo.mirror_image_argument
        ? `## Mirror-image argument (strongest reading against)\n\n${memo.mirror_image_argument}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  if (stage.stageName === 'statutory') {
    const provisions = (o.operative_provisions as Array<Record<string, unknown>> | undefined) ?? [];
    return [
      o.applicability_to_facts ? `# Application\n\n${o.applicability_to_facts}` : null,
      provisions.length > 0
        ? `# Operative provisions\n\n${provisions
            .slice(0, 5)
            .map((p) => `- **${p.citation}**: "${p.quoted_text}"`)
            .join('\n')}`
        : null,
      o.textualist_reading ? `## Textualist reading\n\n${o.textualist_reading}` : null,
      o.purposivist_reading ? `## Purposivist reading\n\n${o.purposivist_reading}` : null,
      o.mirror_image_argument ? `## Mirror-image\n\n${o.mirror_image_argument}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  if (stage.stageName === 'case_law') {
    const controlling = (o.controlling_authority as Array<Record<string, unknown>> | undefined) ?? [];
    const antiAnalogous = (o.anti_analogous_cases as Array<Record<string, unknown>> | undefined) ?? [];
    return [
      controlling.length > 0
        ? `# Controlling authority\n\n${controlling
            .map((c) => `- **${c.cite}** (${c.treatment}): ${c.holding}`)
            .join('\n')}`
        : null,
      antiAnalogous.length > 0
        ? `## Anti-analogous (strongest reading against)\n\n${antiAnalogous
            .map((a) => {
              const c = (a.case ?? {}) as Record<string, unknown>;
              return `- **${c.cite}**: ${a.why_distinguishable}`;
            })
            .join('\n')}`
        : null,
      o.mirror_image_argument ? `## Mirror-image\n\n${o.mirror_image_argument}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  return JSON.stringify(o, null, 2);
}
