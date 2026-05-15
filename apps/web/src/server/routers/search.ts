import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { staffProcedure, router } from '../trpc.js';
import { embedQuery, vectorLiteral } from '../lib/embed-query.js';
import { entityLinkKind } from '@legal/db';

// Global cross-table semantic search powering the ⌘K palette.
// Returns top results from each of the five content tables ranked
// by cosine distance against the query embedding.
//
// Falls back to keyword matching when Voyage isn't available or no
// embedded rows match. Each result carries the entity_type so the UI
// can route the click to the right detail surface.

const EntityKindSchema = z.enum(entityLinkKind.enumValues);

export interface GlobalResult {
  type:
    | 'playbook'
    | 'knowledge_article'
    | 'rule'
    | 'template'
    | 'execution_pattern'
    | 'matter';
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  rank: number;
  backend: 'embedding' | 'keyword';
}

export const searchRouter = router({
  global: staffProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        kinds: z.array(EntityKindSchema).optional(),
        perKindLimit: z.number().int().min(1).max(10).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const wanted = new Set(input.kinds ?? entityLinkKind.enumValues);
      const queryEmbedding = await embedQuery(input.query);
      const qLiteral = queryEmbedding ? vectorLiteral(queryEmbedding) : null;
      const limit = input.perKindLimit;
      const out: GlobalResult[] = [];
      const kw = `%${input.query.replaceAll('%', '\\%')}%`;

      async function semanticOrKeyword(
        kind: GlobalResult['type'],
        semanticSql: ReturnType<typeof sql>,
        keywordSql: ReturnType<typeof sql>,
      ): Promise<void> {
        if (qLiteral) {
          const rows = await db.execute(semanticSql);
          for (const r of rows as unknown as Array<{
            id: string;
            title: string;
            subtitle: string | null;
            snippet: string | null;
            rank: number;
          }>) {
            out.push({ ...r, type: kind, backend: 'embedding' });
          }
          if ((rows as unknown as unknown[]).length > 0) return;
        }
        const rows = await db.execute(keywordSql);
        for (const r of rows as unknown as Array<{
          id: string;
          title: string;
          subtitle: string | null;
          snippet: string | null;
        }>) {
          out.push({ ...r, type: kind, rank: 0, backend: 'keyword' });
        }
      }

      if (wanted.has('playbook')) {
        await semanticOrKeyword(
          'playbook',
          sql`
            SELECT id, title,
              practice_area::text AS subtitle,
              substring(body, 1, 160) AS snippet,
              1 - (embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}) AS rank
            FROM playbooks
            WHERE is_active = true AND embedding IS NOT NULL
            ORDER BY embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}
            LIMIT ${limit}
          `,
          sql`
            SELECT id, title,
              practice_area::text AS subtitle,
              substring(body, 1, 160) AS snippet
            FROM playbooks
            WHERE is_active = true AND (title ILIKE ${kw} OR body ILIKE ${kw})
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `,
        );
      }
      if (wanted.has('knowledge_article')) {
        await semanticOrKeyword(
          'knowledge_article',
          sql`
            SELECT id, title,
              practice_area::text AS subtitle,
              substring(body, 1, 160) AS snippet,
              1 - (embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}) AS rank
            FROM knowledge_articles
            WHERE is_active = true AND embedding IS NOT NULL
            ORDER BY embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}
            LIMIT ${limit}
          `,
          sql`
            SELECT id, title,
              practice_area::text AS subtitle,
              substring(body, 1, 160) AS snippet
            FROM knowledge_articles
            WHERE is_active = true AND (title ILIKE ${kw} OR body ILIKE ${kw})
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `,
        );
      }
      if (wanted.has('rule')) {
        await semanticOrKeyword(
          'rule',
          sql`
            SELECT id, name AS title,
              kind::text AS subtitle,
              substring(natural_text, 1, 160) AS snippet,
              1 - (embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}) AS rank
            FROM rules
            WHERE status != 'archived' AND embedding IS NOT NULL
            ORDER BY embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}
            LIMIT ${limit}
          `,
          sql`
            SELECT id, name AS title,
              kind::text AS subtitle,
              substring(natural_text, 1, 160) AS snippet
            FROM rules
            WHERE status != 'archived' AND (name ILIKE ${kw} OR natural_text ILIKE ${kw})
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `,
        );
      }
      if (wanted.has('template')) {
        await semanticOrKeyword(
          'template',
          sql`
            SELECT id, name AS title,
              practice_area::text AS subtitle,
              substring(body, 1, 160) AS snippet,
              1 - (embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}) AS rank
            FROM templates
            WHERE is_active = true AND embedding IS NOT NULL
            ORDER BY embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}
            LIMIT ${limit}
          `,
          sql`
            SELECT id, name AS title,
              practice_area::text AS subtitle,
              substring(body, 1, 160) AS snippet
            FROM templates
            WHERE is_active = true AND (name ILIKE ${kw} OR body ILIKE ${kw})
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `,
        );
      }
      if (wanted.has('execution_pattern')) {
        await semanticOrKeyword(
          'execution_pattern',
          sql`
            SELECT id, name AS title,
              practice_area::text AS subtitle,
              substring(coalesce(description, prompt_template), 1, 160) AS snippet,
              1 - (embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}) AS rank
            FROM execution_patterns
            WHERE is_active = true AND embedding IS NOT NULL
            ORDER BY embedding <=> ${sql.raw(`'${qLiteral}'::vector`)}
            LIMIT ${limit}
          `,
          sql`
            SELECT id, name AS title,
              practice_area::text AS subtitle,
              substring(coalesce(description, prompt_template), 1, 160) AS snippet
            FROM execution_patterns
            WHERE is_active = true AND (name ILIKE ${kw} OR description ILIKE ${kw} OR prompt_template ILIKE ${kw})
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `,
        );
      }
      if (wanted.has('matter')) {
        // Matters use the M2 summary embedding when present, falling
        // back to the intake embedding (matters.embedding).
        await semanticOrKeyword(
          'matter',
          sql`
            SELECT m.id, m.title,
              m.short_id AS subtitle,
              substring(coalesce(m.summary, m.request_text), 1, 160) AS snippet,
              1 - (COALESCE(ms.summary_embedding, m.embedding) <=> ${sql.raw(`'${qLiteral}'::vector`)}) AS rank
            FROM matters m
            LEFT JOIN matter_summaries ms ON ms.matter_id = m.id
            WHERE COALESCE(ms.summary_embedding, m.embedding) IS NOT NULL
              AND m.status != 'cancelled'
            ORDER BY COALESCE(ms.summary_embedding, m.embedding) <=> ${sql.raw(`'${qLiteral}'::vector`)}
            LIMIT ${limit}
          `,
          sql`
            SELECT id, title,
              short_id AS subtitle,
              substring(coalesce(summary, request_text), 1, 160) AS snippet
            FROM matters
            WHERE status != 'cancelled' AND (title ILIKE ${kw} OR short_id ILIKE ${kw} OR request_text ILIKE ${kw})
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `,
        );
      }

      // Sort: results with embedding rank first by rank desc; keyword
      // results appended afterwards in DB-order.
      out.sort((a, b) => {
        if (a.backend === 'embedding' && b.backend === 'embedding') {
          return b.rank - a.rank;
        }
        if (a.backend === 'embedding') return -1;
        if (b.backend === 'embedding') return 1;
        return 0;
      });
      return { results: out, semantic: !!qLiteral };
    }),
});
