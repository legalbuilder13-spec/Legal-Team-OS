import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  clauses,
  clauseExtractions,
  jobs,
  templates,
} from '@legal/db';
import { PracticeAreaSchema } from '@legal/types';
import { adminProcedure, staffProcedure, router } from '../trpc.js';
import { enqueueEmbedContent } from '../lib/embed-enqueue.js';

// PR #6 — Clauses + extraction proposals routers.
// - `clauses.list` and `clauses.upsert` manage the approved library.
// - `clauses.listExtractions` returns the lawyer-review queue
//   populated by the `extract_template_clauses` worker handler.
// - `clauses.acceptExtraction` promotes a proposal to a real clause.
// - `clauses.dismissExtraction` rejects without creating a clause.
// - `clauses.enqueueExtraction` triggers a fresh extraction run for
//   one or many templates.

export const clausesRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          practiceArea: PracticeAreaSchema.optional(),
          status: z.enum(['draft', 'approved', 'archived']).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conds = [];
      if (input.practiceArea) conds.push(eq(clauses.practiceArea, input.practiceArea));
      if (input.status) conds.push(eq(clauses.status, input.status));
      return ctx.db
        .select()
        .from(clauses)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(clauses.isCanonical), asc(clauses.practiceArea), asc(clauses.name))
        .limit(500);
    }),

  upsert: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        practiceArea: PracticeAreaSchema,
        name: z.string().min(3).max(120),
        body: z.string().min(50),
        jurisdictions: z.array(z.string()).default([]),
        isCanonical: z.boolean().default(false),
        status: z.enum(['draft', 'approved', 'archived']).default('draft'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = {
        practiceArea: input.practiceArea,
        name: input.name,
        body: input.body,
        jurisdictions: input.jurisdictions,
        isCanonical: input.isCanonical,
        status: input.status,
        updatedAt: new Date(),
      };
      let result;
      if (input.id) {
        const [updated] = await ctx.db
          .update(clauses)
          .set(data)
          .where(eq(clauses.id, input.id))
          .returning();
        result = updated;
      } else {
        const [created] = await ctx.db
          .insert(clauses)
          .values({ ...data, createdById: ctx.user.id })
          .returning();
        result = created;
      }
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'clause.upserted',
        details: { id: result?.id, name: input.name, status: input.status },
      });
      return result;
    }),

  archive: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(clauses)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(clauses.id, input.id));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'clause.archived',
        details: { id: input.id },
      });
      return { archived: true };
    }),

  // Lawyer-review queue. Returns extractions grouped by source template
  // so the UI can render "These N clauses came from template X" sections.
  listExtractions: adminProcedure
    .input(
      z
        .object({
          status: z.enum(['pending', 'accepted', 'dismissed']).default('pending'),
        })
        .default({ status: 'pending' }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: clauseExtractions.id,
          sourceTemplateId: clauseExtractions.sourceTemplateId,
          proposedName: clauseExtractions.proposedName,
          proposedBody: clauseExtractions.proposedBody,
          proposedJurisdictions: clauseExtractions.proposedJurisdictions,
          proposedPosition: clauseExtractions.proposedPosition,
          rationale: clauseExtractions.rationale,
          status: clauseExtractions.status,
          extractionRunId: clauseExtractions.extractionRunId,
          createdAt: clauseExtractions.createdAt,
          templateName: templates.name,
          templatePracticeArea: templates.practiceArea,
        })
        .from(clauseExtractions)
        .leftJoin(templates, eq(clauseExtractions.sourceTemplateId, templates.id))
        .where(eq(clauseExtractions.status, input.status))
        .orderBy(
          desc(clauseExtractions.extractionRunId),
          asc(clauseExtractions.proposedPosition),
        )
        .limit(500);
      return rows;
    }),

  acceptExtraction: adminProcedure
    .input(
      z.object({
        extractionId: z.string().uuid(),
        // Optional overrides — admin can edit name/body before approving
        nameOverride: z.string().optional(),
        bodyOverride: z.string().optional(),
        jurisdictionsOverride: z.array(z.string()).optional(),
        markCanonical: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ext = await ctx.db.query.clauseExtractions.findFirst({
        where: eq(clauseExtractions.id, input.extractionId),
      });
      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extraction not found.' });
      }
      if (ext.status !== 'pending') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Extraction is already ${ext.status}.`,
        });
      }
      const tpl = await ctx.db.query.templates.findFirst({
        where: eq(templates.id, ext.sourceTemplateId),
      });
      if (!tpl) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Source template no longer exists.',
        });
      }
      const [created] = await ctx.db
        .insert(clauses)
        .values({
          practiceArea: tpl.practiceArea,
          name: input.nameOverride?.trim() || ext.proposedName,
          body: input.bodyOverride?.trim() || ext.proposedBody,
          jurisdictions:
            input.jurisdictionsOverride ?? ext.proposedJurisdictions ?? [],
          isCanonical: input.markCanonical,
          status: 'approved',
          sourceTemplateId: ext.sourceTemplateId,
          createdById: ctx.user.id,
        })
        .returning();
      await ctx.db
        .update(clauseExtractions)
        .set({
          status: 'accepted',
          approvedClauseId: created!.id,
          actionedById: ctx.user.id,
          actionedAt: new Date(),
        })
        .where(eq(clauseExtractions.id, input.extractionId));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'clause_extraction.accepted',
        details: {
          extractionId: input.extractionId,
          clauseId: created!.id,
          sourceTemplateId: ext.sourceTemplateId,
        },
      });
      // Fire an embed for the new clause too — uses the same content
      // hash machinery as PR #3. Note: we don't have a clauses entity
      // type in the embed enqueuer yet; embedding will happen via the
      // clauses-table backfill cron when added. For now, a one-off
      // direct embed call would also work; deferring to follow-up.
      void enqueueEmbedContent;
      return { clauseId: created!.id };
    }),

  dismissExtraction: adminProcedure
    .input(
      z.object({
        extractionId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ext = await ctx.db.query.clauseExtractions.findFirst({
        where: eq(clauseExtractions.id, input.extractionId),
      });
      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extraction not found.' });
      }
      await ctx.db
        .update(clauseExtractions)
        .set({
          status: 'dismissed',
          actionedById: ctx.user.id,
          actionedAt: new Date(),
        })
        .where(eq(clauseExtractions.id, input.extractionId));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'clause_extraction.dismissed',
        details: { extractionId: input.extractionId, reason: input.reason },
      });
      return { dismissed: true };
    }),

  // Manual + bulk extraction trigger. Pass a single template_id to
  // re-extract one, or omit to enqueue extraction for all active
  // templates without prior pending extractions.
  enqueueExtraction: adminProcedure
    .input(
      z
        .object({
          templateId: z.string().uuid().optional(),
        })
        .default({}),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      let toExtract: Array<{ id: string }> = [];
      if (input.templateId) {
        toExtract = [{ id: input.templateId }];
      } else {
        // All active templates that don't already have pending extractions.
        const rows = await db.execute(sql`
          SELECT t.id
          FROM templates t
          WHERE t.is_active = true
            AND NOT EXISTS (
              SELECT 1 FROM clause_extractions ce
              WHERE ce.source_template_id = t.id AND ce.status = 'pending'
            )
        `);
        toExtract = (rows as unknown as Array<{ id: string }>).map((r) => ({
          id: r.id,
        }));
      }
      let enqueued = 0;
      for (const t of toExtract) {
        await db.insert(jobs).values({
          kind: 'extract_template_clauses',
          payload: { template_id: t.id },
        });
        enqueued += 1;
      }
      await db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'clause_extraction.enqueued',
        details: { count: enqueued, templateId: input.templateId ?? null },
      });
      return { enqueued };
    }),
});
