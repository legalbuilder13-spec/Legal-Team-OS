import { sql } from 'drizzle-orm';
import {
  matterAnalysisStages,
  domainConfigProposals,
  organizations,
  matterAnalyses,
  matters,
  type Db,
} from '@legal/db';
import { env } from '../env.js';

// M5 — Weekly cron that diffs lawyer revisions against the AI's
// original stage output and extracts terminology / verb / jurisdiction
// patterns the org should encode in domain_config. The miner sends N
// (original, revised) pairs to the AI service /extract-terminology-diffs
// skill; the skill returns ≥2-supportable proposals; we persist as
// 'pending' domain_config_proposals for admin review.

const MIN_REVISIONS = 2;
const MAX_REVISIONS_PER_RUN = 50;

interface RevisionRow {
  stage_id: string;
  stage_name: string;
  practice_area: string | null;
  original_text: string;
  revised_text: string;
}

interface ExtractApiResponse {
  organization_id: string | null;
  revision_count: number;
  proposals: Array<{
    patch_path: string;
    patch_value: Record<string, unknown>;
    rationale: string;
    evidence: Array<{
      stage_id: string;
      original_excerpt: string;
      revised_excerpt: string;
    }>;
  }>;
}

function extractOriginalText(outputJson: Record<string, unknown> | null): string {
  if (!outputJson) return '';
  // Prefer narrative fields. Statutory uses 'analysis_memo' or
  // 'operative_provisions'; case-law uses 'controlling_authority';
  // deconstruct uses 'memo.application' etc. Fall back to flat JSON.
  const candidates = [
    outputJson.analysis_memo,
    outputJson.summary,
    (outputJson.memo as Record<string, unknown> | undefined)?.application,
    outputJson.controlling_authority,
    outputJson.headline_answer,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 20) return c.slice(0, 4000);
  }
  try {
    return JSON.stringify(outputJson).slice(0, 4000);
  } catch {
    return '';
  }
}

async function callExtractApi(
  organizationId: string | null,
  revisions: RevisionRow[],
): Promise<ExtractApiResponse | null> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/extract-terminology-diffs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        organization_id: organizationId,
        revisions,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`extract-terminology-diffs failed: ${res.status} ${body.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as ExtractApiResponse;
  } catch (err) {
    console.warn('extract-terminology-diffs threw:', err);
    return null;
  }
}

export interface MineRevisionsResult {
  revisionCount: number;
  proposalCount: number;
  skipped: 'no_revisions' | 'ai_unavailable' | null;
}

export async function runMineRevisions(
  db: Db,
  options: { lookbackDays?: number; organizationId?: string | null } = {},
): Promise<MineRevisionsResult> {
  const lookbackDays = options.lookbackDays ?? 30;
  const organizationId = options.organizationId ?? null;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Pull every stage that has a lawyer_revised_output set and was
  // decided (accepted/rejected). Limit by lookback to keep prompt
  // size sane.
  const stages = await db
    .select({
      id: matterAnalysisStages.id,
      stageName: matterAnalysisStages.stageName,
      outputJson: matterAnalysisStages.outputJson,
      lawyerRevisedOutput: matterAnalysisStages.lawyerRevisedOutput,
      analysisId: matterAnalysisStages.analysisId,
      decidedAt: matterAnalysisStages.lawyerDecidedAt,
    })
    .from(matterAnalysisStages)
    .where(
      sql`${matterAnalysisStages.lawyerRevisedOutput} IS NOT NULL
        AND ${matterAnalysisStages.lawyerDecidedAt} >= ${since}`,
    )
    .limit(MAX_REVISIONS_PER_RUN);

  if (stages.length < MIN_REVISIONS) {
    return {
      revisionCount: stages.length,
      proposalCount: 0,
      skipped: 'no_revisions',
    };
  }

  // Resolve each stage's practice_area via its analysis → matter.
  const analysisIds = Array.from(new Set(stages.map((s) => s.analysisId)));
  const analysisRows = await db
    .select({
      id: matterAnalyses.id,
      matterId: matterAnalyses.matterId,
    })
    .from(matterAnalyses)
    .where(sql`${matterAnalyses.id} = ANY(${analysisIds}::uuid[])`);
  const matterIdByAnalysis = new Map(analysisRows.map((a) => [a.id, a.matterId]));
  const matterIds = Array.from(new Set(analysisRows.map((a) => a.matterId)));
  const matterRows =
    matterIds.length > 0
      ? await db
          .select({ id: matters.id, practiceArea: matters.practiceArea })
          .from(matters)
          .where(sql`${matters.id} = ANY(${matterIds}::uuid[])`)
      : [];
  const practiceAreaByMatter = new Map(matterRows.map((m) => [m.id, m.practiceArea]));

  const revisions: RevisionRow[] = stages.flatMap((s) => {
    const revisedText =
      (s.lawyerRevisedOutput as { text?: string } | null)?.text ?? '';
    if (!revisedText) return [];
    const original = extractOriginalText(s.outputJson as Record<string, unknown> | null);
    if (!original) return [];
    const matterId = matterIdByAnalysis.get(s.analysisId);
    const practiceArea = matterId ? practiceAreaByMatter.get(matterId) ?? null : null;
    return [
      {
        stage_id: s.id,
        stage_name: s.stageName,
        practice_area: practiceArea,
        original_text: original,
        revised_text: revisedText.slice(0, 4000),
      },
    ];
  });

  if (revisions.length < MIN_REVISIONS) {
    return {
      revisionCount: revisions.length,
      proposalCount: 0,
      skipped: 'no_revisions',
    };
  }

  let resolvedOrg = organizationId;
  if (!resolvedOrg) {
    const def = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.slug} = 'default'`)
      .limit(1);
    resolvedOrg = def[0]?.id ?? null;
  }

  const apiResp = await callExtractApi(resolvedOrg, revisions);
  if (!apiResp) {
    return {
      revisionCount: revisions.length,
      proposalCount: 0,
      skipped: 'ai_unavailable',
    };
  }

  for (const p of apiResp.proposals) {
    await db.insert(domainConfigProposals).values({
      organizationId: resolvedOrg,
      patchPath: p.patch_path,
      patchValue: p.patch_value,
      rationale: p.rationale,
      evidenceCount: p.evidence.length,
      evidenceStageIds: p.evidence.map((e) => e.stage_id),
    });
  }

  console.log(
    `mine-revisions: ${revisions.length} revisions → ${apiResp.proposals.length} proposals`,
  );
  return {
    revisionCount: revisions.length,
    proposalCount: apiResp.proposals.length,
    skipped: null,
  };
}
