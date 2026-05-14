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
  // PR11 — which similarity backend produced the K-NN ranking.
  // 'embedding' is preferred when available; 'tsvector' is the fallback
  // for matters whose embedding column is null.
  similarityBackend: 'embedding' | 'tsvector' | 'none';
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

  // PR11 — pgvector swap when the current matter has an embedding.
  // Falls back to the tsvector path when embeddings aren't populated
  // (OPENAI_API_KEY / VOYAGE_API_KEY not configured, or
  // generate-embedding job hasn't run yet). Both paths return the
  // same SimilarRow shape so downstream aggregation is identical.
  //
  // Cosine distance via `<=>` is the standard pgvector operator;
  // smaller = more similar. We convert distance → rank so the same
  // sort + threshold semantics carry over.
  const currentMatter = await db.execute(sql`
    SELECT embedding IS NOT NULL AS has_embedding
    FROM matters
    WHERE id = ${args.matterId}::uuid
    LIMIT 1
  `);
  const hasEmbedding = (
    (currentMatter as unknown as Array<{ has_embedding: boolean }>)[0]?.has_embedding
  ) === true;

  let similarRows: SimilarRow[];
  if (hasEmbedding) {
    // M2 — Prefer matter_summaries.summary_embedding when the
    // candidate matter has one (closed + compacted). Summary
    // embeddings reflect the resolved outcome, not just intake text,
    // so K-NN quality goes up. Fallback to matters.embedding via
    // COALESCE; matters that never closed (or didn't compact) still
    // participate in the ranking using their intake embedding.
    const similar = await db.execute(sql`
      WITH q AS (
        SELECT embedding AS qvec
        FROM matters
        WHERE id = ${args.matterId}::uuid
      )
      SELECT m.id::text AS id,
        1 - (COALESCE(ms.summary_embedding, m.embedding) <=> (SELECT qvec FROM q)) AS rank
      FROM matters m
      LEFT JOIN matter_summaries ms ON ms.matter_id = m.id
      WHERE m.id != ${args.matterId}::uuid
        AND m.status != 'cancelled'
        AND COALESCE(ms.summary_embedding, m.embedding) IS NOT NULL
      ORDER BY COALESCE(ms.summary_embedding, m.embedding) <=> (SELECT qvec FROM q)
      LIMIT ${k}
    `);
    similarRows = similar as unknown as SimilarRow[];
  } else {
    // Tsvector fallback — same logic as PR8 originally shipped.
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
    similarRows = similar as unknown as SimilarRow[];
  }

  if (similarRows.length === 0) {
    return {
      similarMattersConsidered: 0,
      signals: [],
      topSimilarIds: [],
      similarityBackend: 'none',
    };
  }

  const similarIds = similarRows.map((r) => r.id);

  // Aggregate audit_log events for the similar matters. PR10 added
  // explicit lawyer-decision events (analysis.stage_accepted /
  // analysis.stage_rejected / analysis.stage_escalated) which give a
  // sharper acceptance signal than the prior proxy. We still tally
  // tool.invoked + tool.invoke_blocked for invocation rate, and use
  // tool.*_complete as a fallback acceptance proxy when no explicit
  // lawyer decision was recorded (e.g., for matters created before
  // PR10 shipped).
  // Compare matter_id as text against a text[] parameter. The
  // `db.execute(sql\`...\`)` raw path doesn't carry the schema-driven
  // type hints the query builder uses, so postgres-js infers a JS
  // string[] as a `record` and `record::uuid[]` blows up with
  // `cannot cast type record to uuid[]`. Casting matter_id to text
  // and the param to text[] sidesteps the inference entirely.
  const events = await db.execute(sql`
    SELECT matter_id::text AS matter_id, action, details
    FROM audit_log
    WHERE matter_id::text = ANY(${similarIds}::text[])
      AND action IN (
        'tool.invoked',
        'tool.invoke_blocked',
        'tool.statutory_complete',
        'tool.case_law_complete',
        'tool.deconstruct_complete',
        'analysis.stage_accepted',
        'analysis.stage_rejected',
        'analysis.stage_escalated'
      )
  `);
  const auditRows = events as unknown as AuditRow[];

  // Per-tool tallies. invocationCount is the number of distinct
  // matters where the tool was invoked (not the number of times —
  // multi-jurisdiction invocations write multiple jobIds in a single
  // audit row). acceptanceCount tallies tool.*_complete events
  // (worker successfully wrote a complete stage row).
  type ToolKey = 'statutory' | 'case_law' | 'deconstruct';
  const tools: ToolKey[] = ['statutory', 'case_law', 'deconstruct'];
  const invocationMatters: Record<ToolKey, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  // explicitAcceptances: matters where the lawyer clicked Accept on
  // the corresponding tool's stage (PR10 signal).
  const explicitAcceptances: Record<ToolKey, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  // explicitRejections: lawyer clicked Reject/Escalate. Subtracts from
  // the acceptance numerator so the rate reflects net positive signal.
  const explicitRejections: Record<ToolKey, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  // completionMatters: worker emitted tool.*_complete. Fallback for
  // matters that don't yet have explicit lawyer decisions (PR10
  // shipping date forward).
  const completionMatters: Record<ToolKey, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  const blockedMatters: Record<ToolKey, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };

  const isToolKey = (s: string): s is ToolKey =>
    s === 'statutory' || s === 'case_law' || s === 'deconstruct';

  function stageNameFromDetails(details: Record<string, unknown> | null): ToolKey | null {
    const name = details?.stageName;
    if (typeof name !== 'string') return null;
    return isToolKey(name) ? name : null;
  }

  for (const r of auditRows) {
    if (r.action === 'tool.invoked') {
      const tool = (r.details?.tool as string | undefined) ?? '';
      if (isToolKey(tool)) invocationMatters[tool].add(r.matter_id);
    } else if (r.action === 'tool.invoke_blocked') {
      const tool = (r.details?.tool as string | undefined) ?? '';
      if (isToolKey(tool)) blockedMatters[tool].add(r.matter_id);
    } else if (r.action === 'tool.statutory_complete') {
      completionMatters.statutory.add(r.matter_id);
    } else if (r.action === 'tool.case_law_complete') {
      completionMatters.case_law.add(r.matter_id);
    } else if (r.action === 'tool.deconstruct_complete') {
      completionMatters.deconstruct.add(r.matter_id);
    } else if (r.action === 'analysis.stage_accepted') {
      const stage = stageNameFromDetails(r.details);
      if (stage) explicitAcceptances[stage].add(r.matter_id);
    } else if (
      r.action === 'analysis.stage_rejected' ||
      r.action === 'analysis.stage_escalated'
    ) {
      const stage = stageNameFromDetails(r.details);
      if (stage) explicitRejections[stage].add(r.matter_id);
    }
  }

  // Per-tool acceptance = explicit accepts when any are recorded for
  // the tool; otherwise fall back to the worker-completion proxy from
  // PR8. Subtract explicit rejections from acceptance to avoid
  // double-counting matters that started with a completion but later
  // got rejected by the lawyer.
  const acceptanceMatters: Record<ToolKey, Set<string>> = {
    statutory: new Set(),
    case_law: new Set(),
    deconstruct: new Set(),
  };
  for (const tool of tools) {
    const explicit = explicitAcceptances[tool];
    const rejected = explicitRejections[tool];
    if (explicit.size > 0 || rejected.size > 0) {
      // Explicit signal exists — use it.
      for (const id of explicit) acceptanceMatters[tool].add(id);
    } else {
      // Fall back to the completion proxy for older matters.
      for (const id of completionMatters[tool]) acceptanceMatters[tool].add(id);
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
    similarityBackend: hasEmbedding ? 'embedding' : 'tsvector',
  };
}
