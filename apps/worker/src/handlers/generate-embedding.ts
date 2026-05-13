import { eq } from 'drizzle-orm';
import { matters, type Db, type Job } from '@legal/db';
import { env } from '../env';

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export async function handleGenerateEmbeddingJob(db: Db, job: Job) {
  if (!env.OPENAI_API_KEY) {
    console.log('generate_embedding: OPENAI_API_KEY not set, skipping');
    return;
  }

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, job.matterId!),
  });
  if (!matter) throw new Error(`matter ${job.matterId} not found`);

  const input = [matter.title, matter.summary, matter.requestText]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as OpenAIEmbeddingResponse;
  const embedding = data.data[0]?.embedding;
  if (!embedding) throw new Error('no embedding returned from OpenAI');

  await db
    .update(matters)
    .set({ embedding, updatedAt: new Date() })
    .where(eq(matters.id, matter.id));
}
