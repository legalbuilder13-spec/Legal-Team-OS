import { env } from '@/env';

// Embed a search query via Voyage. Mirrors the worker's embed-content
// helper but uses input_type='query' (the model is asymmetric — query
// vs document inputs get different positional encodings).
//
// Returns null on any failure (missing key, network error, dimension
// mismatch). Callers should fall back to keyword search.

const VOYAGE_MODEL = 'voyage-law-2';
const MAX_QUERY_CHARS = 2000;

export async function embedQuery(text: string): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) return null;
  const trimmed = text.slice(0, MAX_QUERY_CHARS);
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [trimmed],
        input_type: 'query',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const emb = data.data[0]?.embedding;
    if (!emb || emb.length !== 1024) return null;
    return emb;
  } catch {
    return null;
  }
}

// Format an embedding as the Postgres vector literal expected by
// pgvector's `<=>` operator: '[1,2,3,...]'.
export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
