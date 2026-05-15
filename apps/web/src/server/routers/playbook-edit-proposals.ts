import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, jobs, playbookEditProposals } from '@legal/db';
import { adminProcedure, router } from '../trpc.js';

// M7 — admin tRPC for the playbook edit proposal queue. The
// weekly mine-playbook-edits cron writes 'pending' rows; the
// admin page at /admin/playbook-edit-proposals renders + actions
// them. Accepting writes an audit_log entry (the actual push to
// Notion is a follow-up PR — v1 logs the decision only).

export const playbookEditProposalsRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          statuses: z
            .array(z.enum(['pending', 'accepted', 'dismissed']))
            .default(['pending']),
        })
        .default({ statuses: ['pending'] }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(playbookEditProposals)
        .where(
          input.statuses.length === 1
            ? eq(playbookEditProposals.status, input.statuses[0]!)
            : undefined,
        )
        .orderBy(desc(playbookEditProposals.createdAt))
        .limit(100);
      return rows;
    }),

  accept: adminProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [proposal] = await ctx.db
        .select()
        .from(playbookEditProposals)
        .where(
          and(
            eq(playbookEditProposals.id, input.proposalId),
            eq(playbookEditProposals.status, 'pending'),
          ),
        )
        .limit(1);
      if (!proposal) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Pending proposal not found.',
        });
      }

      await ctx.db
        .update(playbookEditProposals)
        .set({
          status: 'accepted',
          actionedByUserId: ctx.user.id,
          actionedAt: new Date(),
          actionedReason: input.reason ?? null,
        })
        .where(eq(playbookEditProposals.id, input.proposalId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        action: 'playbook_edit.proposal_accepted',
        details: {
          proposalId: input.proposalId,
          playbookId: proposal.playbookId,
          notionPageId: proposal.notionPageId,
          section: proposal.section,
          evidenceCount: proposal.evidenceCount,
        },
      });

      // M7 follow-up — enqueue Notion auto-apply. Always enqueue; the
      // worker handler honors M7_AUTO_APPLY_NOTION and short-circuits
      // if the flag is off. This keeps env gating on the worker side
      // and avoids mirroring it on web.
      if (proposal.notionPageId) {
        await ctx.db.insert(jobs).values({
          kind: 'apply_playbook_edit_to_notion',
          payload: { proposal_id: input.proposalId },
        });
      }

      return { ok: true };
    }),

  dismiss: adminProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [proposal] = await ctx.db
        .select()
        .from(playbookEditProposals)
        .where(
          and(
            eq(playbookEditProposals.id, input.proposalId),
            eq(playbookEditProposals.status, 'pending'),
          ),
        )
        .limit(1);
      if (!proposal) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Pending proposal not found.',
        });
      }

      await ctx.db
        .update(playbookEditProposals)
        .set({
          status: 'dismissed',
          actionedByUserId: ctx.user.id,
          actionedAt: new Date(),
          actionedReason: input.reason ?? null,
        })
        .where(eq(playbookEditProposals.id, input.proposalId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        action: 'playbook_edit.proposal_dismissed',
        details: {
          proposalId: input.proposalId,
          playbookId: proposal.playbookId,
          notionPageId: proposal.notionPageId,
        },
      });

      return { ok: true };
    }),
});
