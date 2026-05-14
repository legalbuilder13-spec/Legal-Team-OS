import { eq, sql } from 'drizzle-orm';
import { matters, auditLog, type Db, type Job } from '@legal/db';
import {
  computeStaleAfter,
  type InsightCard,
  type InsightCardPrimaryField,
} from '@legal/types';

interface ContextFetchPayload {
  matter_id: string;
}

interface SimilarMatterRow {
  id: string;
  short_id: string;
  title: string | null;
  summary: string | null;
  practice_area: string | null;
  priority: string | null;
  status: string;
  closed_at: Date | null;
  rank: number;
  similarity_backend: 'embedding' | 'tsvector';
}

// Per-source sub-handler enqueued by the context_fetch coordinator. Surfaces
// the top similar prior matters into matters.context.similar_matters as an
// InsightCard.
//
// Two retrieval paths:
//   1. pgvector cosine — when the current matter has an embedding populated
//      (generate-embedding job ran after Voyage rolled out). The query
//      COALESCEs matter_summaries.summary_embedding ahead of matters.embedding
//      so closed + compacted matters use their resolved-outcome vector (M2).
//   2. tsvector text match — original PR8 path. Used when the current
//      matter has no embedding yet, or as a fallback after a pgvector
//      query returns zero rows.
export async function handleContextFetchSimilarMattersJob(db: Db, job: Job) {
  const payload = job.payload as unknown as ContextFetchPayload;
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const hasEmbeddingRows = await db.execute(sql`
    SELECT embedding IS NOT NULL AS has_embedding
    FROM matters
    WHERE id = ${matter.id}::uuid
    LIMIT 1
  `);
  const hasEmbedding =
    ((hasEmbeddingRows as unknown as Array<{ has_embedding: boolean }>)[0]
      ?.has_embedding ?? false) === true;

  let rows: SimilarMatterRow[] = [];

  if (hasEmbedding) {
    const embeddingResult = await db.execute(sql`
      WITH q AS (
        SELECT embedding AS qvec
        FROM matters
        WHERE id = ${matter.id}::uuid
      )
      SELECT
        m.id,
        m.short_id,
        m.title,
        m.summary,
        m.practice_area,
        m.priority,
        m.status,
        m.closed_at,
        1 - (COALESCE(ms.summary_embedding, m.embedding) <=> (SELECT qvec FROM q)) AS rank,
        'embedding' AS similarity_backend
      FROM matters m
      LEFT JOIN matter_summaries ms ON ms.matter_id = m.id
      WHERE m.id != ${matter.id}::uuid
        AND m.status != 'cancelled'
        AND COALESCE(ms.summary_embedding, m.embedding) IS NOT NULL
      ORDER BY COALESCE(ms.summary_embedding, m.embedding) <=> (SELECT qvec FROM q)
      LIMIT 5
    `);
    rows = embeddingResult as unknown as SimilarMatterRow[];
  }

  if (rows.length === 0) {
    const searchText = matter.requestText.slice(0, 500);
    const tsResult = await db.execute(sql`
      SELECT
        id,
        short_id,
        title,
        summary,
        practice_area,
        priority,
        status,
        closed_at,
        ts_rank(
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '')),
          plainto_tsquery('english', ${searchText})
        ) AS rank,
        'tsvector' AS similarity_backend
      FROM matters
      WHERE id != ${matter.id}
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, ''))
            @@ plainto_tsquery('english', ${searchText})
      ORDER BY rank DESC
      LIMIT 5
    `);
    rows = tsResult as unknown as SimilarMatterRow[];
  }

  const top = rows[0];
  const primary: InsightCardPrimaryField[] = [];
  let summary: string;

  if (rows.length === 0) {
    summary = 'No similar prior matters found.';
  } else {
    primary.push({ label: 'Matches', value: rows.length });
    if (top?.practice_area) {
      primary.push({ label: 'Top area', value: top.practice_area });
    }
    const backend = top?.similarity_backend ?? 'tsvector';
    summary = top?.title
      ? `${rows.length} similar matter${rows.length === 1 ? '' : 's'} — closest: ${top.title}.`
      : `${rows.length} similar prior matter${rows.length === 1 ? '' : 's'}.`;
    summary += ` (${backend} similarity)`;
  }

  const card: InsightCard = {
    source: 'similar_matters',
    fetchedAt: new Date().toISOString(),
    staleAfter: computeStaleAfter('similar_matters'),
    primary,
    summary,
    drilldownUrl: top ? `/matters/${top.id}` : undefined,
    raw: {
      matters: rows.map((r) => ({
        id: r.id,
        shortId: r.short_id,
        title: r.title,
        summary: r.summary,
        practiceArea: r.practice_area,
        priority: r.priority,
        status: r.status,
        closedAt: r.closed_at?.toISOString() ?? null,
        rank: Number(r.rank),
      })),
      similarityBackend: rows[0]?.similarity_backend ?? 'none',
    },
  };

  const existingContext = (matter.context ?? {}) as Record<string, unknown>;
  await db
    .update(matters)
    .set({
      context: { ...existingContext, similar_matters: card },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.context_fetched',
    details: {
      source: 'similar_matters',
      recordCount: rows.length,
      similarityBackend: rows[0]?.similarity_backend ?? 'none',
    },
  });
}
