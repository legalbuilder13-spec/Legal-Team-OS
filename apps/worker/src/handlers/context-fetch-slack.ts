import { eq } from 'drizzle-orm';
import { matters, auditLog, type Db, type Job } from '@legal/db';
import {
  computeStaleAfter,
  type InsightCard,
  type InsightCardPrimaryField,
} from '@legal/types';
import { env } from '../env.js';
import { searchSlackMessages } from '../integrations/slack.js';
import { getCachedCard, setCachedCard } from '../cache.js';

interface ContextFetchPayload {
  matter_id: string;
  counterparty_name?: string | null;
  counterparty_domain?: string | null;
}

// Per-source sub-handler enqueued by the context_fetch coordinator. Reuses
// the existing SLACK_BOT_TOKEN (provisioned for the /legal intake bot) +
// the search:read scope. The bot sees what it has access to: public
// channels plus private channels where it's a member.
export async function handleContextFetchSlackJob(db: Db, job: Job) {
  if (!env.SLACK_BOT_TOKEN) {
    console.log('context_fetch_slack: SLACK_BOT_TOKEN not set, skipping');
    return;
  }

  const payload = job.payload as unknown as ContextFetchPayload;
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const query =
    payload.counterparty_name?.trim() ||
    payload.counterparty_domain?.trim();
  if (!query) {
    // Slack search without a target name is too broad to be useful.
    return;
  }

  // Cache hit: copy the cached card into this matter's context and return.
  const cached = await getCachedCard(db, 'slack', query);
  if (cached) {
    const existingContext = (matter.context ?? {}) as Record<string, unknown>;
    await db
      .update(matters)
      .set({
        context: { ...existingContext, slack: cached.card },
        updatedAt: new Date(),
      })
      .where(eq(matters.id, matter.id));
    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: matter.id,
      action: 'matter.context_fetched',
      details: { source: 'slack', cacheHit: true, ageSeconds: cached.ageSeconds, query },
    });
    return;
  }

  let result;
  try {
    result = await searchSlackMessages(env.SLACK_BOT_TOKEN, query, 10);
  } catch (err) {
    // Treat missing_scope as a configuration issue, not a job failure —
    // emit an explanatory card so the attorney sees Slack was checked
    // but isn't fully wired up.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('missing_scope')) {
      const card: InsightCard = {
        source: 'slack',
        fetchedAt: new Date().toISOString(),
        staleAfter: computeStaleAfter('slack'),
        primary: [],
        summary:
          'Slack search not enabled — add the search:read scope to the bot in the Slack app settings.',
      };
      const existingContext = (matter.context ?? {}) as Record<string, unknown>;
      await db
        .update(matters)
        .set({
          context: { ...existingContext, slack: card },
          updatedAt: new Date(),
        })
        .where(eq(matters.id, matter.id));
      await db.insert(auditLog).values({
        actorKind: 'system',
        matterId: matter.id,
        action: 'matter.context_fetched',
        details: { source: 'slack', error: 'missing_scope', query },
      });
      return;
    }
    throw err;
  }

  const primary: InsightCardPrimaryField[] = [];
  let summary: string;
  let drilldownUrl: string | undefined;

  if (result.total === 0) {
    summary = `No Slack messages mention ${query}.`;
  } else {
    primary.push({ label: 'Messages found', value: result.total });
    const top = result.matches[0];
    if (top) {
      primary.push({ label: 'Most recent channel', value: `#${top.channel.name}` });
      drilldownUrl = top.permalink;
    }
    summary =
      result.total === 1
        ? `1 Slack message mentions ${query}.`
        : `${result.total} Slack messages mention ${query} (showing top ${Math.min(result.matches.length, 5)}).`;
  }

  const card: InsightCard = {
    source: 'slack',
    fetchedAt: new Date().toISOString(),
    staleAfter: computeStaleAfter('slack'),
    primary,
    summary,
    drilldownUrl,
    raw: {
      query,
      total: result.total,
      matches: result.matches.slice(0, 5).map((m) => ({
        ts: m.ts,
        channel: m.channel.name,
        user: m.user,
        textPreview: m.text.slice(0, 200),
        permalink: m.permalink,
      })),
    },
  };

  const existingContext = (matter.context ?? {}) as Record<string, unknown>;
  await db
    .update(matters)
    .set({
      context: { ...existingContext, slack: card },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  await setCachedCard(db, 'slack', query, card);

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.context_fetched',
    details: { source: 'slack', total: result.total, query, cacheHit: false },
  });
}
