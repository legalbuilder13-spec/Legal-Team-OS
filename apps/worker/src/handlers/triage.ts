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
  escalations,
  type Job,
} from '@legal/db';
import type { Db } from '@legal/db';
import { DEFAULT_SLA_HOURS_BY_AREA, type PracticeArea, type Priority } from '@legal/types';
import { env } from '../env.js';
import { extractDomain } from '../utils.js';
import { resolveCounterparty, recordAlias } from '../entity-resolution.js';

interface TriageResponse {
  matter_id: string;
  title: string;
  summary: string;
  practice_area: PracticeArea;
  priority: Priority;
  counterparty_name: string | null;
  reasoning: string;
  practice_area_confidence: number;
  priority_confidence: number;
  requires_human_review: boolean;
  review_reason: string | null;
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
  const priorMatters = priorMattersResult as unknown as Array<{
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
    // Resolution strategy (see entity-resolution.ts): exact name → exact
    // domain → exact alias → trigram name → trigram alias. Falls through
    // to creating a new counterparty only if nothing matches.
    const earlyDomain = extractDomain(null, matter.requestText);
    const resolved = await resolveCounterparty(
      db,
      triage.counterparty_name,
      earlyDomain,
    );

    if (resolved) {
      counterpartyId = resolved.counterpartyId;
      // Record the variant we saw if it's not already the canonical name —
      // builds up the alias graph over time so future fuzzy matches get
      // sharper.
      if (resolved.matchedBy !== 'exact_name') {
        await recordAlias(
          db,
          resolved.counterpartyId,
          triage.counterparty_name,
          'triage_extraction',
          resolved.similarity,
        );
      }
      await db.insert(auditLog).values({
        actorKind: 'system',
        matterId: matter.id,
        action: 'matter.counterparty_resolved',
        details: {
          name: triage.counterparty_name,
          matchedBy: resolved.matchedBy,
          similarity: resolved.similarity,
          counterpartyId: resolved.counterpartyId,
        },
      });
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
  if (!rule) {
    console.warn(
      `triage: no routing_rule for practice_area=${triage.practice_area} (matter=${matter.shortId}); using area-default SLA and leaving assignee unset`,
    );
  }
  const slaHours =
    rule?.slaHours ??
    DEFAULT_SLA_HOURS_BY_AREA[triage.practice_area] ??
    SLA_HOURS_BY_PRIORITY[triage.priority] ??
    48;
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
      triageMetadata: {
        reasoning: triage.reasoning,
        practiceAreaConfidence: triage.practice_area_confidence,
        priorityConfidence: triage.priority_confidence,
        requiresHumanReview: triage.requires_human_review,
        reviewReason: triage.review_reason,
      },
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
      practiceAreaConfidence: triage.practice_area_confidence,
      priorityConfidence: triage.priority_confidence,
      requiresHumanReview: triage.requires_human_review,
    },
  });

  if (triage.requires_human_review) {
    const lowConf = Math.min(
      triage.practice_area_confidence,
      triage.priority_confidence,
    );
    const severity: 'high' | 'medium' = lowConf < 0.5 ? 'high' : 'medium';
    await db.insert(escalations).values({
      matterId: matter.id,
      kind: 'low_confidence_triage',
      severity,
      title: `Low-confidence triage for ${matter.shortId}`,
      body: [
        triage.review_reason ?? 'The triage model self-flagged this matter for human review.',
        '',
        `Practice area: ${triage.practice_area} (confidence ${(triage.practice_area_confidence * 100).toFixed(0)}%)`,
        `Priority: ${triage.priority} (confidence ${(triage.priority_confidence * 100).toFixed(0)}%)`,
        '',
        `Reasoning: ${triage.reasoning}`,
      ].join('\n'),
      createdByKind: 'system',
      triggerRule: 'triage_low_confidence',
      evidence: {
        practiceAreaConfidence: triage.practice_area_confidence,
        priorityConfidence: triage.priority_confidence,
        reviewReason: triage.review_reason,
      },
    });
  }

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
  // The context_fetch coordinator decides which sub-jobs to enqueue based on
  // payload. Similar-matters search runs regardless of counterparty, so we
  // always enqueue the coordinator (it's cheap — just inserts sub-jobs).
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
