import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  organizations,
  users,
  auditLog,
  domainConfigProposals,
} from '@legal/db';
import {
  DomainConfigSchema,
  EMPTY_DOMAIN_CONFIG,
  type DomainConfig,
} from '@legal/types';
import { adminProcedure, staffProcedure, router } from '../trpc.js';

// PR12 §15 — admin tRPC for reading + writing the org's domain
// config. The staff-procedure 'current' getter is broader access so
// the matter detail page can show domain-aware UI cues; the admin
// procedure for writes keeps multi-author edits auditable.

async function getCurrentOrgConfig(
  db: Parameters<Parameters<typeof staffProcedure.query>[0]>[0]['ctx']['db'],
  userId: string,
): Promise<{ orgId: string; orgName: string; config: DomainConfig } | null> {
  const u = await db
    .select({ orgId: users.organizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  let orgId = u[0]?.orgId ?? null;
  if (!orgId) {
    const def = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, 'default'))
      .limit(1);
    orgId = def[0]?.id ?? null;
  }
  if (!orgId) return null;
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, config: organizations.domainConfig })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const org = rows[0];
  if (!org) return null;
  const parsed = DomainConfigSchema.safeParse(org.config);
  return {
    orgId: org.id,
    orgName: org.name,
    config: parsed.success ? parsed.data : EMPTY_DOMAIN_CONFIG,
  };
}

export const domainConfigRouter = router({
  // Read the current user's org config. Surfaced on the matter detail
  // page so the UI can mention domain-specific rules (future PR) and
  // on the admin page for editing.
  current: staffProcedure.query(async ({ ctx }) => {
    const r = await getCurrentOrgConfig(ctx.db, ctx.user.id);
    if (!r) throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization found' });
    return r;
  }),

  // Admin-only write. Validates against DomainConfigSchema before
  // touching the database; rejected payloads return the zod issues
  // so the editor UI can highlight them.
  update: adminProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        config: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = DomainConfigSchema.safeParse(input.config);
      if (!parsed.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Domain config failed schema validation',
          cause: parsed.error,
        });
      }
      await ctx.db
        .update(organizations)
        .set({
          domainConfig: parsed.data as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, input.orgId));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'domain_config.updated',
        details: {
          orgId: input.orgId,
          summary: {
            terminologyRules: parsed.data.terminologyRules.length,
            verbRules: parsed.data.verbRules.length,
            highScrutinyJurisdictions: parsed.data.highScrutinyJurisdictions.length,
            domainRiskTaxonomy: parsed.data.domainRiskTaxonomy.length,
          },
        },
      });
      return { ok: true };
    }),

  // M5 — list pending proposals for the current admin's org. The
  // proposals come from the weekly mine-revisions cron.
  proposals: adminProcedure
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
        .from(domainConfigProposals)
        .where(
          input.statuses.length === 1
            ? eq(domainConfigProposals.status, input.statuses[0]!)
            : undefined,
        )
        .orderBy(desc(domainConfigProposals.createdAt))
        .limit(50);
      return rows;
    }),

  // M5 — apply a proposal: validate the patched config + write to
  // organizations.domain_config + flip the proposal to 'accepted'.
  // Mirrors the rejection-themes applyDomainConfigPatch flow.
  acceptProposal: adminProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [proposal] = await ctx.db
        .select()
        .from(domainConfigProposals)
        .where(eq(domainConfigProposals.id, input.proposalId))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Proposal is not pending.',
        });
      }

      // Resolve target org. Use the proposal's org, else the admin's, else default.
      let orgId = proposal.organizationId;
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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization' });
      }

      const [org] = await ctx.db
        .select({ config: organizations.domainConfig })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });

      const base = DomainConfigSchema.safeParse(org.config);
      const current = base.success ? base.data : DomainConfigSchema.parse({});

      const keyMap: Record<string, keyof typeof current> = {
        verb_rules: 'verbRules',
        terminology_rules: 'terminologyRules',
        high_scrutiny_jurisdictions: 'highScrutinyJurisdictions',
        domain_risk_taxonomy: 'domainRiskTaxonomy',
      };
      const camelKey = keyMap[proposal.patchPath];
      if (!camelKey) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported patch path '${proposal.patchPath}'.`,
        });
      }
      const existing = (current[camelKey] ?? []) as unknown[];
      const additions = Array.isArray(proposal.patchValue)
        ? (proposal.patchValue as unknown[])
        : [proposal.patchValue];
      const next: Record<string, unknown> = {
        ...current,
        [camelKey]: [...existing, ...additions],
      };

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
        .update(domainConfigProposals)
        .set({
          status: 'accepted',
          actionedByUserId: ctx.user.id,
          actionedAt: new Date(),
        })
        .where(eq(domainConfigProposals.id, input.proposalId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        actorKind: 'user',
        action: 'domain_config.proposal_accepted',
        details: {
          proposalId: input.proposalId,
          orgId,
          patchPath: proposal.patchPath,
        },
      });

      return { ok: true, orgId };
    }),

  dismissProposal: adminProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [proposal] = await ctx.db
        .select()
        .from(domainConfigProposals)
        .where(
          and(
            eq(domainConfigProposals.id, input.proposalId),
            eq(domainConfigProposals.status, 'pending'),
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
        .update(domainConfigProposals)
        .set({
          status: 'dismissed',
          actionedByUserId: ctx.user.id,
          actionedAt: new Date(),
        })
        .where(eq(domainConfigProposals.id, input.proposalId));
      return { ok: true };
    }),
});
