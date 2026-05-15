import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  matters,
  matterNotes,
  matterEvents,
  users,
  auditLog,
  jobs,
  playbooks,
  rules,
  type Matter,
} from '@legal/db';
import { MatterStatusSchema, PracticeAreaSchema, PrioritySchema } from '@legal/types';
import { protectedProcedure, staffProcedure, router } from '../trpc.js';
import { TRPCError } from '@trpc/server';

const ListInput = z
  .object({
    status: MatterStatusSchema.optional(),
    practiceArea: PracticeAreaSchema.optional(),
    assigneeId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .default({});

const STATUS_LABEL: Record<string, string> = {
  open: 'open',
  in_review: 'in review',
  waiting_on_requester: 'waiting on requester',
  waiting_on_third_party: 'waiting on third party',
  closed: 'closed',
  cancelled: 'cancelled',
};

export const mattersRouter = router({
  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    const conditions = [];
    if (input.status) conditions.push(eq(matters.status, input.status));
    if (input.practiceArea) conditions.push(eq(matters.practiceArea, input.practiceArea));
    if (input.assigneeId) conditions.push(eq(matters.assigneeId, input.assigneeId));

    return ctx.db
      .select({
        id: matters.id,
        shortId: matters.shortId,
        title: matters.title,
        status: matters.status,
        priority: matters.priority,
        practiceArea: matters.practiceArea,
        assigneeId: matters.assigneeId,
        assigneeName: users.name,
        slaDueAt: matters.slaDueAt,
        createdAt: matters.createdAt,
      })
      .from(matters)
      .leftJoin(users, eq(matters.assigneeId, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(matters.createdAt))
      .limit(input.limit);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.id),
        with: {
          requester: true,
          assignee: true,
          counterparty: true,
          notes: { orderBy: [desc(matterNotes.createdAt)] },
          events: { orderBy: [desc(matterEvents.createdAt)], limit: 50 },
          attachments: true,
        },
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND' });
      return matter;
    }),

  addNote: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), body: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [note] = await ctx.db
        .insert(matterNotes)
        .values({
          matterId: input.matterId,
          body: input.body,
          authorId: ctx.user.id,
          source: 'web',
        })
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'note.added',
        payload: { noteId: note?.id, source: 'web' },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'note.added',
        details: { noteId: note?.id },
      });
      return note;
    }),

  setStatus: staffProcedure
    .input(z.object({ matterId: z.string().uuid(), status: MatterStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      const closedAt = input.status === 'closed' ? new Date() : null;
      const [updated] = await ctx.db
        .update(matters)
        .set({
          status: input.status,
          closedAt,
          updatedAt: new Date(),
        })
        .where(eq(matters.id, input.matterId))
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'status.changed',
        payload: { status: input.status },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'matter.status_changed',
        details: { status: input.status },
      });
      if (updated?.slackChannelId) {
        await ctx.db.insert(jobs).values({
          kind: 'slack_notify',
          matterId: updated.id,
          payload: {
            matter_id: updated.id,
            text: `Status changed to *${STATUS_LABEL[input.status] ?? input.status}* by ${ctx.user.name}.`,
          },
        });
      }
      if (input.status === 'closed' && updated?.counterpartyId) {
        await ctx.db.insert(jobs).values({
          kind: 'enrich_counterparty_memory',
          matterId: updated.id,
          payload: { counterparty_id: updated.counterpartyId },
        });
      }
      // M7 follow-up — on-close trigger. Always enqueue; the worker
      // handler honors M7_ENABLED and short-circuits with
      // skipped='disabled' if M7 is off. Cheaper than mirroring the
      // env flag on the web side.
      if (input.status === 'closed' && updated) {
        await ctx.db.insert(jobs).values({
          kind: 'mine_playbook_edits',
          matterId: updated.id,
          payload: { matter_id: updated.id },
        });
      }
      return updated;
    }),

  assign: staffProcedure
    .input(z.object({ matterId: z.string().uuid(), assigneeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(matters)
        .set({ assigneeId: input.assigneeId, updatedAt: new Date() })
        .where(eq(matters.id, input.matterId))
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'assigned',
        payload: { assigneeId: input.assigneeId },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'matter.assigned',
        details: { assigneeId: input.assigneeId },
      });
      return updated;
    }),

  archiveSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().optional(),
        practiceArea: PracticeAreaSchema.optional(),
        counterpartyId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(matters.status, 'closed')];
      if (input.practiceArea) conditions.push(eq(matters.practiceArea, input.practiceArea));
      if (input.counterpartyId) conditions.push(eq(matters.counterpartyId, input.counterpartyId));

      if (!input.query || input.query.trim().length === 0) {
        return ctx.db
          .select({
            id: matters.id,
            shortId: matters.shortId,
            title: matters.title,
            summary: matters.summary,
            practiceArea: matters.practiceArea,
            priority: matters.priority,
            closedAt: matters.closedAt,
            counterpartyId: matters.counterpartyId,
          })
          .from(matters)
          .where(and(...conditions))
          .orderBy(desc(matters.closedAt))
          .limit(input.limit);
      }

      const searchText = input.query.slice(0, 500);
      const result = await ctx.db.execute(sql`
        SELECT id, short_id, title, summary, practice_area, priority, closed_at, counterparty_id,
          ts_rank(
            to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '') || ' ' || coalesce(summary, '')),
            plainto_tsquery('english', ${searchText})
          ) as rank
        FROM matters
        WHERE status = 'closed'
          ${input.practiceArea ? sql`AND practice_area = ${input.practiceArea}` : sql``}
          ${input.counterpartyId ? sql`AND counterparty_id = ${input.counterpartyId}` : sql``}
          AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '') || ' ' || coalesce(summary, ''))
              @@ plainto_tsquery('english', ${searchText})
        ORDER BY rank DESC, closed_at DESC NULLS LAST
        LIMIT ${input.limit}
      `);
      return result as unknown as Array<{
        id: string;
        short_id: string;
        title: string;
        summary: string | null;
        practice_area: string | null;
        priority: string | null;
        closed_at: string | null;
        counterparty_id: string | null;
      }>;
    }),

  similarMatters: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = (await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
      })) as Matter | undefined;
      if (!matter) return [];

      // Prefer pgvector cosine similarity when both source and candidates
      // have embeddings. Fall back to tsvector when the source embedding is
      // missing (e.g. just-created matter, embedding job pending, or
      // OPENAI_API_KEY not set on the worker).
      if (matter.embedding) {
        const embeddingStr = `[${(matter.embedding as number[]).join(',')}]`;
        const results = await ctx.db.execute(sql`
          SELECT id, short_id, title, summary, practice_area, priority, closed_at,
                 round((1 - (embedding <=> ${embeddingStr}::vector))::numeric, 3) as similarity
          FROM matters
          WHERE id != ${input.matterId}
            AND embedding IS NOT NULL
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT 5
        `);
        const rows = results as unknown as Array<{
          id: string;
          short_id: string;
          title: string;
          summary: string | null;
          practice_area: string | null;
          priority: string | null;
          closed_at: string | null;
          similarity: number;
        }>;
        if (rows.length > 0) return rows;
      }

      // tsvector fallback — same shape as the pgvector path but populates
      // `similarity` from ts_rank (different absolute range, but ordering
      // is preserved). UI treats both as opaque relevance scores.
      const searchText = matter.requestText.slice(0, 500);
      const results = await ctx.db.execute(sql`
        SELECT id, short_id, title, summary, practice_area, priority, closed_at,
               round(ts_rank(
                 to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '')),
                 plainto_tsquery('english', ${searchText})
               )::numeric, 3) as similarity
        FROM matters
        WHERE id != ${input.matterId}
          AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, ''))
              @@ plainto_tsquery('english', ${searchText})
        ORDER BY similarity DESC
        LIMIT 5
      `);
      return results as unknown as Array<{
        id: string;
        short_id: string;
        title: string;
        summary: string | null;
        practice_area: string | null;
        priority: string | null;
        closed_at: string | null;
        similarity: number;
      }>;
    }),

  relevantPlaybooks: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
      });
      if (!matter?.practiceArea) {
        return [];
      }
      return ctx.db
        .select()
        .from(playbooks)
        .where(
          and(eq(playbooks.practiceArea, matter.practiceArea), eq(playbooks.isActive, true)),
        )
        .orderBy(asc(playbooks.title));
    }),

  myQueue: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(matters)
      .where(
        and(
          eq(matters.assigneeId, ctx.user.id),
          sql`${matters.status} not in ('closed', 'cancelled')`,
        ),
      )
      .orderBy(desc(matters.createdAt));
  }),

  // PR #5 — Rule firings explainability. Reads audit_log for the
  // existing rule-match events written by the worker triage handler
  // (matter.sla_rule_matched, matter.routing_rule_matched), joins to
  // the rules table for human-readable name + naturalText, and returns
  // a list with override status from any matter.rule_overridden events.
  ruleFirings: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const RULE_FIRE_ACTIONS = [
        'matter.sla_rule_matched',
        'matter.routing_rule_matched',
        'matter.routing_default_used',
        'matter.triage_rule_matched',
      ];
      const fires = await ctx.db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.matterId, input.matterId),
            inArray(auditLog.action, RULE_FIRE_ACTIONS),
          ),
        )
        .orderBy(asc(auditLog.createdAt));

      const overrides = await ctx.db
        .select({ details: auditLog.details, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.matterId, input.matterId),
            eq(auditLog.action, 'matter.rule_overridden'),
          ),
        )
        .orderBy(desc(auditLog.createdAt));

      // Resolve rule names + natural text in one batched query.
      const ruleIds = Array.from(
        new Set(
          fires
            .map((f) => (f.details as Record<string, unknown> | null)?.['ruleId'] as string | undefined)
            .filter((v): v is string => typeof v === 'string'),
        ),
      );
      const ruleRows =
        ruleIds.length > 0
          ? await ctx.db
              .select({
                id: rules.id,
                name: rules.name,
                kind: rules.kind,
                naturalText: rules.naturalText,
                status: rules.status,
              })
              .from(rules)
              .where(inArray(rules.id, ruleIds))
          : [];
      const ruleMap = new Map(ruleRows.map((r) => [r.id, r] as const));

      // Index overrides by firing audit_log.id (they reference each
      // other via details.firingId).
      const overrideByFiringId = new Map<string, { reason: string | null; at: Date }>();
      for (const o of overrides) {
        const details = (o.details as Record<string, unknown> | null) ?? {};
        const firingId = details['firingId'] as string | undefined;
        if (firingId) {
          overrideByFiringId.set(firingId, {
            reason: (details['reason'] as string | null) ?? null,
            at: o.createdAt,
          });
        }
      }

      return fires.map((f) => {
        const details = (f.details as Record<string, unknown> | null) ?? {};
        const ruleId = details['ruleId'] as string | undefined;
        const rule = ruleId ? ruleMap.get(ruleId) ?? null : null;
        const override = overrideByFiringId.get(f.id) ?? null;
        return {
          firingId: f.id,
          action: f.action,
          firedAt: f.createdAt,
          rule,
          details,
          override,
        };
      });
    }),

  // PR #5 — Mark a rule firing as having produced the wrong outcome.
  // Doesn't undo the rule's effect (the lawyer separately fixes the
  // matter via reassignment / priority change). The override audit
  // entry is the signal a future rule-quality cron uses to flag rules
  // with high override rates as candidates for demotion.
  overrideRuleFiring: staffProcedure
    .input(
      z.object({
        firingId: z.string().uuid(),
        matterId: z.string().uuid(),
        reason: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const firing = await ctx.db.query.auditLog.findFirst({
        where: eq(auditLog.id, input.firingId),
      });
      if (!firing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Firing not found.' });
      }
      const details = (firing.details as Record<string, unknown> | null) ?? {};
      const ruleId = details['ruleId'] as string | undefined;
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'matter.rule_overridden',
        details: {
          firingId: input.firingId,
          ruleId,
          firingAction: firing.action,
          reason: input.reason,
        },
      });
      return { recorded: true };
    }),
});
