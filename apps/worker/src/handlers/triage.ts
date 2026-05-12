import { eq, sql } from 'drizzle-orm';
import {
  matters,
  matterEvents,
  routingRules,
  counterparties,
  auditLog,
  jobs,
  users,
  playbooks,
  knowledgeArticles,
  type Job,
} from '@legal/db';
import type { Db } from '@legal/db';
import type { PracticeArea, Priority } from '@legal/types';
import { env } from '../env.js';
import { extractDomain } from '../utils.js';

interface TriageResponse {
  matter_id: string;
  title: string;
  summary: string;
  practice_area: PracticeArea;
  priority: Priority;
  counterparty_name: string | null;
  reasoning: string;
}

const SLA_HOURS_BY_PRIORITY: Record<string, number> = {
  high: 4,
  medium: 24,
  low: 72,
};

export async function handleTriageJob(db: Db, job: Job) {
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, job.matterId!),
  });
  if (!matter) {
    throw new Error(`matter ${job.matterId} not found`);
  }
  if (matter.status === 'closed' || matter.status === 'cancelled') {
    console.log(`triage: matter ${matter.shortId} is ${matter.status}, skipping`);
    return;
  }

  const activePlaybooks = await db
    .select({
      practice_area: playbooks.practiceArea,
      title: playbooks.title,
      body: playbooks.body,
    })
    .from(playbooks)
    .where(eq(playbooks.isActive, true));

  const activeArticles = await db
    .select({
      practice_area: knowledgeArticles.practiceArea,
      title: knowledgeArticles.title,
      body: knowledgeArticles.body,
      tags: knowledgeArticles.tags,
    })
    .from(knowledgeArticles)
    .where(eq(knowledgeArticles.isActive, true));

  const searchText = matter.requestText.slice(0, 500);
  const priorMattersResult = await db.execute(sql`
    SELECT title, summary, practice_area, priority
    FROM matters
    WHERE status = 'closed'
      AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, ''))
          @@ plainto_tsquery('english', ${searchText})
    ORDER BY ts_rank(
      to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '')),
      plainto_tsquery('english', ${searchText})
    ) DESC
    LIMIT 3
  `);
  const priorMatters = priorMattersResult.rows as Array<{
    title: string;
    summary: string | null;
    practice_area: string;
    priority: string | null;
  }>;

  let counterpartyMemory: {
    name: string;
    summary: string | null;
    total_matters: number;
    common_redlines: string[];
    escalation_triggers: string[];
    typical_positions: string[];
  } | null = null;

  if (matter.counterpartyId) {
    const cp = await db.query.counterparties.findFirst({
      where: eq(counterparties.id, matter.counterpartyId),
    });
    if (cp?.behavioralProfile && Object.keys(cp.behavioralProfile).length > 0) {
      const profile = cp.behavioralProfile as Record<string, unknown>;
      counterpartyMemory = {
        name: cp.name,
        summary: (profile.summary as string) ?? null,
        total_matters: (profile.totalMatters as number) ?? 0,
        common_redlines: (profile.commonRedlines as string[]) ?? [],
        escalation_triggers: (profile.escalationTriggers as string[]) ?? [],
        typical_positions: (profile.typicalPositions as string[]) ?? [],
      };
    }
  }

  const res = await fetch(`${env.AI_SERVICE_URL}/triage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      matter_id: matter.id,
      request_text: matter.requestText,
      channel: 'slack',
      playbooks: activePlaybooks,
      knowledge_articles: activeArticles,
      counterparty_memory: counterpartyMemory,
      prior_matters: priorMatters.map((pm) => ({
        title: pm.title,
        summary: pm.summary,
        practice_area: pm.practice_area,
        priority: pm.priority,
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`triage failed: ${res.status} ${body}`);
  }

  const triage = (await res.json()) as TriageResponse;

  let counterpartyId: string | undefined;
  if (triage.counterparty_name) {
    const existing = await db.query.counterparties.findFirst({
      where: sql`lower(${counterparties.name}) = lower(${triage.counterparty_name})`,
    });
    if (existing) {
      counterpartyId = existing.id;
    } else {
      const [created] = await db
        .insert(counterparties)
        .values({ name: triage.counterparty_name })
        .returning();
      counterpartyId = created!.id;
    }
  }

  const rule = await db.query.routingRules.findFirst({
    where: eq(routingRules.practiceArea, triage.practice_area),
  });
  const slaHours = rule?.slaHours ?? SLA_HOURS_BY_PRIORITY[triage.priority] ?? 48;
  const slaDueAt = new Date(Date.now() + slaHours * 3600 * 1000);

  await db
    .update(matters)
    .set({
      title: triage.title,
      summary: triage.summary,
      practiceArea: triage.practice_area,
      priority: triage.priority,
      counterpartyId,
      assigneeId: rule?.defaultAssigneeId ?? null,
      slaDueAt,
      triageMetadata: { reasoning: triage.reasoning },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  await db.insert(matterEvents).values({
    matterId: matter.id,
    kind: 'triaged',
    payload: {
      practiceArea: triage.practice_area,
      priority: triage.priority,
      assigneeId: rule?.defaultAssigneeId ?? null,
    },
  });

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.triaged',
    details: {
      practiceArea: triage.practice_area,
      priority: triage.priority,
      slaHours,
    },
  });

  const assignee = rule?.defaultAssigneeId
    ? await db.query.users.findFirst({ where: eq(users.id, rule.defaultAssigneeId) })
    : null;
  const matterUrl = `${env.WEB_APP_URL}/matters/${matter.id}`;
  const lines = [
    `*${matter.shortId}* triaged: _${triage.practice_area}_ · *${triage.priority}* priority`,
    assignee
      ? `Assigned to *${assignee.name}*. SLA: ${slaHours}h.`
      : `No default assignee for this practice area — legal-ops will route. SLA: ${slaHours}h.`,
    matterUrl,
  ];

  await db.insert(jobs).values({
    kind: 'slack_notify',
    matterId: matter.id,
    payload: {
      matter_id: matter.id,
      text: lines.join('\n'),
    },
  });

  await db.insert(jobs).values({
    kind: 'generate_embedding',
    matterId: matter.id,
    payload: { matter_id: matter.id },
  });

  const requester = matter.requesterId
    ? await db.query.users.findFirst({ where: eq(users.id, matter.requesterId) })
    : null;
  const domain = extractDomain(requester?.email ?? null, matter.requestText);
  if (triage.counterparty_name || domain) {
    await db.insert(jobs).values({
      kind: 'context_fetch',
      matterId: matter.id,
      payload: {
        matter_id: matter.id,
        counterparty_name: triage.counterparty_name,
        counterparty_domain: domain,
      },
    });
  }
}
