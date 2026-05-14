import { and, eq, sql } from 'drizzle-orm';
import { playbooks, auditLog, type Db } from '@legal/db';

// M4 — Playbook canon-tier promotion. Nightly cron. Reads
// audit_log events written by stage-1-guidance + the lawyer-decision
// flow, rolls them up per playbook, applies the tier-transition
// rules, and writes audit_log entries for every promotion/demotion.
//
// Counters are recomputed from scratch each run, not incremented.
// That makes the cron idempotent: a re-run produces the same result
// as the first run. Per-playbook counts come from joining
// audit_log.action='playbook.matched_in_guidance' rows to
// audit_log.action='analysis.stage_accepted' rows on matter_id.

const PROMOTION_MIN_MATCHED = 5;
const PROMOTION_MIN_ACCEPTANCE_RATIO = 0.8;
const DEMOTION_MAX_ACCEPTANCE_RATIO = 0.5;
const DEMOTION_MIN_MATCHED_FOR_DEMOTE = 10;

interface CountRow {
  playbook_id: string;
  matched_count: number;
  accepted_when_matched_count: number;
}

export interface PromotePlaybooksResult {
  scanned: number;
  promoted: number;
  demoted: number;
  unchanged: number;
}

export async function runPromotePlaybooks(db: Db): Promise<PromotePlaybooksResult> {
  // Aggregate matched / accepted counts per playbook via notion_page_id
  // join. We count one match per (matter_id, notion_page_id) pair to
  // avoid double-counting when stage 1 records multiple sources for
  // the same matched playbook.
  const counts = (await db.execute(sql`
    WITH matched AS (
      SELECT DISTINCT
        (al.details->>'notion_page_id') AS notion_page_id,
        al.matter_id
      FROM audit_log al
      WHERE al.action = 'playbook.matched_in_guidance'
        AND al.details->>'notion_page_id' IS NOT NULL
    ),
    accepted AS (
      SELECT DISTINCT matter_id
      FROM audit_log
      WHERE action = 'analysis.stage_accepted'
        AND details->>'stage_name' = 'guidance'
    )
    SELECT
      p.id::text AS playbook_id,
      COUNT(DISTINCT m.matter_id)::int AS matched_count,
      COUNT(DISTINCT a.matter_id)::int AS accepted_when_matched_count
    FROM playbooks p
    LEFT JOIN matched m ON m.notion_page_id = p.notion_page_id
    LEFT JOIN accepted a ON a.matter_id = m.matter_id
    WHERE p.notion_page_id IS NOT NULL
    GROUP BY p.id
  `)) as unknown as CountRow[];

  // Fetch current tier state for every playbook (including those
  // without notion_page_id — they always start at 'draft' and won't
  // be auto-promoted in v1).
  const all = await db
    .select({
      id: playbooks.id,
      canonTier: playbooks.canonTier,
      notionPageId: playbooks.notionPageId,
      title: playbooks.title,
    })
    .from(playbooks);

  const countByPlaybook = new Map<string, CountRow>();
  for (const c of counts) countByPlaybook.set(c.playbook_id, c);

  let promoted = 0;
  let demoted = 0;
  let unchanged = 0;

  for (const p of all) {
    const c = countByPlaybook.get(p.id);
    const matched = c?.matched_count ?? 0;
    const accepted = c?.accepted_when_matched_count ?? 0;
    const ratio = matched > 0 ? accepted / matched : 0;

    let nextTier = p.canonTier;
    let transitionAt: 'promoted' | 'demoted' | null = null;

    if (
      p.canonTier === 'draft' &&
      matched >= PROMOTION_MIN_MATCHED &&
      ratio >= PROMOTION_MIN_ACCEPTANCE_RATIO
    ) {
      nextTier = 'org';
      transitionAt = 'promoted';
    } else if (
      p.canonTier === 'org' &&
      matched >= DEMOTION_MIN_MATCHED_FOR_DEMOTE &&
      ratio < DEMOTION_MAX_ACCEPTANCE_RATIO
    ) {
      nextTier = 'draft';
      transitionAt = 'demoted';
    }

    // Always refresh telemetry. Tier only changes when the gates fire.
    await db
      .update(playbooks)
      .set({
        matchedCount: matched,
        acceptedWhenMatchedCount: accepted,
        canonTier: nextTier,
        ...(transitionAt === 'promoted'
          ? { lastPromotedAt: new Date() }
          : transitionAt === 'demoted'
            ? { lastDemotedAt: new Date() }
            : {}),
        updatedAt: new Date(),
      })
      .where(eq(playbooks.id, p.id));

    if (transitionAt === 'promoted') {
      promoted += 1;
      await db.insert(auditLog).values({
        actorKind: 'system',
        action: 'playbook.promoted',
        details: {
          playbookId: p.id,
          title: p.title,
          matchedCount: matched,
          acceptanceRatio: Number(ratio.toFixed(3)),
          tier: 'org',
        },
      });
    } else if (transitionAt === 'demoted') {
      demoted += 1;
      await db.insert(auditLog).values({
        actorKind: 'system',
        action: 'playbook.demoted',
        details: {
          playbookId: p.id,
          title: p.title,
          matchedCount: matched,
          acceptanceRatio: Number(ratio.toFixed(3)),
          tier: 'draft',
        },
      });
    } else {
      unchanged += 1;
    }
  }

  console.log(
    `promote-playbooks: scanned=${all.length} promoted=${promoted} demoted=${demoted} unchanged=${unchanged}`,
  );
  return { scanned: all.length, promoted, demoted, unchanged };
}

// Helper for the admin metrics dashboard: counts of playbooks by tier
// + how many transitions happened in the lookback window. Read-only.
export interface PlaybookTierSummary {
  byTier: { draft: number; org: number; industry: number };
  promotedLastWindow: number;
  demotedLastWindow: number;
}

export async function getPlaybookTierSummary(
  db: Db,
  lookbackDays: number = 30,
): Promise<PlaybookTierSummary> {
  const rows = (await db.execute(sql`
    SELECT canon_tier::text AS tier, COUNT(*)::int AS count
    FROM playbooks
    GROUP BY canon_tier
  `)) as unknown as Array<{ tier: string; count: number }>;
  const byTier = { draft: 0, org: 0, industry: 0 };
  for (const r of rows) {
    if (r.tier === 'draft') byTier.draft = r.count;
    else if (r.tier === 'org') byTier.org = r.count;
    else if (r.tier === 'industry') byTier.industry = r.count;
  }

  const window = sql.raw(`'${lookbackDays} days'`);
  const transitions = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE action = 'playbook.promoted')::int AS promoted,
      COUNT(*) FILTER (WHERE action = 'playbook.demoted')::int AS demoted
    FROM audit_log
    WHERE action IN ('playbook.promoted', 'playbook.demoted')
      AND created_at > now() - interval ${window}
  `)) as unknown as Array<{ promoted: number; demoted: number }>;

  return {
    byTier,
    promotedLastWindow: transitions[0]?.promoted ?? 0,
    demotedLastWindow: transitions[0]?.demoted ?? 0,
  };
}
