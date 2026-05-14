import { sql } from 'drizzle-orm';
import type { getDb } from '@legal/db';

type Db = ReturnType<typeof getDb>;

// PR8 — historical tool-invocation intelligence. PRD §19.6.
//
// Given the current matter, find the K most-similar prior matters by
// text similarity (tsvector + ts_rank for now; pgvector when
// embeddings are populated), then aggregate the audit_log to see
// which tools the lawyers actually invoked on those past matters.
// The result is a per-tool count + acceptance signal that the
// tools.context router surfaces alongside the regex/keyword hints.
//
// This is intentionally weak signal: it adds to but doesn't override
// the deterministic hints. PRD §19.6 stresses the lawyer remains the
// decision-maker; this just makes the option more discoverable.

export interface ToolHistoricalSignal {
  tool: 'statutory' | 'case_law' | 'deconstruct';
  invocationCount: number;
  acceptanceCount: number;
  blockedCount: number;
  // What fraction of the K similar matters had this tool invoked.
  // Score >= 0.4 surfaces a "suggested by N similar matters" pill.
  invocationRate: number;
  // Subset of similar matters where the tool produced output the
  // lawyer didn't override. Higher = stronger positive signal.
  acceptanceRate: number;
}

export interface ToolHistoryResult {
  similarMattersConsidered: number;
  signals: ToolHistoricalSignal[];
  // Most-similar matter ids so the UI can deep-link (future PR).
  topSimilarIds: string[];
}

interface SimilarRow {
  id: string;
  rank: number;
}

interface AuditRow {
  matter_id: string;
  action: string;
  details: Record<string, unknown> | null;
}

export async function getHistoricalToolHints(
  db: Db,
  args: { matterId: string; requestText: string; k?: number },
): Promise<ToolHistoryResult> {
  const k = args.k ?? 10;
  const searchText = args.requestText.slice(0, 500);

  // K-nearest-neighbor via text similarity. Same tsvector + ts_rank
  // pattern as context-fetch-similar-matters so the relevance proxy
  // is consistent across the system. Excludes the current matter.
  // Includes only matters with status != 'cancelled' so abandoned
  // intakes don't bias the signal.
  const similar = await db.execute(sql`
    SELECT id::text AS id,
      ts_rank(
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '')),
        plainto_tsquery('english', ${searchText})
      ) AS rank
    FROM matters
    WHERE id != ${args.matterId}::uuid
      AND status != 'cancelled'
      AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, ''))
          @@ plainto_tsquery('english', ${searchText})
    ORDER BY rank DESC
    LIMIT ${k}
  `);
  const similarRows = similar as unknown as SimilarRow[];

  if (similarRows.length === 0) {
    return { similarMattersConsidered: 0, signals: [], topSimilarIds: [] };
  }

  const similarIds = similarRows.map((r) => r.id);

  // Aggregate audit_log events for the similar matters. We look at
  // three event kinds the tool router writes:
  //   tool.invoked         — lawyer triggered the tool (whether
  //                          output ended up accepted or rejected)
  //   tool.invoke_blocked  — lawyer wanted to but tool was disabled
  //   tool.<kind>_complete — worker finished a tool run (added to
  //                          audit_log by run-statutory / run-case-law
  //                          / run-deconstruct). Used as an acceptance
  //                          proxy: the lawyer didn't cancel mid-flight.
  const events = await db.execute(sql`
    SELECT matter_id::text AS matter_id, action, details
    FROM audit_log
    WHERE matter_id = ANY(${similarIds}::uuid[])
      AND action IN (
        'tool.invoked',
        'tool.invoke_blocked',
        'tool.statutory_complete',
        'tool.case_law_complete',
        'tool.deconstruct_complete'
      )
  `);
  const auditRows = events as unknown as AuditRow[];

  // Per-tool tallies. invocationCount is the number of distinct
  // matters where the tool was invoked (not the number of times —
  // multi-jurisdiction invocations write multiple jobIds in a single
  // audit row). acceptanceCount tallies tool.*_complete events
  // (worker successfully wrote a complete stage row).
  const tools: Array<'statutory' | 'case_law' | 'deconstruct'> = [
    'statutory',
    'case_law',
    'deconstruct',
  ];
  const invocationMatters: Record<string, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  const acceptanceMatters: Record<string, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  const blockedMatters: Record<string, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };

  for (const r of auditRows) {
    if (r.action === 'tool.invoked') {
      const tool = (r.details?.tool as string | undefined) ?? '';
      if (invocationMatters[tool]) invocationMatters[tool].add(r.matter_id);
    } else if (r.action === 'tool.invoke_blocked') {
      const tool = (r.details?.tool as string | undefined) ?? '';
      if (blockedMatters[tool]) blockedMatters[tool].add(r.matter_id);
    } else if (r.action === 'tool.statutory_complete') {
      acceptanceMatters.statutory.add(r.matter_id);
    } else if (r.action === 'tool.case_law_complete') {
      acceptanceMatters.case_law.add(r.matter_id);
    } else if (r.action === 'tool.deconstruct_complete') {
      acceptanceMatters.deconstruct.add(r.matter_id);
    }
  }

  const signals: ToolHistoricalSignal[] = tools.map((tool) => {
    const inv = invocationMatters[tool].size;
    const acc = acceptanceMatters[tool].size;
    const blk = blockedMatters[tool].size;
    return {
      tool,
      invocationCount: inv,
      acceptanceCount: acc,
      blockedCount: blk,
      invocationRate: similarRows.length > 0 ? inv / similarRows.length : 0,
      // Acceptance / invocation (not acceptance / similar) — answers
      // "when invoked, how often did the run complete." A future PR
      // will track explicit accept/reject events for a sharper signal.
      acceptanceRate: inv > 0 ? acc / inv : 0,
    };
  });

  return {
    similarMattersConsidered: similarRows.length,
    signals,
    topSimilarIds: similarIds.slice(0, 5),
  };
}
