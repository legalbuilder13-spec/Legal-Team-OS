import { sql } from 'drizzle-orm';
import { detectedConflicts, type Db } from '@legal/db';

// PR #7 / M8 — Weekly conflict-detection cron handler.
//
// Runs three structural checks across the content tables and writes
// one detected_conflicts row per pair (subject to the unique-on-active
// index, which makes re-runs idempotent — already-flagged active
// conflicts aren't duplicated).
//
// Checks (v1, no LLM cost):
//   1. duplicate_canonical_clause — two clauses with same name +
//      practice_area + is_canonical=true. Always high severity.
//   2. rule_priority_collision — two active rules with same kind +
//      priority. Medium severity (the order is undefined; outcome
//      depends on insertion order).
//   3. near_duplicate_playbook — two active playbooks in the same
//      practice_area with cosine distance < 0.07 (similarity > 0.93).
//      Medium severity. Skipped if either playbook lacks an embedding
//      (PR #3 backfill cron will populate over time).

interface DetectionResult {
  duplicateClauses: number;
  rulePriorityCollisions: number;
  nearDuplicatePlaybooks: number;
  totalNewConflicts: number;
}

export async function runDetectConflicts(db: Db): Promise<DetectionResult> {
  let duplicateClauses = 0;
  let rulePriorityCollisions = 0;
  let nearDuplicatePlaybooks = 0;

  // 1. Duplicate canonical clauses
  const dupClauses = await db.execute(sql`
    SELECT
      a.id AS a_id, a.name AS a_name, a.practice_area::text AS practice_area,
      b.id AS b_id, b.name AS b_name
    FROM clauses a
    JOIN clauses b
      ON a.id < b.id
      AND a.name = b.name
      AND a.practice_area = b.practice_area
      AND a.is_canonical = true
      AND b.is_canonical = true
      AND a.status != 'archived'
      AND b.status != 'archived'
  `);
  for (const r of dupClauses as unknown as Array<{
    a_id: string;
    a_name: string;
    practice_area: string;
    b_id: string;
    b_name: string;
  }>) {
    try {
      await db.insert(detectedConflicts).values({
        kind: 'duplicate_canonical_clause',
        severity: 'high',
        entityAType: 'clause',
        entityAId: r.a_id,
        entityBType: 'clause',
        entityBId: r.b_id,
        summary: `Two canonical clauses share the name "${r.a_name}" in ${r.practice_area}. Pick one and archive the other.`,
        evidence: { name: r.a_name, practiceArea: r.practice_area },
      });
      duplicateClauses += 1;
    } catch (err) {
      // Unique-on-active constraint — already flagged
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('detected_conflicts_active_unique_idx')) throw err;
    }
  }

  // 2. Rule priority collisions
  const ruleCollisions = await db.execute(sql`
    SELECT
      a.id AS a_id, a.name AS a_name, a.kind::text AS kind, a.priority,
      b.id AS b_id, b.name AS b_name
    FROM rules a
    JOIN rules b
      ON a.id < b.id
      AND a.kind = b.kind
      AND a.priority = b.priority
      AND a.status = 'active'
      AND b.status = 'active'
  `);
  for (const r of ruleCollisions as unknown as Array<{
    a_id: string;
    a_name: string;
    kind: string;
    priority: number;
    b_id: string;
    b_name: string;
  }>) {
    try {
      await db.insert(detectedConflicts).values({
        kind: 'rule_priority_collision',
        severity: 'medium',
        entityAType: 'rule',
        entityAId: r.a_id,
        entityBType: 'rule',
        entityBId: r.b_id,
        summary: `Two active ${r.kind} rules share priority ${r.priority} ("${r.a_name}" vs "${r.b_name}"). Order is undefined — give them different priorities.`,
        evidence: {
          kind: r.kind,
          priority: r.priority,
          aName: r.a_name,
          bName: r.b_name,
        },
      });
      rulePriorityCollisions += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('detected_conflicts_active_unique_idx')) throw err;
    }
  }

  // 3. Near-duplicate active playbooks (cosine similarity > 0.93)
  const nearDups = await db.execute(sql`
    SELECT
      a.id AS a_id, a.title AS a_title, a.practice_area::text AS practice_area,
      b.id AS b_id, b.title AS b_title,
      (1 - (a.embedding <=> b.embedding)) AS similarity
    FROM playbooks a
    JOIN playbooks b
      ON a.id < b.id
      AND a.is_active = true
      AND b.is_active = true
      AND a.practice_area = b.practice_area
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
      AND (a.embedding <=> b.embedding) < 0.07
  `);
  for (const r of nearDups as unknown as Array<{
    a_id: string;
    a_title: string;
    practice_area: string;
    b_id: string;
    b_title: string;
    similarity: number;
  }>) {
    try {
      const sim = Number(r.similarity).toFixed(3);
      await db.insert(detectedConflicts).values({
        kind: 'near_duplicate_playbook',
        severity: 'medium',
        entityAType: 'playbook',
        entityAId: r.a_id,
        entityBType: 'playbook',
        entityBId: r.b_id,
        summary: `Near-duplicate active playbooks in ${r.practice_area} (similarity ${sim}): "${r.a_title}" vs "${r.b_title}". Likely duplicates or contradictions — review and merge.`,
        evidence: {
          practiceArea: r.practice_area,
          similarity: Number(r.similarity),
          aTitle: r.a_title,
          bTitle: r.b_title,
        },
      });
      nearDuplicatePlaybooks += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('detected_conflicts_active_unique_idx')) throw err;
    }
  }

  return {
    duplicateClauses,
    rulePriorityCollisions,
    nearDuplicatePlaybooks,
    totalNewConflicts:
      duplicateClauses + rulePriorityCollisions + nearDuplicatePlaybooks,
  };
}
