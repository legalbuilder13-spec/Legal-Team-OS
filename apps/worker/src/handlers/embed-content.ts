import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  knowledgeArticles,
  templates,
  rules,
  executionPatterns,
  playbooks,
  jobs,
  type Db,
  type Job,
} from '@legal/db';
import { env } from '../env.js';

// Polymorphic embedder for the five content tables. Triggered by the
// 'embed_content' job kind with payload { entity_type, entity_id }.
//
// Each entity type has its own "what to embed" recipe — usually
// title + body, sometimes with extra fields. The combined text is
// SHA-256'd and compared against the stored content_hash; if equal,
// the handler short-circuits without calling Voyage. This keeps the
// re-embed cost at zero on no-op edits.
//
// Voyage model is voyage-law-2 (1024 dims) — the same model M2 uses
// for matter_summaries, so all embeddings live in the same space and
// can be compared cross-table for the global semantic search.

const VOYAGE_MODEL = 'voyage-law-2';
const VOYAGE_MAX_INPUT_CHARS = 32_000;

type EntityType =
  | 'knowledge_article'
  | 'template'
  | 'rule'
  | 'execution_pattern'
  | 'playbook';

interface EmbedPayload {
  entity_type: EntityType;
  entity_id: string;
}

async function callVoyage(input: string): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) return null;
  const trimmed = input.slice(0, VOYAGE_MAX_INPUT_CHARS);
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [trimmed],
      input_type: 'document',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`embed-content: Voyage failed ${res.status} ${body.slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const emb = data.data[0]?.embedding;
  if (!emb || emb.length !== 1024) return null;
  return emb;
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface FetchedRow {
  text: string;
  storedHash: string | null;
}

async function fetchContent(
  db: Db,
  entityType: EntityType,
  entityId: string,
): Promise<FetchedRow | null> {
  if (entityType === 'knowledge_article') {
    const row = await db.query.knowledgeArticles.findFirst({
      where: eq(knowledgeArticles.id, entityId),
    });
    if (!row) return null;
    const text = [row.title, row.body, ...(row.tags ?? [])].filter(Boolean).join('\n');
    return { text, storedHash: row.contentHash };
  }
  if (entityType === 'template') {
    const row = await db.query.templates.findFirst({
      where: eq(templates.id, entityId),
    });
    if (!row) return null;
    const text = [
      row.name,
      row.matterType,
      row.body,
      ...(row.variables ?? []).map((v) => v.name),
    ]
      .filter(Boolean)
      .join('\n');
    return { text, storedHash: row.contentHash };
  }
  if (entityType === 'rule') {
    const row = await db.query.rules.findFirst({ where: eq(rules.id, entityId) });
    if (!row) return null;
    const text = [row.name, row.kind, row.naturalText].filter(Boolean).join('\n');
    return { text, storedHash: row.contentHash };
  }
  if (entityType === 'execution_pattern') {
    const row = await db.query.executionPatterns.findFirst({
      where: eq(executionPatterns.id, entityId),
    });
    if (!row) return null;
    const text = [
      row.name,
      row.description,
      row.matterType,
      `${row.inputType} → ${row.outputFormat}`,
      row.promptTemplate,
    ]
      .filter(Boolean)
      .join('\n');
    return { text, storedHash: row.contentHash };
  }
  if (entityType === 'playbook') {
    const row = await db.query.playbooks.findFirst({
      where: eq(playbooks.id, entityId),
    });
    if (!row) return null;
    const text = [row.title, row.body].filter(Boolean).join('\n');
    return { text, storedHash: row.contentHash };
  }
  return null;
}

async function writeEmbedding(
  db: Db,
  entityType: EntityType,
  entityId: string,
  embedding: number[] | null,
  contentHash: string,
): Promise<void> {
  const updatedAt = new Date();
  const setClause = embedding
    ? { embedding, contentHash, embeddingUpdatedAt: updatedAt }
    : { contentHash, embeddingUpdatedAt: updatedAt };

  if (entityType === 'knowledge_article') {
    await db.update(knowledgeArticles).set(setClause).where(eq(knowledgeArticles.id, entityId));
  } else if (entityType === 'template') {
    await db.update(templates).set(setClause).where(eq(templates.id, entityId));
  } else if (entityType === 'rule') {
    await db.update(rules).set(setClause).where(eq(rules.id, entityId));
  } else if (entityType === 'execution_pattern') {
    await db.update(executionPatterns).set(setClause).where(eq(executionPatterns.id, entityId));
  } else if (entityType === 'playbook') {
    await db.update(playbooks).set(setClause).where(eq(playbooks.id, entityId));
  }
}

export async function handleEmbedContentJob(db: Db, job: Job): Promise<void> {
  const payload = job.payload as unknown as EmbedPayload;
  if (!payload.entity_type || !payload.entity_id) {
    console.warn('embed_content: missing entity_type/entity_id in payload');
    return;
  }
  if (!env.VOYAGE_API_KEY) {
    console.log(`embed_content: VOYAGE_API_KEY not set, skipping ${payload.entity_type}/${payload.entity_id}`);
    return;
  }
  const fetched = await fetchContent(db, payload.entity_type, payload.entity_id);
  if (!fetched) {
    console.warn(`embed_content: ${payload.entity_type}/${payload.entity_id} not found`);
    return;
  }
  const newHash = hashContent(fetched.text);
  if (newHash === fetched.storedHash) {
    return;
  }
  const embedding = await callVoyage(fetched.text);
  await writeEmbedding(db, payload.entity_type, payload.entity_id, embedding, newHash);
}

// Daily backfill cron — scans for rows with missing embeddings and
// enqueues embed_content jobs for them. Idempotent: re-running picks
// up any new rows and skips ones the first run already embedded.
export async function enqueueStaleContentEmbeddings(db: Db): Promise<number> {
  let total = 0;

  const ka = await db
    .select({ id: knowledgeArticles.id })
    .from(knowledgeArticles)
    .where(sql`${knowledgeArticles.isActive} = true AND ${knowledgeArticles.embedding} IS NULL`);
  for (const r of ka) {
    await db.insert(jobs).values({
      kind: 'embed_content',
      payload: { entity_type: 'knowledge_article', entity_id: r.id },
    });
    total += 1;
  }

  const tpl = await db
    .select({ id: templates.id })
    .from(templates)
    .where(sql`${templates.isActive} = true AND ${templates.embedding} IS NULL`);
  for (const r of tpl) {
    await db.insert(jobs).values({
      kind: 'embed_content',
      payload: { entity_type: 'template', entity_id: r.id },
    });
    total += 1;
  }

  const rl = await db
    .select({ id: rules.id })
    .from(rules)
    .where(sql`${rules.status} != 'archived' AND ${rules.embedding} IS NULL`);
  for (const r of rl) {
    await db.insert(jobs).values({
      kind: 'embed_content',
      payload: { entity_type: 'rule', entity_id: r.id },
    });
    total += 1;
  }

  const ep = await db
    .select({ id: executionPatterns.id })
    .from(executionPatterns)
    .where(sql`${executionPatterns.isActive} = true AND ${executionPatterns.embedding} IS NULL`);
  for (const r of ep) {
    await db.insert(jobs).values({
      kind: 'embed_content',
      payload: { entity_type: 'execution_pattern', entity_id: r.id },
    });
    total += 1;
  }

  const pb = await db
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(sql`${playbooks.isActive} = true AND ${playbooks.embedding} IS NULL`);
  for (const r of pb) {
    await db.insert(jobs).values({
      kind: 'embed_content',
      payload: { entity_type: 'playbook', entity_id: r.id },
    });
    total += 1;
  }

  return total;
}
