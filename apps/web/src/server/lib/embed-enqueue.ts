import { jobs, type Db } from '@legal/db';

// Tiny helper: enqueue an `embed_content` job for any of the five
// content tables. Called from admin upsert mutations so a fresh edit
// gets re-embedded immediately rather than waiting for the nightly
// backfill cron. The handler short-circuits on stable content_hash
// so this is safe to call on every save.

export type EmbeddableEntityType =
  | 'knowledge_article'
  | 'template'
  | 'rule'
  | 'execution_pattern'
  | 'playbook';

export async function enqueueEmbedContent(
  db: Db,
  entityType: EmbeddableEntityType,
  entityId: string,
): Promise<void> {
  await db.insert(jobs).values({
    kind: 'embed_content',
    payload: { entity_type: entityType, entity_id: entityId },
  });
}
