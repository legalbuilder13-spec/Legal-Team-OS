import { eq } from 'drizzle-orm';
import { matters, type Db, type Job } from '@legal/db';
import { env } from '../env.js';

// Embeddings via Voyage AI (Anthropic's official embeddings partner; they
// acquired Voyage in 2024). We use voyage-law-2 specifically — Voyage's
// legal-domain-optimized model, 1024 dimensions. Quality on contract and
// case-law text materially exceeds general-purpose models.
//
// API docs: https://docs.voyageai.com/reference/embeddings-api
const VOYAGE_MODEL = 'voyage-law-2';
const VOYAGE_MAX_INPUT_CHARS = 32_000; // voyage-law-2 supports 16K tokens

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

export async function handleGenerateEmbeddingJob(db: Db, job: Job) {
  if (!env.VOYAGE_API_KEY) {
    console.log('generate_embedding: VOYAGE_API_KEY not set, skipping');
    return;
  }

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, job.matterId!),
  });
  if (!matter) throw new Error(`matter ${job.matterId} not found`);

  const input = [matter.title, matter.summary, matter.requestText]
    .filter(Boolean)
    .join('\n')
    .slice(0, VOYAGE_MAX_INPUT_CHARS);

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [input],
      input_type: 'document', // 'document' for indexing; 'query' for search-time
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as VoyageEmbeddingResponse;
  const embedding = data.data[0]?.embedding;
  if (!embedding) throw new Error('no embedding returned from Voyage');
  if (embedding.length !== 1024) {
    throw new Error(
      `Voyage returned ${embedding.length}-dim vector, expected 1024 (model: ${VOYAGE_MODEL})`,
    );
  }

  await db
    .update(matters)
    .set({ embedding, updatedAt: new Date() })
    .where(eq(matters.id, matter.id));
}
