import { sql } from 'drizzle-orm';
import { playbooks, playbookEditProposals, type Db } from '@legal/db';
import { env } from '../env.js';
import { fetchNotionPageExcerpt } from '../integrations/notion.js';

// M7 — Weekly cron that turns closed-matter outcomes into proposed
// playbook edits. For each playbook that matched in Stage 1 on a
// matter that has since closed, the worker:
//   1. Pulls the playbook's current Notion content
//   2. Pulls the matter's final accepted summary (from M2)
//   3. Asks the AI service to propose targeted edits to the playbook
//      that would have made it more accurate for this matter
//   4. Persists proposals as 'pending' in playbook_edit_proposals
//
// Admins review on /admin/playbook-edit-proposals and accept or
// dismiss. Accepted edits land in audit_log; pushing the diff back
// to Notion is a follow-up PR.
//
// Empty-signal short-circuits mirror M1/M5: no closed matters with
// matched playbooks → 'no_candidates'; AI service unreachable →
// 'ai_unavailable'. Both are non-fatal.

const MIN_CANDIDATES = 1;
const MAX_CANDIDATES_PER_RUN = 25;
const MAX_PLAYBOOK_EXCERPT_CHARS = 4000;
const MAX_SUMMARY_CHARS = 3000;

interface CandidateRow {
  matter_id: string;
  notion_page_id: string;
  matter_title: string;
  matter_summary: string;
  closed_at: Date;
}

interface AiRequestEvidenceMatter {
  matter_id: string;
  matter_title: string;
  matter_summary: string;
}

interface AiRequestProposal {
  notion_page_id: string;
  playbook_id: string | null;
  playbook_title: string;
  playbook_excerpt: string;
  evidence_matters: AiRequestEvidenceMatter[];
}

interface AiResponseEdit {
  notion_page_id: string;
  section: string;
  proposed_edit: string;
  rationale: string;
  evidence_matter_ids: string[];
}

interface AiResponse {
  edits: AiResponseEdit[];
}

export interface MinePlaybookEditsResult {
  candidateCount: number;
  proposalCount: number;
  skipped: 'no_candidates' | 'ai_unavailable' | 'disabled' | null;
}

async function callExtractApi(
  proposals: AiRequestProposal[],
): Promise<AiResponse | null> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/extract-playbook-edits`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ proposals }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`extract-playbook-edits failed: ${res.status} ${body.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as AiResponse;
  } catch (err) {
    console.warn('extract-playbook-edits threw:', err);
    return null;
  }
}

export async function runMinePlaybookEdits(
  db: Db,
  options: {
    lookbackDays?: number;
    mode?: 'off' | 'shadow' | 'on';
    matterId?: string;
  } = {},
): Promise<MinePlaybookEditsResult> {
  const mode = options.mode ?? 'off';
  if (mode === 'off') {
    return { candidateCount: 0, proposalCount: 0, skipped: 'disabled' };
  }
  const lookbackDays = options.lookbackDays ?? 7;

  // Find (matter, notion_page_id) pairs where:
  //   - audit_log recorded a playbook.matched_in_guidance for this matter
  //   - matter has closed (status = 'closed') and either is within the
  //     lookback window OR was scoped explicitly via options.matterId
  //     (single-matter mode, fired by the on-close trigger)
  //   - matter has a generated summary (M2)
  // One row per pair — we cluster by playbook below.
  const candidates = options.matterId
    ? ((await db.execute(sql`
        SELECT DISTINCT
          m.id::text AS matter_id,
          m.title AS matter_title,
          (al.details->>'notion_page_id') AS notion_page_id,
          ms.summary_md AS matter_summary,
          m.updated_at AS closed_at
        FROM audit_log al
        JOIN matters m ON m.id = al.matter_id
        JOIN matter_summaries ms ON ms.matter_id = m.id
        WHERE al.action = 'playbook.matched_in_guidance'
          AND al.details->>'notion_page_id' IS NOT NULL
          AND m.status = 'closed'
          AND m.id = ${options.matterId}::uuid
        LIMIT ${MAX_CANDIDATES_PER_RUN}
      `)) as unknown as CandidateRow[])
    : ((await db.execute(sql`
        SELECT DISTINCT
          m.id::text AS matter_id,
          m.title AS matter_title,
          (al.details->>'notion_page_id') AS notion_page_id,
          ms.summary_md AS matter_summary,
          m.updated_at AS closed_at
        FROM audit_log al
        JOIN matters m ON m.id = al.matter_id
        JOIN matter_summaries ms ON ms.matter_id = m.id
        WHERE al.action = 'playbook.matched_in_guidance'
          AND al.details->>'notion_page_id' IS NOT NULL
          AND m.status = 'closed'
          AND m.updated_at >= now() - (${lookbackDays} || ' days')::interval
        ORDER BY m.updated_at DESC
        LIMIT ${MAX_CANDIDATES_PER_RUN}
      `)) as unknown as CandidateRow[]);

  if (candidates.length < MIN_CANDIDATES) {
    return { candidateCount: candidates.length, proposalCount: 0, skipped: 'no_candidates' };
  }

  // Group candidates by playbook (notion_page_id). Each group becomes
  // one AI proposal request carrying up to N evidence matters.
  const byPage = new Map<string, CandidateRow[]>();
  for (const c of candidates) {
    const list = byPage.get(c.notion_page_id) ?? [];
    list.push(c);
    byPage.set(c.notion_page_id, list);
  }

  // Resolve playbook registry rows so we can attach playbook_id and
  // title for proposals whose pages are registered. Pages without a
  // registry row still get proposed — playbook_id is null.
  const allPages = Array.from(byPage.keys());
  const registered = await db
    .select({
      id: playbooks.id,
      notionPageId: playbooks.notionPageId,
      title: playbooks.title,
    })
    .from(playbooks)
    .where(sql`${playbooks.notionPageId} = ANY(${allPages}::text[])`);
  const registryByPage = new Map(
    registered.map((r) => [r.notionPageId, { id: r.id, title: r.title }]),
  );

  // Build AI proposal payload. Fetch each playbook's Notion excerpt
  // in parallel; if Notion is unreachable for a given page, skip it
  // (no apiKey is also a skip — same short-circuit).
  const apiKey = env.NOTION_API_KEY;
  const aiProposals: AiRequestProposal[] = [];
  if (!apiKey) {
    return { candidateCount: candidates.length, proposalCount: 0, skipped: 'ai_unavailable' };
  }

  await Promise.all(
    Array.from(byPage.entries()).map(async ([pageId, rows]) => {
      let excerpt = '';
      try {
        excerpt = await fetchNotionPageExcerpt(apiKey, pageId, MAX_PLAYBOOK_EXCERPT_CHARS);
      } catch (err) {
        console.warn(`mine-playbook-edits: notion fetch failed for ${pageId}:`, err);
        return;
      }
      if (!excerpt.trim()) return;
      const registry = registryByPage.get(pageId) ?? null;
      aiProposals.push({
        notion_page_id: pageId,
        playbook_id: registry?.id ?? null,
        playbook_title: registry?.title ?? rows[0]?.matter_title ?? 'Untitled playbook',
        playbook_excerpt: excerpt,
        evidence_matters: rows.map((r) => ({
          matter_id: r.matter_id,
          matter_title: r.matter_title,
          matter_summary: (r.matter_summary ?? '').slice(0, MAX_SUMMARY_CHARS),
        })),
      });
    }),
  );

  if (aiProposals.length === 0) {
    return { candidateCount: candidates.length, proposalCount: 0, skipped: 'ai_unavailable' };
  }

  // In shadow mode we run the full mining loop but write nothing.
  // That lets operators see the candidate flow in worker logs before
  // committing proposals to the admin queue.
  if (mode === 'shadow') {
    console.log(
      `mine-playbook-edits [shadow]: ${candidates.length} candidates → ${aiProposals.length} playbook payloads (no proposals written)`,
    );
    return { candidateCount: candidates.length, proposalCount: 0, skipped: null };
  }

  const apiResp = await callExtractApi(aiProposals);
  if (!apiResp) {
    return {
      candidateCount: candidates.length,
      proposalCount: 0,
      skipped: 'ai_unavailable',
    };
  }

  let inserted = 0;
  for (const edit of apiResp.edits) {
    const registry = registryByPage.get(edit.notion_page_id) ?? null;
    const proposal = aiProposals.find((p) => p.notion_page_id === edit.notion_page_id);
    if (!proposal) continue;
    await db.insert(playbookEditProposals).values({
      playbookId: registry?.id ?? null,
      notionPageId: edit.notion_page_id,
      playbookTitle: proposal.playbook_title,
      section: edit.section.slice(0, 200),
      proposedEdit: edit.proposed_edit.slice(0, 4000),
      rationale: edit.rationale.slice(0, 2000),
      evidenceMatterIds: edit.evidence_matter_ids,
      evidenceCount: edit.evidence_matter_ids.length,
    });
    inserted += 1;
  }

  console.log(
    `mine-playbook-edits: ${candidates.length} candidates → ${inserted} proposals`,
  );
  return {
    candidateCount: candidates.length,
    proposalCount: inserted,
    skipped: null,
  };
}

// Helper for admin pages: count of pending proposals (badge).
export async function countPendingPlaybookEdits(db: Db): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM playbook_edit_proposals
    WHERE status = 'pending'
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

