import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { organizations, users, auditLog } from '@legal/db';
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
});
