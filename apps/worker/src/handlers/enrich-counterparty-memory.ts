import { eq, sql, desc } from 'drizzle-orm';
import { matters, counterparties, matterNotes, type Db, type Job } from '@legal/db';
import { env } from '../env.js';

interface EnrichLLMResponse {
  counterparty_id: string;
  summary: string;
  negotiation_positions: Array<{
    topic: string;
    their_position: string | null;
    our_position: string | null;
    last_outcome: string | null;
  }>;
  response_latency_days: number | null;
  escalation_frequency: number;
  executive_involvement: 'high' | 'medium' | 'low' | 'unknown';
}

async function callEnrichLLM(
  counterpartyId: string,
  counterpartyName: string,
  matters: Array<Record<string, unknown>>,
  notes: Array<Record<string, unknown>>,
): Promise<EnrichLLMResponse | null> {
  if (matters.length === 0) return null;
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/enrich-counterparty`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        counterparty_id: counterpartyId,
        counterparty_name: counterpartyName,
        matters,
        notes,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`enrich LLM call failed: ${res.status} ${body.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as EnrichLLMResponse;
  } catch (err) {
    console.warn('enrich LLM call threw:', err);
    return null;
  }
}

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

  // D2: call the AI service for richer LLM-extracted patterns. If the
  // call fails, fall back to just the aggregate stats above — non-fatal.
  const llmInput = {
    matters: history.map((m) => ({
      title: m.title,
      summary: m.summary,
      practice_area: m.practiceArea,
      status: m.status,
      created_at: m.createdAt.toISOString(),
      closed_at: m.closedAt?.toISOString() ?? null,
    })),
    notes: noteRows.slice(0, 50).map((n) => ({
      body: n.body,
      source: n.source,
    })),
  };
  const llm = await callEnrichLLM(
    counterparty.id,
    counterparty.name,
    llmInput.matters,
    llmInput.notes,
  );

  await db
    .update(counterparties)
    .set({
      behavioralProfile: {
        // LLM-generated narrative takes precedence over the simple
        // keyword-derived one when available.
        summary: llm?.summary ?? summary,
        totalMatters,
        avgCycleTimeDays,
        lastContactAt,
        practiceAreas,
        commonRedlines,
        escalationTriggers,
        ...(llm
          ? {
              negotiationPositions: llm.negotiation_positions.map((p) => ({
                topic: p.topic,
                theirPosition: p.their_position,
                ourPosition: p.our_position,
                lastOutcome: p.last_outcome,
              })),
              responseLatencyDays: llm.response_latency_days,
              escalationFrequency: llm.escalation_frequency,
              executiveInvolvement: llm.executive_involvement,
              lastEnrichedAt: new Date().toISOString(),
            }
          : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(counterparties.id, counterparty.id));
}
