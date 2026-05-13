import { and, lt, sql } from 'drizzle-orm';
import { matters, matterEvents, auditLog, escalations, type Db } from '@legal/db';

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
    const overdueHours = m.slaDueAt
      ? Math.max(Math.round((Date.now() - new Date(m.slaDueAt).getTime()) / 36e5), 0)
      : 0;
    const severity = overdueHours >= 24 ? 'high' : overdueHours >= 4 ? 'medium' : 'low';
    await db.insert(escalations).values({
      matterId: m.id,
      kind: 'sla_breach',
      severity,
      title: `SLA breached for ${m.shortId}`,
      body: `Matter "${m.title}" was due ${m.slaDueAt ? new Date(m.slaDueAt).toISOString() : 'unknown'}${
        overdueHours ? ` — ${overdueHours}h overdue` : ''
      }.`,
      createdByKind: 'system',
      triggerRule: 'sla_check',
      evidence: { slaDueAt: m.slaDueAt, overdueHours },
    });
    console.log(`SLA breached for matter ${m.shortId} (escalation created)`);
  }
  return breached.length;
}
