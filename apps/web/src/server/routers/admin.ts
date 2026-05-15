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
  playbookPositions,
  executionPatterns,
  knowledgeArticles,
  systemInsights,
  jobs,
  counterparties,
  entityAliases,
} from '@legal/db';
import { PracticeAreaSchema } from '@legal/types';
import { adminProcedure, router } from '../trpc.js';
import { env } from '@/env';
import { enqueueEmbedContent } from '../lib/embed-enqueue.js';

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
        if (updated) await enqueueEmbedContent(ctx.db, 'playbook', updated.id);
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
      if (created) await enqueueEmbedContent(ctx.db, 'playbook', created.id);
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
        if (updated) await enqueueEmbedContent(ctx.db, 'knowledge_article', updated.id);
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
      if (created) await enqueueEmbedContent(ctx.db, 'knowledge_article', created.id);
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

  // Enqueue generate_embedding jobs for every matter that doesn't yet have
  // one. Used to backfill the corpus after first wiring up OPENAI_API_KEY,
  // or to re-embed after model upgrades. Idempotent — re-running only
  // touches matters whose embedding is still NULL.
  backfillEmbeddings: adminProcedure
    .input(
      z
        .object({ force: z.boolean().default(false) })
        .default({}),
    )
    .mutation(async ({ ctx, input }) => {
      const candidates = await ctx.db.execute(sql`
        SELECT id FROM matters
        WHERE ${input.force ? sql`TRUE` : sql`embedding IS NULL`}
        ORDER BY created_at DESC
      `);
      const ids = (candidates as unknown as Array<{ id: string }>).map((r) => r.id);

      for (const id of ids) {
        await ctx.db.insert(jobs).values({
          kind: 'generate_embedding',
          matterId: id,
          payload: { matter_id: id },
        });
      }

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'embeddings.backfill_enqueued',
        details: { matterCount: ids.length, force: input.force },
      });

      return { enqueued: ids.length };
    }),

  // Embedding coverage stats — surfaces to the admin UI to show "how much
  // of the corpus is searchable by semantic similarity right now."
  embeddingsStatus: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS with_embedding,
        COUNT(*) FILTER (WHERE embedding IS NULL) AS without_embedding,
        COUNT(*) AS total
      FROM matters
    `);
    const row = (result as unknown as Array<{
      with_embedding: number | string;
      without_embedding: number | string;
      total: number | string;
    }>)[0];
    return {
      withEmbedding: Number(row?.with_embedding ?? 0),
      withoutEmbedding: Number(row?.without_embedding ?? 0),
      total: Number(row?.total ?? 0),
    };
  }),

  // Lists counterparties with their alias counts and matter counts. Used
  // by the admin entity-resolution UI to find merge candidates.
  listCounterpartiesWithAliases: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.domain,
        c.salesforce_account_id,
        (SELECT count(*)::int FROM matters m WHERE m.counterparty_id = c.id) AS matter_count,
        (SELECT count(*)::int FROM entity_aliases ea WHERE ea.counterparty_id = c.id) AS alias_count,
        (SELECT json_agg(json_build_object('text', ea.alias_text, 'source', ea.alias_source))
         FROM entity_aliases ea WHERE ea.counterparty_id = c.id) AS aliases
      FROM counterparties c
      ORDER BY matter_count DESC, c.name ASC
    `);
    return (
      rows as unknown as Array<{
        id: string;
        name: string;
        domain: string | null;
        salesforce_account_id: string | null;
        matter_count: number;
        alias_count: number;
        aliases: Array<{ text: string; source: string }> | null;
      }>
    ).map((r) => ({
      ...r,
      aliases: r.aliases ?? [],
    }));
  }),

  // Merge sourceId into targetId. Moves all matters, all aliases, then
  // deletes the source row. Records the merge as an alias on the target
  // so the source's name survives in entity history.
  mergeCounterparties: adminProcedure
    .input(
      z.object({
        targetId: z.string().uuid(),
        sourceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetId === input.sourceId) {
        return { merged: false, reason: 'same counterparty' };
      }

      const source = await ctx.db.query.counterparties.findFirst({
        where: eq(counterparties.id, input.sourceId),
      });
      if (!source) return { merged: false, reason: 'source not found' };

      const target = await ctx.db.query.counterparties.findFirst({
        where: eq(counterparties.id, input.targetId),
      });
      if (!target) return { merged: false, reason: 'target not found' };

      // Move matters to target
      const moved = await ctx.db
        .update(matters)
        .set({ counterpartyId: input.targetId, updatedAt: new Date() })
        .where(eq(matters.counterpartyId, input.sourceId))
        .returning({ id: matters.id });

      // Move aliases to target (ignoring conflicts on duplicate alias_text)
      await ctx.db.execute(sql`
        INSERT INTO entity_aliases (counterparty_id, alias_text, alias_source, confidence)
        SELECT ${input.targetId}, alias_text, alias_source, confidence
        FROM entity_aliases
        WHERE counterparty_id = ${input.sourceId}
        ON CONFLICT (counterparty_id, alias_text) DO NOTHING
      `);

      // Preserve the source's canonical name as an alias on the target
      await ctx.db
        .insert(entityAliases)
        .values({
          counterpartyId: input.targetId,
          aliasText: source.name,
          aliasSource: 'manual_merge',
        })
        .onConflictDoNothing();

      // Delete the source row (cascade clears its aliases)
      await ctx.db.delete(counterparties).where(eq(counterparties.id, input.sourceId));

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'counterparty.merged',
        details: {
          targetId: input.targetId,
          sourceId: input.sourceId,
          sourceName: source.name,
          mattersReassigned: moved.length,
        },
      });

      return { merged: true, mattersReassigned: moved.length };
    }),

  listPlaybookPositions: adminProcedure
    .input(z.object({ playbookId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: playbookPositions.id,
          topic: playbookPositions.topic,
          trigger: playbookPositions.trigger,
          standardPosition: playbookPositions.standardPosition,
          acceptableRange: playbookPositions.acceptableRange,
          flaggedConditions: playbookPositions.flaggedConditions,
          suggestedRedline: playbookPositions.suggestedRedline,
          citation: playbookPositions.citation,
          isActive: playbookPositions.isActive,
          createdAt: playbookPositions.createdAt,
          updatedAt: playbookPositions.updatedAt,
        })
        .from(playbookPositions)
        .where(eq(playbookPositions.playbookId, input.playbookId))
        .orderBy(asc(playbookPositions.topic));
    }),

  upsertPlaybookPosition: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        playbookId: z.string().uuid(),
        topic: z.string().min(1).max(120),
        trigger: z.string().min(1),
        standardPosition: z.string().min(1),
        acceptableRange: z.string().optional(),
        flaggedConditions: z.string().optional(),
        suggestedRedline: z.string().optional(),
        citation: z.string().optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = {
        playbookId: input.playbookId,
        topic: input.topic,
        trigger: input.trigger,
        standardPosition: input.standardPosition,
        acceptableRange: input.acceptableRange,
        flaggedConditions: input.flaggedConditions,
        suggestedRedline: input.suggestedRedline,
        citation: input.citation,
        isActive: input.isActive,
        updatedAt: new Date(),
      };
      let result;
      if (input.id) {
        const [updated] = await ctx.db
          .update(playbookPositions)
          .set(data)
          .where(eq(playbookPositions.id, input.id))
          .returning();
        result = updated;
      } else {
        const [created] = await ctx.db
          .insert(playbookPositions)
          .values({ ...data, createdById: ctx.user.id })
          .returning();
        result = created;
      }

      // G4: compile the trigger NL into DSL for the analyze-clause
      // pre-filter. Best-effort — failures don't block the save (the
      // clause analyzer falls back to LLM-only matching). Sync call
      // adds ~1-3s to the save; tolerable for position authoring rate.
      if (result?.id && (input.trigger || input.flaggedConditions)) {
        try {
          const compileBody =
            `${input.trigger}` +
            (input.flaggedConditions ? `\n\nFlagged conditions: ${input.flaggedConditions}` : '');
          const compileRes = await fetch(`${env.AI_SERVICE_URL}/compile-rule`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(env.AI_SERVICE_TOKEN
                ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` }
                : {}),
            },
            body: JSON.stringify({
              rule_id: result.id,
              kind: 'playbook_trigger',
              natural_text: compileBody,
              scope: { topic: input.topic },
            }),
          });
          if (compileRes.ok) {
            const compiled = (await compileRes.json()) as {
              compiled: Record<string, unknown>;
              compiler_version: string;
            };
            await ctx.db
              .update(playbookPositions)
              .set({
                compiledTrigger: compiled.compiled,
                compilerVersion: compiled.compiler_version,
                compiledAt: new Date(),
                compileError: null,
              })
              .where(eq(playbookPositions.id, result.id));
          } else {
            const body = await compileRes.text();
            await ctx.db
              .update(playbookPositions)
              .set({
                compileError: `${compileRes.status} ${body.slice(0, 300)}`,
                compiledAt: new Date(),
              })
              .where(eq(playbookPositions.id, result.id));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await ctx.db
            .update(playbookPositions)
            .set({ compileError: message.slice(0, 500), compiledAt: new Date() })
            .where(eq(playbookPositions.id, result.id));
        }
      }

      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'playbook_position.upserted',
        details: { playbookId: input.playbookId, topic: input.topic, id: result?.id },
      });
      return result;
    }),

  deletePlaybookPosition: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.playbookPositions.findFirst({
        where: eq(playbookPositions.id, input.id),
      });
      if (!existing) return { deleted: false };
      await ctx.db.delete(playbookPositions).where(eq(playbookPositions.id, input.id));
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'playbook_position.deleted',
        details: { playbookId: existing.playbookId, topic: existing.topic, id: input.id },
      });
      return { deleted: true };
    }),

  listExecutionPatterns: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(executionPatterns)
      .orderBy(asc(executionPatterns.practiceArea), asc(executionPatterns.name));
  }),

  upsertExecutionPattern: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        practiceArea: PracticeAreaSchema,
        matterType: z.string().optional(),
        inputType: z.enum(['document', 'fact_pattern', 'checklist', 'content']),
        outputFormat: z.enum([
          'tagged_clauses',
          'issue_memo',
          'claim_matrix',
          'gap_report',
          'risk_assessment',
          'rewrite_pairs',
          'action_checklist',
        ]),
        name: z.string().min(1).max(120),
        description: z.string().optional(),
        promptTemplate: z.string().min(1),
        outputSchema: z.record(z.string(), z.unknown()).default({}),
        isDefault: z.boolean().default(false),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = {
        practiceArea: input.practiceArea,
        matterType: input.matterType,
        inputType: input.inputType,
        outputFormat: input.outputFormat,
        name: input.name,
        description: input.description,
        promptTemplate: input.promptTemplate,
        outputSchema: input.outputSchema,
        isDefault: input.isDefault,
        isActive: input.isActive,
        updatedAt: new Date(),
      };
      let result;
      if (input.id) {
        const [updated] = await ctx.db
          .update(executionPatterns)
          .set(data)
          .where(eq(executionPatterns.id, input.id))
          .returning();
        result = updated;
      } else {
        const [created] = await ctx.db
          .insert(executionPatterns)
          .values({ ...data, createdById: ctx.user.id })
          .returning();
        result = created;
      }
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'execution_pattern.upserted',
        details: {
          id: result?.id,
          practiceArea: input.practiceArea,
          outputFormat: input.outputFormat,
        },
      });
      if (result) await enqueueEmbedContent(ctx.db, 'execution_pattern', result.id);
      return result;
    }),
});
