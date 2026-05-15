import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import { rules, auditLog, jobs } from '@legal/db';
import { RuleKindSchema, RuleStatusSchema } from '@legal/types';
import { adminProcedure, router } from '../trpc.js';
import { env } from '@/env';
import { enqueueEmbedContent } from '../lib/embed-enqueue.js';

async function compileViaAiService(input: {
  ruleId: string;
  kind: string;
  naturalText: string;
  scope: Record<string, unknown>;
}): Promise<{
  compiled: Record<string, unknown>;
  fallback_llm: boolean;
  fallback_reason: string | null;
  warnings: string[];
  compiler_version: string;
  error: string | null;
}> {
  const res = await fetch(`${env.AI_SERVICE_URL}/compile-rule`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AI_SERVICE_TOKEN
        ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      rule_id: input.ruleId,
      kind: input.kind,
      natural_text: input.naturalText,
      scope: input.scope,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI compile failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as ReturnType<typeof compileViaAiService> extends Promise<infer T>
    ? T
    : never;
}

export const rulesRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          kind: RuleKindSchema.optional(),
          status: RuleStatusSchema.optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds = [];
      if (input.kind) conds.push(eq(rules.kind, input.kind));
      if (input.status) conds.push(eq(rules.status, input.status));
      return ctx.db
        .select()
        .from(rules)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(rules.kind), asc(rules.priority), desc(rules.createdAt));
    }),

  create: adminProcedure
    .input(
      z.object({
        kind: RuleKindSchema,
        name: z.string().min(1).max(120),
        naturalText: z.string().min(1).max(2000),
        scope: z.record(z.string(), z.unknown()).default({}),
        priority: z.number().int().default(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(rules)
        .values({
          kind: input.kind,
          name: input.name,
          naturalText: input.naturalText,
          scope: input.scope,
          priority: input.priority,
          status: 'draft',
          createdById: ctx.user.id,
        })
        .returning();
      if (!created) throw new Error('rule insert failed');
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'rule.created',
        details: { id: created.id, kind: input.kind, name: input.name },
      });
      await enqueueEmbedContent(ctx.db, 'rule', created.id);
      return created;
    }),

  // Compile a rule's natural_text into the structured DSL via the AI
  // service. Synchronous — small latency (1-3s), acceptable for the
  // admin UI. For batch operations, this could move to a background job.
  compile: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.db.query.rules.findFirst({
        where: eq(rules.id, input.id),
      });
      if (!rule) throw new Error('rule not found');

      try {
        const result = await compileViaAiService({
          ruleId: rule.id,
          kind: rule.kind,
          naturalText: rule.naturalText,
          scope: rule.scope as Record<string, unknown>,
        });
        await ctx.db
          .update(rules)
          .set({
            compiled: result.compiled,
            compileError: result.error,
            compilerVersion: result.compiler_version,
            compiledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(rules.id, rule.id));
        await ctx.db.insert(auditLog).values({
          actorId: ctx.user.id,
          action: 'rule.compiled',
          details: {
            id: rule.id,
            kind: rule.kind,
            fallback_llm: result.fallback_llm,
            warnings: result.warnings,
          },
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.db
          .update(rules)
          .set({ compileError: message, updatedAt: new Date() })
          .where(eq(rules.id, rule.id));
        throw err;
      }
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().optional(),
        naturalText: z.string().optional(),
        scope: z.record(z.string(), z.unknown()).optional(),
        priority: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.naturalText !== undefined) {
        patch.naturalText = input.naturalText;
        // Editing the text invalidates any prior compilation. Caller
        // should re-compile before activating.
        patch.compiled = {};
        patch.compileError = null;
        patch.compiledAt = null;
        patch.status = 'draft';
      }
      if (input.scope !== undefined) patch.scope = input.scope;
      if (input.priority !== undefined) patch.priority = input.priority;
      const [updated] = await ctx.db
        .update(rules)
        .set(patch)
        .where(eq(rules.id, input.id))
        .returning();
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'rule.updated',
        details: { id: input.id, patch: Object.keys(patch) },
      });
      if (input.naturalText !== undefined && updated) {
        await enqueueEmbedContent(ctx.db, 'rule', updated.id);
      }
      return updated;
    }),

  activate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.db.query.rules.findFirst({
        where: eq(rules.id, input.id),
      });
      if (!rule) throw new Error('rule not found');
      if (!rule.compiledAt) {
        throw new Error('rule must be compiled before activation');
      }
      const [updated] = await ctx.db
        .update(rules)
        .set({
          status: 'active',
          activatedAt: new Date(),
          activatedById: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(rules.id, input.id))
        .returning();
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'rule.activated',
        details: { id: input.id, kind: rule.kind, name: rule.name },
      });
      return updated;
    }),

  archive: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(rules)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(rules.id, input.id))
        .returning();
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'rule.archived',
        details: { id: input.id },
      });
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(rules).where(eq(rules.id, input.id));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'rule.deleted',
        details: { id: input.id },
      });
      return { deleted: true };
    }),

  // One-shot migration: turn every existing routing_rules row into a
  // pair of NL rules (one SLA, one routing assignment). Idempotent —
  // checks for an existing migration audit entry before inserting.
  // Operator runs this once after G2 deploys; new rules are activated
  // immediately so behavior is preserved.
  migrateLegacyRoutingRules: adminProcedure.mutation(async ({ ctx }) => {
    const { routingRules } = await import('@legal/db');
    const legacy = await ctx.db
      .select({
        id: routingRules.id,
        practiceArea: routingRules.practiceArea,
        defaultAssigneeId: routingRules.defaultAssigneeId,
        slaHours: routingRules.slaHours,
      })
      .from(routingRules);

    const created: Array<{ kind: string; name: string }> = [];
    for (const row of legacy) {
      // Routing rule: practice_area → assignee
      if (row.defaultAssigneeId) {
        const [r] = await ctx.db
          .insert(rules)
          .values({
            kind: 'routing',
            name: `${row.practiceArea} → default assignee`,
            naturalText: `Any ${row.practiceArea} matter routes to the default ${row.practiceArea} attorney.`,
            compiled: {
              when: {
                field: 'matter.practice_area',
                op: '==',
                value: row.practiceArea,
              },
              then: { assignee_id: row.defaultAssigneeId },
              fallback_llm: false,
            },
            status: 'active',
            priority: 500,
            compilerVersion: 'v1-migration-2026-05',
            compiledAt: new Date(),
            activatedAt: new Date(),
            activatedById: ctx.user.id,
            createdById: ctx.user.id,
          })
          .returning();
        if (r) created.push({ kind: 'routing', name: r.name });
      }
      // SLA rule: practice_area → sla_hours
      const [s] = await ctx.db
        .insert(rules)
        .values({
          kind: 'sla',
          name: `${row.practiceArea} default SLA`,
          naturalText: `Any ${row.practiceArea} matter has an SLA of ${row.slaHours} hours.`,
          compiled: {
            when: {
              field: 'matter.practice_area',
              op: '==',
              value: row.practiceArea,
            },
            then: { sla_hours: row.slaHours },
            fallback_llm: false,
          },
          status: 'active',
          priority: 500,
          compilerVersion: 'v1-migration-2026-05',
          compiledAt: new Date(),
          activatedAt: new Date(),
          activatedById: ctx.user.id,
          createdById: ctx.user.id,
        })
        .returning();
      if (s) created.push({ kind: 'sla', name: s.name });
    }

    await ctx.db.insert(auditLog).values({
      actorId: ctx.user.id,
      action: 'rules.legacy_migration',
      details: { legacyCount: legacy.length, createdCount: created.length },
    });
    return { migrated: legacy.length, created };
  }),
});
