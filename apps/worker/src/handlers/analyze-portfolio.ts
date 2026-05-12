import { sql, eq } from 'drizzle-orm';
import { matters, systemInsights, users, type Db } from '@legal/db';

const VOLUME_SPIKE_THRESHOLD = 1.5;
const WORKLOAD_IMBALANCE_RATIO = 2.0;

interface VolumeRow {
  practice_area: string;
  recent_count: number;
  prior_count: number;
}

interface WorkloadRow {
  assignee_id: string;
  assignee_name: string;
  open_count: number;
}

interface CounterpartyRow {
  counterparty_id: string;
  counterparty_name: string;
  matter_count: number;
}

async function clearActiveInsights(db: Db) {
  await db
    .update(systemInsights)
    .set({ status: 'dismissed', dismissedAt: new Date() })
    .where(eq(systemInsights.status, 'active'));
}

async function detectVolumeSpikes(db: Db) {
  const result = await db.execute(sql`
    WITH windows AS (
      SELECT
        practice_area,
        COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') as recent_count,
        COUNT(*) FILTER (WHERE created_at BETWEEN now() - interval '90 days' AND now() - interval '30 days') / 2.0 as prior_count
      FROM matters
      WHERE practice_area IS NOT NULL
      GROUP BY practice_area
    )
    SELECT practice_area, recent_count::int, COALESCE(prior_count, 0)::float as prior_count
    FROM windows
    WHERE recent_count >= 5
  `);

  const rows = result.rows as unknown as VolumeRow[];
  for (const row of rows) {
    if (row.prior_count > 0 && row.recent_count / row.prior_count >= VOLUME_SPIKE_THRESHOLD) {
      const pctIncrease = Math.round(((row.recent_count - row.prior_count) / row.prior_count) * 100);
      await db.insert(systemInsights).values({
        kind: 'volume_spike',
        title: `${row.practice_area} matter volume up ${pctIncrease}% this month`,
        body: `Received ${row.recent_count} ${row.practice_area} matters in the last 30 days vs. ~${row.prior_count.toFixed(1)}/month average over the prior 60 days. Consider expanding self-service coverage for routine ${row.practice_area} requests.`,
        severity: pctIncrease > 100 ? 'high' : 'medium',
        evidence: {
          practice_area: row.practice_area,
          recent_count: row.recent_count,
          prior_count: row.prior_count,
        },
      });
    }
  }
}

async function detectWorkloadImbalance(db: Db) {
  const result = await db.execute(sql`
    SELECT m.assignee_id, u.name as assignee_name, COUNT(*)::int as open_count
    FROM matters m
    JOIN users u ON u.id = m.assignee_id
    WHERE m.status IN ('open', 'in_review', 'waiting_on_requester')
      AND u.role IN ('attorney', 'legal_ops')
    GROUP BY m.assignee_id, u.name
    HAVING COUNT(*) > 0
  `);

  const rows = result.rows as unknown as WorkloadRow[];
  if (rows.length < 2) return;

  const avg = rows.reduce((s, r) => s + r.open_count, 0) / rows.length;
  for (const row of rows) {
    if (row.open_count >= avg * WORKLOAD_IMBALANCE_RATIO && row.open_count >= 5) {
      await db.insert(systemInsights).values({
        kind: 'workload_imbalance',
        title: `${row.assignee_name} has ${row.open_count} open matters (${(row.open_count / avg).toFixed(1)}x team average)`,
        body: `Consider rebalancing matters across the team. ${row.assignee_name} has ${row.open_count} open matters vs. the team average of ${avg.toFixed(1)}.`,
        severity: row.open_count >= avg * 3 ? 'high' : 'medium',
        evidence: {
          assignee_id: row.assignee_id,
          assignee_name: row.assignee_name,
          open_count: row.open_count,
          team_average: avg,
        },
      });
    }
  }
}

async function detectCounterpartyPatterns(db: Db) {
  const result = await db.execute(sql`
    SELECT c.id as counterparty_id, c.name as counterparty_name, COUNT(*)::int as matter_count
    FROM counterparties c
    JOIN matters m ON m.counterparty_id = c.id
    WHERE m.created_at > now() - interval '90 days'
    GROUP BY c.id, c.name
    HAVING COUNT(*) >= 3
    ORDER BY matter_count DESC
    LIMIT 5
  `);

  const rows = result.rows as unknown as CounterpartyRow[];
  for (const row of rows) {
    await db.insert(systemInsights).values({
      kind: 'counterparty_pattern',
      title: `${row.counterparty_name}: ${row.matter_count} matters in the last 90 days`,
      body: `${row.counterparty_name} has driven ${row.matter_count} matters this quarter. Consider negotiating a master agreement to streamline future requests, or designate a relationship lead.`,
      severity: row.matter_count >= 6 ? 'high' : 'medium',
      evidence: {
        counterparty_id: row.counterparty_id,
        counterparty_name: row.counterparty_name,
        matter_count: row.matter_count,
      },
    });
  }
}

async function detectSelfServiceOpportunities(db: Db) {
  const result = await db.execute(sql`
    SELECT practice_area, priority, COUNT(*)::int as count
    FROM matters
    WHERE status = 'closed'
      AND priority = 'low'
      AND created_at > now() - interval '60 days'
      AND closed_at - created_at < interval '4 hours'
    GROUP BY practice_area, priority
    HAVING COUNT(*) >= 5
  `);

  const rows = result.rows as unknown as Array<{
    practice_area: string;
    priority: string;
    count: number;
  }>;

  for (const row of rows) {
    await db.insert(systemInsights).values({
      kind: 'self_service_opportunity',
      title: `${row.count} low-priority ${row.practice_area} matters closed in under 4 hours recently`,
      body: `These are strong self-service candidates. Consider authoring a knowledge article or template to auto-resolve future requests of this type.`,
      severity: 'low',
      evidence: { practice_area: row.practice_area, count: row.count },
    });
  }
}

export async function runPortfolioAnalysis(db: Db): Promise<number> {
  await clearActiveInsights(db);

  const before = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(systemInsights)
    .where(eq(systemInsights.status, 'active'));
  const startCount = before[0]?.count ?? 0;

  await detectVolumeSpikes(db);
  await detectWorkloadImbalance(db);
  await detectCounterpartyPatterns(db);
  await detectSelfServiceOpportunities(db);

  const after = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(systemInsights)
    .where(eq(systemInsights.status, 'active'));
  return (after[0]?.count ?? 0) - startCount;
}
