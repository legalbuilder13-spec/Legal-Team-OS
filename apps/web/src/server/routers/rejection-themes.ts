import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  rejectionClusterRuns,
  rejectionClusters,
  organizations,
  users,
  playbooks,
  auditLog,
  type ProposedPayload,
  type ProposedPlaybookPayload,
  type ProposedDomainConfigPayload,
} from '@legal/db';
import { DomainConfigSchema } from '@legal/types';
import { adminProcedure, router } from '../trpc.js';

// M1 — Admin proposal queue for clustered lawyer rejections. The
// weekly worker cron writes pending clusters; this router serves them
// to /admin/rejection-themes, and the mutations turn an accepted
// cluster into either a playbook draft or a domain_config patch.

const PracticeAreaEnum = z.enum([
  'commercial',
  'employment',
  'privacy',
  'litigation',
  'corporate',
  'regulatory',
  'ip',
  'real_estate',
  'other',
]);

function isPlaybookPayload(p: ProposedPayload): p is ProposedPlaybookPayload {
  return (p as ProposedPlaybookPayload)?.kind === 'playbook';
}

function isDomainConfigPayload(p: ProposedPayload): p is ProposedDomainConfigPayload {
  return (p as ProposedDomainConfigPayload)?.kind === 'domain_config';
}

const DOMAIN_CONFIG_PATCH_PATHS = new Set([
  'verb_rules',
  'terminology_rules',
  'high_scrutiny_jurisdictions',
  'domain_risk_taxonomy',
]);

export const rejectionThemesRouter = router({
  // List clusters for the admin queue. Default to pending + accepted
  // (anything not dismissed/actioned), most recent first. Includes
  // the run's window so the UI can show "from week of X".
  list: adminProcedure
    .input(
      z.object({
        statuses: z
          .array(z.enum(['pending', 'accepted', 'dismissed', 'actioned']))
          .default(['pending', 'accepted']),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: rejectionClusters.id,
          runId: rejectionClusters.runId,
          stageName: rejectionClusters.stageName,
          practiceArea: rejectionClusters.practiceArea,
          label: rejectionClusters.label,
          summary: rejectionClusters.summary,
          memberCount: rejectionClusters.memberCount,
          representativeReasons: rejectionClusters.representativeReasons,
          proposalTarget: rejectionClusters.proposalTarget,
          proposedPayload: rejectionClusters.proposedPayload,
          proposalStatus: rejectionClusters.proposalStatus,
          createdAt: rejectionClusters.createdAt,
          actionedAt: rejectionClusters.actionedAt,
          windowStart: rejectionClusterRuns.windowStart,
          windowEnd: rejectionClusterRuns.windowEnd,
        })
        .from(rejectionClusters)
        .innerJoin(
          rejectionClusterRuns,
          eq(rejectionClusters.runId, rejectionClusterRuns.id),
        )
        .where(
          sql`${rejectionClusters.proposalStatus} = ANY(${input.statuses}::rejection_cluster_proposal_status[])`,
        )
        .orderBy(desc(rejectionClusters.createdAt))
        .limit(input.limit);

      const [latestRun] = await ctx.db
        .select({
          id: rejectionClusterRuns.id,
          createdAt: rejectionClusterRuns.createdAt,
          rejectionCount: rejectionClusterRuns.rejectionCount,
          clusterCount: rejectionClusterRuns.clusterCount,
          error: rejectionClusterRuns.error,
        })
        .from(rejectionClusterRuns)
        .orderBy(desc(rejectionClusterRuns.createdAt))
        .limit(1);

      return { clusters: rows, latestRun: latestRun ?? null };
    }),

  // Flip a cluster to accepted (admin agrees there's a real pattern)
  // or dismissed (noise / not actionable). Doesn't yet create the
  // downstream artifact — that's a separate mutation so the admin
  // can review the proposed payload before committing.
  markStatus: adminProcedure
    .input(
      z.object({
        clusterId: z.string().uuid(),
        status: z.enum(['pending', 'accepted', 'dismissed']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [cluster] = await ctx.db
        .select()
        .from(rejectionClusters)
        .where(eq(rejectionClusters.id, input.clusterId))
        .limit(1);
      if (!cluster) throw new TRPCError({ code: 'NOT_FOUND' });

      if (cluster.proposalStatus === 'actioned') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cluster already actioned — cannot change status.',
        });
      }

      await ctx.db
        .update(rejectionClusters)
        .set({ proposalStatus: input.status })
        .where(eq(rejectionClusters.id, input.clusterId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        action: 'rejection_cluster.status_changed',
        details: {
          clusterId: input.clusterId,
          status: input.status,
          previousStatus: cluster.proposalStatus,
        },
      });

      return { ok: true };
    }),

  // Materialize a 'playbook' cluster into an actual playbooks row.
  // The admin can override the title/body/practiceArea before commit;
  // server-side falls back to the LLM-proposed payload when omitted.
  createPlaybookDraft: adminProcedure
    .input(
      z.object({
        clusterId: z.string().uuid(),
        title: z.string().min(3).max(200).optional(),
        body: z.string().min(20).optional(),
        practiceArea: PracticeAreaEnum.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [cluster] = await ctx.db
        .select()
        .from(rejectionClusters)
        .where(eq(rejectionClusters.id, input.clusterId))
        .limit(1);
      if (!cluster) throw new TRPCError({ code: 'NOT_FOUND' });

      if (cluster.proposalStatus === 'actioned') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cluster already actioned.',
        });
      }
      if (cluster.proposalTarget !== 'playbook') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cluster proposal target is '${cluster.proposalTarget}', not 'playbook'.`,
        });
      }

      const proposed = cluster.proposedPayload;
      if (!isPlaybookPayload(proposed)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cluster proposed payload is not a playbook payload.',
        });
      }

      const title = (input.title ?? proposed.title).slice(0, 200);
      const body = input.body ?? proposed.body;
      const practiceAreaValue =
        input.practiceArea ??
        (proposed.practice_area as z.infer<typeof PracticeAreaEnum> | null) ??
        (cluster.practiceArea as z.infer<typeof PracticeAreaEnum> | null);
      if (!practiceAreaValue) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'practiceArea is required (no value on cluster or override).',
        });
      }

      const [created] = await ctx.db
        .insert(playbooks)
        .values({
          practiceArea: practiceAreaValue,
          title,
          body,
          isActive: true,
          createdById: ctx.user.id,
        })
        .returning({ id: playbooks.id });

      await ctx.db
        .update(rejectionClusters)
        .set({
          proposalStatus: 'actioned',
          actionedAt: new Date(),
          actionedByUserId: ctx.user.id,
          actionedPayload: {
            kind: 'playbook',
            playbookId: created!.id,
            title,
            practiceArea: practiceAreaValue,
          },
        })
        .where(eq(rejectionClusters.id, input.clusterId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        action: 'rejection_cluster.actioned_playbook',
        details: {
          clusterId: input.clusterId,
          playbookId: created!.id,
          title,
          practiceArea: practiceAreaValue,
        },
      });

      return { playbookId: created!.id };
    }),

  // Apply a 'domain_config' cluster's proposed patch to the org's
  // domainConfig jsonb. The patch appends to the list at patch_path
  // (verb_rules, terminology_rules, etc.) rather than overwriting —
  // additive only, so admins can stack proposals safely.
  applyDomainConfigPatch: adminProcedure
    .input(
      z.object({
        clusterId: z.string().uuid(),
        // Override allows the admin to edit the LLM's draft payload
        // before commit. Omitted = use the proposed payload as-is.
        patchValueOverride: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [cluster] = await ctx.db
        .select()
        .from(rejectionClusters)
        .where(eq(rejectionClusters.id, input.clusterId))
        .limit(1);
      if (!cluster) throw new TRPCError({ code: 'NOT_FOUND' });

      if (cluster.proposalStatus === 'actioned') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cluster already actioned.',
        });
      }
      if (cluster.proposalTarget !== 'domain_config') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cluster proposal target is '${cluster.proposalTarget}', not 'domain_config'.`,
        });
      }

      const proposed = cluster.proposedPayload;
      if (!isDomainConfigPayload(proposed)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cluster proposed payload is not a domain_config payload.',
        });
      }
      if (!DOMAIN_CONFIG_PATCH_PATHS.has(proposed.patch_path)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported domain_config patch_path '${proposed.patch_path}'.`,
        });
      }

      // Resolve org. v1: cluster.organizationId or default singleton.
      let orgId = cluster.organizationId;
      if (!orgId) {
        const u = await ctx.db
          .select({ orgId: users.organizationId })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        orgId = u[0]?.orgId ?? null;
      }
      if (!orgId) {
        const def = await ctx.db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, 'default'))
          .limit(1);
        orgId = def[0]?.id ?? null;
      }
      if (!orgId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No organization to apply patch to.',
        });
      }

      const [org] = await ctx.db
        .select({ config: organizations.domainConfig })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });

      // Schema-validate the current config; back-compat with EMPTY.
      const current = DomainConfigSchema.safeParse(org.config);
      const base = current.success
        ? current.data
        : DomainConfigSchema.parse({});

      const patchValue = input.patchValueOverride ?? proposed.patch_value;

      // Append-only patches. The DomainConfig keys use camelCase in
      // the typed shape; the patch_path uses snake_case to match
      // the LLM's prompt-side reference. Translate here.
      const next: Record<string, unknown> = { ...base };
      const target = proposed.patch_path;
      const keyMap: Record<string, keyof typeof base> = {
        verb_rules: 'verbRules',
        terminology_rules: 'terminologyRules',
        high_scrutiny_jurisdictions: 'highScrutinyJurisdictions',
        domain_risk_taxonomy: 'domainRiskTaxonomy',
      };
      const camelKey = keyMap[target];
      if (!camelKey) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown patch path '${target}'.`,
        });
      }
      const existing = (base[camelKey] ?? []) as unknown[];
      const additions = Array.isArray(patchValue) ? patchValue : [patchValue];
      next[camelKey] = [...existing, ...additions];

      const validated = DomainConfigSchema.safeParse(next);
      if (!validated.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Patched domain config failed schema validation.',
          cause: validated.error,
        });
      }

      await ctx.db
        .update(organizations)
        .set({
          domainConfig: validated.data as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgId));

      await ctx.db
        .update(rejectionClusters)
        .set({
          proposalStatus: 'actioned',
          actionedAt: new Date(),
          actionedByUserId: ctx.user.id,
          actionedPayload: {
            kind: 'domain_config',
            orgId,
            patchPath: target,
            patchValue,
          },
        })
        .where(eq(rejectionClusters.id, input.clusterId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        action: 'rejection_cluster.actioned_domain_config',
        details: {
          clusterId: input.clusterId,
          orgId,
          patchPath: target,
        },
      });

      return { ok: true, orgId };
    }),

  // Lightweight summary card for the analysis-metrics dashboard: how
  // many clusters are pending review, how stale the latest run is.
  summary: adminProcedure.query(async ({ ctx }) => {
    const [pending] = await ctx.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(rejectionClusters)
      .where(eq(rejectionClusters.proposalStatus, 'pending'));
    const [actioned] = await ctx.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(rejectionClusters)
      .where(
        and(
          eq(rejectionClusters.proposalStatus, 'actioned'),
          sql`${rejectionClusters.actionedAt} > now() - interval '30 days'`,
        ),
      );
    const [latestRun] = await ctx.db
      .select({
        id: rejectionClusterRuns.id,
        createdAt: rejectionClusterRuns.createdAt,
        rejectionCount: rejectionClusterRuns.rejectionCount,
        clusterCount: rejectionClusterRuns.clusterCount,
        error: rejectionClusterRuns.error,
      })
      .from(rejectionClusterRuns)
      .orderBy(desc(rejectionClusterRuns.createdAt))
      .limit(1);

    return {
      pendingCount: pending?.count ?? 0,
      actionedLast30d: actioned?.count ?? 0,
      latestRun: latestRun ?? null,
    };
  }),
});
