import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { users, routingRules, auditLog, playbooks } from '@legal/db';
import { PracticeAreaSchema } from '@legal/types';
import { adminProcedure, router } from '../trpc.js';

const RoleSchema = z.enum(['attorney', 'legal_ops', 'admin', 'requester']);

export const adminRouter = router({
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const [updated] = await ctx.db
          .update(playbooks)
          .set({
            practiceArea: input.practiceArea,
            title: input.title,
            body: input.body,
            isActive: input.isActive,
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

  deletePlaybook: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(playbooks).where(eq(playbooks.id, input.id));
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
