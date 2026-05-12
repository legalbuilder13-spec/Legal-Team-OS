import { eq, sql, desc } from 'drizzle-orm';
import { matters, counterparties, matterNotes, type Db, type Job } from '@legal/db';

interface EnrichPayload {
  counterparty_id: string;
}

export async function handleEnrichCounterpartyMemoryJob(db: Db, job: Job) {
  const payload = job.payload as unknown as EnrichPayload;
  if (!payload.counterparty_id) return;

  const counterparty = await db.query.counterparties.findFirst({
    where: eq(counterparties.id, payload.counterparty_id),
  });
  if (!counterparty) return;

  const history = await db
    .select({
      id: matters.id,
      shortId: matters.shortId,
      title: matters.title,
      summary: matters.summary,
      practiceArea: matters.practiceArea,
      priority: matters.priority,
      status: matters.status,
      createdAt: matters.createdAt,
      closedAt: matters.closedAt,
    })
    .from(matters)
    .where(eq(matters.counterpartyId, counterparty.id))
    .orderBy(desc(matters.createdAt))
    .limit(50);

  if (history.length === 0) return;

  const totalMatters = history.length;
  const closed = history.filter((m) => m.closedAt !== null);
  const avgCycleTimeDays =
    closed.length > 0
      ? closed.reduce((sum, m) => {
          const ms = (m.closedAt!.getTime() - m.createdAt.getTime());
          return sum + ms / (1000 * 60 * 60 * 24);
        }, 0) / closed.length
      : undefined;

  const areaCounts = new Map<string, number>();
  for (const m of history) {
    if (m.practiceArea) {
      areaCounts.set(m.practiceArea, (areaCounts.get(m.practiceArea) ?? 0) + 1);
    }
  }
  const practiceAreas = Array.from(areaCounts.entries())
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count);

  const lastContactAt = history[0]?.createdAt.toISOString();

  const matterIds = history.map((m) => m.id);
  const noteRows = await db
    .select({ body: matterNotes.body, source: matterNotes.source })
    .from(matterNotes)
    .where(sql`${matterNotes.matterId} = ANY(${matterIds})`);

  const escalationTriggers: string[] = [];
  const commonRedlines: string[] = [];
  const lowerNotes = noteRows.map((n) => n.body.toLowerCase());
  if (lowerNotes.some((n) => n.includes('escalat'))) {
    escalationTriggers.push('Has been escalated in past matters');
  }
  if (lowerNotes.some((n) => n.includes('liability cap') || n.includes('uncapped'))) {
    commonRedlines.push('Frequently negotiates liability cap');
  }
  if (lowerNotes.some((n) => n.includes('indemn'))) {
    commonRedlines.push('Pushes back on indemnification provisions');
  }
  if (lowerNotes.some((n) => n.includes('term') && n.includes('renewal'))) {
    commonRedlines.push('Negotiates term/renewal language');
  }

  const topArea = practiceAreas[0]?.area ?? 'various practice areas';
  const summary =
    totalMatters === 1
      ? `First matter with ${counterparty.name}.`
      : `${totalMatters} prior matters across ${practiceAreas.length} practice area${practiceAreas.length > 1 ? 's' : ''} (mostly ${topArea}).` +
        (avgCycleTimeDays
          ? ` Average resolution: ${avgCycleTimeDays.toFixed(1)} days.`
          : '');

  await db
    .update(counterparties)
    .set({
      behavioralProfile: {
        summary,
        totalMatters,
        avgCycleTimeDays,
        lastContactAt,
        practiceAreas,
        commonRedlines,
        escalationTriggers,
      },
      updatedAt: new Date(),
    })
    .where(eq(counterparties.id, counterparty.id));
}
