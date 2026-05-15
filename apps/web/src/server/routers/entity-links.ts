import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import {
  auditLog,
  entityLinks,
  entityLinkKind,
  entityLinkRelationship,
  knowledgeArticles,
  playbooks,
  rules,
  templates,
  executionPatterns,
  matters,
  users,
  type Db,
} from '@legal/db';
import { staffProcedure, adminProcedure, router } from '../trpc.js';

const EntityKindSchema = z.enum(entityLinkKind.enumValues);
const RelationshipSchema = z.enum(entityLinkRelationship.enumValues);

// Lightweight projection used by the link picker + "linked items"
// panel. Each entity is reduced to a uniform shape so the UI can
// render any kind in one component.
export interface EntityRef {
  type: (typeof entityLinkKind.enumValues)[number];
  id: string;
  title: string;
  subtitle: string | null;
}

async function resolveEntityRefs(
  db: Db,
  refs: Array<{ type: EntityRef['type']; id: string }>,
): Promise<Record<string, EntityRef>> {
  // Bucket by type so each table is queried once.
  const byType = new Map<EntityRef['type'], string[]>();
  for (const r of refs) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type)!.push(r.id);
  }
  const out: Record<string, EntityRef> = {};
  const key = (type: string, id: string) => `${type}:${id}`;

  for (const [type, ids] of byType) {
    if (ids.length === 0) continue;
    if (type === 'playbook') {
      const rows = await db
        .select({ id: playbooks.id, title: playbooks.title, area: playbooks.practiceArea })
        .from(playbooks)
        .where(inArray(playbooks.id, ids));
      for (const r of rows) {
        out[key(type, r.id)] = { type, id: r.id, title: r.title, subtitle: r.area };
      }
    } else if (type === 'knowledge_article') {
      const rows = await db
        .select({
          id: knowledgeArticles.id,
          title: knowledgeArticles.title,
          area: knowledgeArticles.practiceArea,
        })
        .from(knowledgeArticles)
        .where(inArray(knowledgeArticles.id, ids));
      for (const r of rows) {
        out[key(type, r.id)] = { type, id: r.id, title: r.title, subtitle: r.area };
      }
    } else if (type === 'rule') {
      const rows = await db
        .select({ id: rules.id, title: rules.name, kind: rules.kind })
        .from(rules)
        .where(inArray(rules.id, ids));
      for (const r of rows) {
        out[key(type, r.id)] = { type, id: r.id, title: r.title, subtitle: r.kind };
      }
    } else if (type === 'template') {
      const rows = await db
        .select({
          id: templates.id,
          title: templates.name,
          area: templates.practiceArea,
        })
        .from(templates)
        .where(inArray(templates.id, ids));
      for (const r of rows) {
        out[key(type, r.id)] = { type, id: r.id, title: r.title, subtitle: r.area };
      }
    } else if (type === 'execution_pattern') {
      const rows = await db
        .select({
          id: executionPatterns.id,
          title: executionPatterns.name,
          area: executionPatterns.practiceArea,
        })
        .from(executionPatterns)
        .where(inArray(executionPatterns.id, ids));
      for (const r of rows) {
        out[key(type, r.id)] = { type, id: r.id, title: r.title, subtitle: r.area };
      }
    } else if (type === 'matter') {
      const rows = await db
        .select({
          id: matters.id,
          title: matters.title,
          shortId: matters.shortId,
        })
        .from(matters)
        .where(inArray(matters.id, ids));
      for (const r of rows) {
        out[key(type, r.id)] = { type, id: r.id, title: r.title, subtitle: r.shortId };
      }
    }
  }
  return out;
}

export const entityLinksRouter = router({
  // List all links touching one entity. Default returns both directions
  // (links where this entity is the source, and links where it's the
  // target). The UI typically wants both — "what does this point to"
  // and "what points to this" — so they're returned in two arrays.
  list: staffProcedure
    .input(
      z.object({
        entityType: EntityKindSchema,
        entityId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const rows = await db
        .select({
          id: entityLinks.id,
          sourceType: entityLinks.sourceType,
          sourceId: entityLinks.sourceId,
          targetType: entityLinks.targetType,
          targetId: entityLinks.targetId,
          relationship: entityLinks.relationship,
          note: entityLinks.note,
          createdAt: entityLinks.createdAt,
          createdByName: users.name,
        })
        .from(entityLinks)
        .leftJoin(users, eq(entityLinks.createdById, users.id))
        .where(
          or(
            and(
              eq(entityLinks.sourceType, input.entityType),
              eq(entityLinks.sourceId, input.entityId),
            ),
            and(
              eq(entityLinks.targetType, input.entityType),
              eq(entityLinks.targetId, input.entityId),
            ),
          ),
        )
        .orderBy(desc(entityLinks.createdAt))
        .limit(200);

      // Resolve titles for the "other side" of each link in one pass.
      const refs = rows.map((r) =>
        r.sourceType === input.entityType && r.sourceId === input.entityId
          ? { type: r.targetType, id: r.targetId }
          : { type: r.sourceType, id: r.sourceId },
      );
      const refMap = await resolveEntityRefs(db, refs);
      const key = (t: string, i: string) => `${t}:${i}`;

      const outgoing: Array<typeof rows[number] & { other: EntityRef | null }> = [];
      const incoming: Array<typeof rows[number] & { other: EntityRef | null }> = [];
      for (const r of rows) {
        const isOutgoing =
          r.sourceType === input.entityType && r.sourceId === input.entityId;
        const otherType = isOutgoing ? r.targetType : r.sourceType;
        const otherId = isOutgoing ? r.targetId : r.sourceId;
        const enriched = { ...r, other: refMap[key(otherType, otherId)] ?? null };
        (isOutgoing ? outgoing : incoming).push(enriched);
      }
      return { outgoing, incoming };
    }),

  // Search across all linkable entity types. Used by the link picker.
  // Results are ranked roughly by name match — keyword-only for now;
  // PR #3 will add semantic search across the same surface.
  search: staffProcedure
    .input(
      z.object({
        query: z.string().min(1).max(120),
        kinds: z.array(EntityKindSchema).optional(),
        limit: z.number().int().min(1).max(40).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const q = `%${input.query}%`;
      const wanted = new Set(input.kinds ?? entityLinkKind.enumValues);
      const out: EntityRef[] = [];

      if (wanted.has('playbook')) {
        const rows = await db
          .select({ id: playbooks.id, title: playbooks.title, area: playbooks.practiceArea })
          .from(playbooks)
          .where(ilike(playbooks.title, q))
          .limit(input.limit);
        for (const r of rows) {
          out.push({ type: 'playbook', id: r.id, title: r.title, subtitle: r.area });
        }
      }
      if (wanted.has('knowledge_article')) {
        const rows = await db
          .select({
            id: knowledgeArticles.id,
            title: knowledgeArticles.title,
            area: knowledgeArticles.practiceArea,
          })
          .from(knowledgeArticles)
          .where(ilike(knowledgeArticles.title, q))
          .limit(input.limit);
        for (const r of rows) {
          out.push({ type: 'knowledge_article', id: r.id, title: r.title, subtitle: r.area });
        }
      }
      if (wanted.has('rule')) {
        const rows = await db
          .select({ id: rules.id, title: rules.name, kind: rules.kind })
          .from(rules)
          .where(ilike(rules.name, q))
          .limit(input.limit);
        for (const r of rows) {
          out.push({ type: 'rule', id: r.id, title: r.title, subtitle: r.kind });
        }
      }
      if (wanted.has('template')) {
        const rows = await db
          .select({
            id: templates.id,
            title: templates.name,
            area: templates.practiceArea,
          })
          .from(templates)
          .where(ilike(templates.name, q))
          .limit(input.limit);
        for (const r of rows) {
          out.push({ type: 'template', id: r.id, title: r.title, subtitle: r.area });
        }
      }
      if (wanted.has('execution_pattern')) {
        const rows = await db
          .select({
            id: executionPatterns.id,
            title: executionPatterns.name,
            area: executionPatterns.practiceArea,
          })
          .from(executionPatterns)
          .where(ilike(executionPatterns.name, q))
          .limit(input.limit);
        for (const r of rows) {
          out.push({ type: 'execution_pattern', id: r.id, title: r.title, subtitle: r.area });
        }
      }
      if (wanted.has('matter')) {
        const rows = await db
          .select({
            id: matters.id,
            title: matters.title,
            shortId: matters.shortId,
          })
          .from(matters)
          .where(or(ilike(matters.title, q), ilike(matters.shortId, q))!)
          .limit(input.limit);
        for (const r of rows) {
          out.push({ type: 'matter', id: r.id, title: r.title, subtitle: r.shortId });
        }
      }
      return out.slice(0, input.limit);
    }),

  create: staffProcedure
    .input(
      z.object({
        sourceType: EntityKindSchema,
        sourceId: z.string().uuid(),
        targetType: EntityKindSchema,
        targetId: z.string().uuid(),
        relationship: RelationshipSchema,
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An entity cannot link to itself.',
        });
      }
      try {
        const [created] = await db
          .insert(entityLinks)
          .values({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            targetType: input.targetType,
            targetId: input.targetId,
            relationship: input.relationship,
            note: input.note,
            createdById: ctx.user.id,
          })
          .returning();
        await db.insert(auditLog).values({
          actorId: ctx.user.id,
          action: 'entity_link.created',
          details: {
            id: created?.id,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            targetType: input.targetType,
            targetId: input.targetId,
            relationship: input.relationship,
          },
        });
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('entity_links_unique_idx')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This link already exists.',
          });
        }
        throw err;
      }
    }),

  // Admin-only deletion. Lawyers can build the link graph but can't
  // prune it — keeps the audit trail clean and prevents accidental
  // destruction of cross-references the rest of the system depends on.
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;
      const existing = await db.query.entityLinks.findFirst({
        where: eq(entityLinks.id, input.id),
      });
      if (!existing) return { deleted: false };
      await db.delete(entityLinks).where(eq(entityLinks.id, input.id));
      await db.insert(auditLog).values({
        actorId: ctx.user.id,
        action: 'entity_link.deleted',
        details: {
          id: input.id,
          sourceType: existing.sourceType,
          sourceId: existing.sourceId,
          targetType: existing.targetType,
          targetId: existing.targetId,
          relationship: existing.relationship,
        },
      });
      return { deleted: true };
    }),
});
