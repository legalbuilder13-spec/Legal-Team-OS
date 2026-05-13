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
}

// Per-source sub-handler enqueued by the context_fetch coordinator. Searches
// prior matters by request-text similarity (tsvector for now; will switch to
// pgvector once A1 populates embeddings) and writes the top matches into
// matters.context.similar_matters as an InsightCard.
export async function handleContextFetchSimilarMattersJob(db: Db, job: Job) {
  const payload = job.payload as unknown as ContextFetchPayload;
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const searchText = matter.requestText.slice(0, 500);
  const result = await db.execute(sql`
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
      ) AS rank
    FROM matters
    WHERE id != ${matter.id}
      AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, ''))
          @@ plainto_tsquery('english', ${searchText})
    ORDER BY rank DESC
    LIMIT 5
  `);
  const rows = result as unknown as SimilarMatterRow[];

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
    summary = top?.title
      ? `${rows.length} similar matter${rows.length === 1 ? '' : 's'} — closest: ${top.title}.`
      : `${rows.length} similar prior matter${rows.length === 1 ? '' : 's'}.`;
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
    details: { source: 'similar_matters', recordCount: rows.length },
  });
}
