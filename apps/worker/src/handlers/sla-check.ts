import { and, lt, sql } from 'drizzle-orm';
import { matters, matterEvents, auditLog, type Db } from '@legal/db';

export async function runSlaCheck(db: Db) {
  const breached = await db
    .select()
    .from(matters)
    .where(
      and(
        sql`${matters.status} not in ('closed', 'cancelled')`,
        lt(matters.slaDueAt, new Date()),
        sql`NOT EXISTS (
          SELECT 1 FROM matter_events e
          WHERE e.matter_id = ${matters.id}
          AND e.kind = 'sla.breached'
          AND e.created_at > ${matters.slaDueAt}
        )`,
      ),
    );

  for (const m of breached) {
    await db.insert(matterEvents).values({
      matterId: m.id,
      kind: 'sla.breached',
      payload: { slaDueAt: m.slaDueAt },
    });
    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: m.id,
      action: 'matter.sla_breached',
      details: { slaDueAt: m.slaDueAt },
    });
    console.log(`SLA breached for matter ${m.shortId}`);
  }
  return breached.length;
}
