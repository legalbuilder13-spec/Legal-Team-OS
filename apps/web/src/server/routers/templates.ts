import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { templates, auditLog } from '@legal/db';
import { PracticeAreaSchema } from '@legal/types';
import { adminProcedure, staffProcedure, router } from '../trpc.js';

const VariableSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
});

export const templatesRouter = router({
  // Staff-readable: drafting workspace surfaces templates filtered to
  // the matter's practice area.
  listForPracticeArea: staffProcedure
    .input(
      z.object({
        practiceArea: PracticeAreaSchema,
        activeOnly: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(templates.practiceArea, input.practiceArea)];
      if (input.activeOnly) conditions.push(eq(templates.isActive, true));
      return ctx.db
        .select({
          id: templates.id,
          practiceArea: templates.practiceArea,
          matterType: templates.matterType,
          name: templates.name,
          variables: templates.variables,
          useCount: templates.useCount,
          lastUsedAt: templates.lastUsedAt,
        })
        .from(templates)
        .where(and(...conditions))
        .orderBy(desc(templates.useCount), asc(templates.name));
    }),

  // Returns the full body — used when the attorney picks a template
  // and we need to seed the draft.
  get: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.db.query.templates.findFirst({
        where: eq(templates.id, input.id),
      });
      if (!t) throw new Error('template not found');
      return t;
    }),

  // Records usage when a template is applied to a draft. Bumps useCount
  // and lastUsedAt so the picker can sort by popularity.
  recordUsage: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(templates)
        .set({
          useCount: sql`${templates.useCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(templates.id, input.id));
      return { recorded: true };
    }),

  // Admin CRUD
  listAll: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(templates)
      .orderBy(asc(templates.practiceArea), asc(templates.name));
  }),

  upsert: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        practiceArea: PracticeAreaSchema,
        matterType: z.string().max(60).optional(),
        name: z.string().min(1).max(120),
        body: z.string().min(1),
        variables: z.array(VariableSchema).default([]),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = {
        practiceArea: input.practiceArea,
        matterType: input.matterType,
        name: input.name,
        body: input.body,
        variables: input.variables,
        isActive: input.isActive,
        updatedAt: new Date(),
      };
      let result;
      if (input.id) {
        const [updated] = await ctx.db
          .update(templates)
          .set(data)
          .where(eq(templates.id, input.id))
          .returning();
        result = updated;
      } else {
        const [created] = await ctx.db
          .insert(templates)
          .values({ ...data, createdById: ctx.user.id })
          .returning();
        result = created;
      }
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'template.upserted',
        details: {
          id: result?.id,
          practiceArea: input.practiceArea,
          name: input.name,
        },
      });
      return result;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.templates.findFirst({
        where: eq(templates.id, input.id),
      });
      if (!existing) return { deleted: false };
      await ctx.db.delete(templates).where(eq(templates.id, input.id));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'template.deleted',
        details: { id: input.id, name: existing.name },
      });
      return { deleted: true };
    }),
});
