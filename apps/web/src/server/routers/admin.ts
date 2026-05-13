import { z } from 'zod';
import { and, asc, desc, eq, ilike, gte, lte, sql } from 'drizzle-orm';
import {
  users,
  routingRules,
  auditLog,
  matters,
  playbooks,
  playbookVersions,
  playbookSuggestions,
  knowledgeArticles,
  systemInsights,
} from '@legal/db';
import { PracticeAreaSchema } from '@legal/types';
import { adminProcedure, router } from '../trpc.js';

const RoleSchema = z.enum(['attorney', 'legal_ops', 'admin', 'requester']);

export const adminRouter = router({
  listAuditLog: adminProcedure
    .input(
      z
        .object({
          actor: z.enum(['all', 'user', 'system', 'copilot']).default('all'),
          actionContains: z.string().max(100).optional(),
          matterId: z.string().uuid().optional(),
          actorId: z.string().uuid().optional(),
          since: z.string().datetime().optional(),
          until: z.string().datetime().optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.actor === 'user') conditions.push(eq(auditLog.actorKind, 'user'));
      if (input.actor === 'system') conditions.push(eq(auditLog.actorKind, 'system'));
      if (input.actor === 'copilot') {
        conditions.push(sql`(${auditLog.details} ->> 'source') = 'copilot'`);
      }
      if (input.actionContains)
        conditions.push(ilike(auditLog.action, `%${input.actionContains}%`));
      if (input.matterId) conditions.push(eq(auditLog.matterId, input.matterId));
      if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
      if (input.since) conditions.push(gte(auditLog.createdAt, new Date(input.since)));
      if (input.until) conditions.push(lte(auditLog.createdAt, new Date(input.until)));

      return ctx.db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          actorKind: auditLog.actorKind,
          actorName: users.name,
          matterId: auditLog.matterId,
          matterShortId: matters.shortId,
          matterTitle: matters.title,
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.actorId, users.id))
        .leftJoin(matters, eq(auditLog.matterId, matters.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit);
    }),

  listUsers: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(users).orderBy(asc(users.name));
  }),

  createUser: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        role: RoleSchema.default('attorney'),
        slackUserId: z.string().optional(),
        practiceAreas: z.array(PracticeAreaSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          role: input.role,
          slackUserId: input.slackUserId,
          practiceAreas: input.practiceAreas,
        })
        .returning();
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'user.created',
        details: { userId: created?.id, email: input.email, role: input.role },
      });
      return created;
    }),

  updateUser: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        role: RoleSchema.optional(),
        slackUserId: z.string().nullable().optional(),
        practiceAreas: z.array(PracticeAreaSchema).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.role !== undefined) patch.role = input.role;
      if (input.slackUserId !== undefined) patch.slackUserId = input.slackUserId;
      if (input.practiceAreas !== undefined) patch.practiceAreas = input.practiceAreas;

      const [updated] = await ctx.db
        .update(users)
        .set(patch)
        .where(eq(users.id, input.id))
        .returning();
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'user.updated',
        details: { userId: input.id, patch },
      });
      return updated;
    }),

  listRoutingRules: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: routingRules.id,
        practiceArea: routingRules.practiceArea,
        defaultAssigneeId: routingRules.defaultAssigneeId,
        slaHours: routingRules.slaHours,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(routingRules)
      .leftJoin(users, eq(routingRules.defaultAssigneeId, users.id))
      .orderBy(asc(routingRules.practiceArea));
  }),

  listPlaybooks: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(playbooks)
      .orderBy(asc(playbooks.practiceArea), asc(playbooks.createdAt));
  }),

  upsertPlaybook: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        practiceArea: PracticeAreaSchema,
        title: z.string().min(1),
        body: z.string().min(1),
        isActive: z.boolean().default(true),
        changeSummary: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const existing = await ctx.db.query.playbooks.findFirst({
          where: eq(playbooks.id, input.id),
        });
        if (existing && (existing.body !== input.body || existing.title !== input.title)) {
          await ctx.db.insert(playbookVersions).values({
            playbookId: existing.id,
            versionNumber: existing.version,
            title: existing.title,
            body: existing.body,
            changeSummary: input.changeSummary ?? null,
            createdById: ctx.user.id,
          });
        }
        const nextVersion = existing
          ? existing.body !== input.body || existing.title !== input.title
            ? existing.version + 1
            : existing.version
          : 1;
        const [updated] = await ctx.db
          .update(playbooks)
          .set({
            practiceArea: input.practiceArea,
            title: input.title,
            body: input.body,
            isActive: input.isActive,
            version: nextVersion,
            updatedAt: new Date(),
          })
          .where(eq(playbooks.id, input.id))
          .returning();
        return updated;
      }
      const [created] = await ctx.db
        .insert(playbooks)
        .values({
          practiceArea: input.practiceArea,
          title: input.title,
          body: input.body,
          isActive: input.isActive,
          createdById: ctx.user.id,
        })
        .returning();
      return created;
    }),

  listPlaybookVersions: adminProcedure
    .input(z.object({ playbookId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.playbookId, input.playbookId))
        .orderBy(desc(playbookVersions.versionNumber));
    }),

  proposePlaybookSuggestion: adminProcedure
    .input(
      z.object({
        playbookId: z.string().uuid().optional(),
        practiceArea: PracticeAreaSchema,
        suggestedTitle: z.string().min(1),
        suggestedBody: z.string().min(1),
        rationale: z.string().min(1),
        evidenceMatterIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(playbookSuggestions)
        .values({
          playbookId: input.playbookId ?? null,
          practiceArea: input.practiceArea,
          suggestedTitle: input.suggestedTitle,
          suggestedBody: input.suggestedBody,
          rationale: input.rationale,
          evidenceMatterIds: input.evidenceMatterIds,
          proposedById: ctx.user.id,
        })
        .returning();
      return created;
    }),

  listPlaybookSuggestions: adminProcedure
    .input(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const base = ctx.db.select().from(playbookSuggestions);
      return input.status
        ? base.where(eq(playbookSuggestions.status, input.status)).orderBy(desc(playbookSuggestions.createdAt))
        : base.orderBy(desc(playbookSuggestions.createdAt));
    }),

  reviewPlaybookSuggestion: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(['approved', 'rejected']),
        applyToPlaybook: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const suggestion = await ctx.db.query.playbookSuggestions.findFirst({
        where: eq(playbookSuggestions.id, input.id),
      });
      if (!suggestion) throw new Error('suggestion not found');

      await ctx.db
        .update(playbookSuggestions)
        .set({
          status: input.decision,
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
        })
        .where(eq(playbookSuggestions.id, input.id));

      if (input.decision === 'approved' && input.applyToPlaybook && suggestion.playbookId) {
        const existing = await ctx.db.query.playbooks.findFirst({
          where: eq(playbooks.id, suggestion.playbookId),
        });
        if (existing) {
          await ctx.db.insert(playbookVersions).values({
            playbookId: existing.id,
            versionNumber: existing.version,
            title: existing.title,
            body: existing.body,
            changeSummary: `Applied suggestion: ${suggestion.rationale.slice(0, 200)}`,
            createdById: ctx.user.id,
          });
          await ctx.db
            .update(playbooks)
            .set({
              title: suggestion.suggestedTitle,
              body: suggestion.suggestedBody,
              version: existing.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(playbooks.id, existing.id));
        }
      }
    }),

  deletePlaybook: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(playbooks).where(eq(playbooks.id, input.id));
    }),

  listKnowledgeArticles: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(knowledgeArticles)
      .orderBy(asc(knowledgeArticles.practiceArea), asc(knowledgeArticles.createdAt));
  }),

  upsertKnowledgeArticle: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        practiceArea: PracticeAreaSchema,
        title: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).default([]),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const [updated] = await ctx.db
          .update(knowledgeArticles)
          .set({
            practiceArea: input.practiceArea,
            title: input.title,
            body: input.body,
            tags: input.tags,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeArticles.id, input.id))
          .returning();
        return updated;
      }
      const [created] = await ctx.db
        .insert(knowledgeArticles)
        .values({
          practiceArea: input.practiceArea,
          title: input.title,
          body: input.body,
          tags: input.tags,
          isActive: input.isActive,
          createdById: ctx.user.id,
        })
        .returning();
      return created;
    }),

  deleteKnowledgeArticle: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, input.id));
    }),

  listInsights: adminProcedure
    .input(z.object({ status: z.enum(['active', 'dismissed', 'actioned']).default('active') }).default({}))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(systemInsights)
        .where(eq(systemInsights.status, input.status))
        .orderBy(desc(systemInsights.createdAt))
        .limit(50);
    }),

  dismissInsight: adminProcedure
    .input(z.object({ id: z.string().uuid(), decision: z.enum(['dismissed', 'actioned']) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(systemInsights)
        .set({
          status: input.decision,
          dismissedById: ctx.user.id,
          dismissedAt: new Date(),
        })
        .where(eq(systemInsights.id, input.id));
    }),

  upsertRoutingRule: adminProcedure
    .input(
      z.object({
        practiceArea: PracticeAreaSchema,
        defaultAssigneeId: z.string().uuid().nullable(),
        slaHours: z.number().int().min(1).max(720),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.routingRules.findFirst({
        where: eq(routingRules.practiceArea, input.practiceArea),
      });
      let result;
      if (existing) {
        const [updated] = await ctx.db
          .update(routingRules)
          .set({
            defaultAssigneeId: input.defaultAssigneeId,
            slaHours: input.slaHours,
            updatedAt: new Date(),
          })
          .where(eq(routingRules.id, existing.id))
          .returning();
        result = updated;
      } else {
        const [created] = await ctx.db
          .insert(routingRules)
          .values({
            practiceArea: input.practiceArea,
            defaultAssigneeId: input.defaultAssigneeId,
            slaHours: input.slaHours,
          })
          .returning();
        result = created;
      }
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'routing_rule.upserted',
        details: input,
      });
      return result;
    }),
});
