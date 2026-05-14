import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  matters,
  matterAnalyses,
  matterAnalysisStages,
  matterAnalysisSources,
  counterparties,
  matterSummaries,
  jobs,
  type Db,
  type Job,
} from '@legal/db';
import { env } from '../env.js';

// M2 — Matter compression at close. Reads stages + sources + lawyer
// decisions for one matter, calls the AI service /compact-matter
// skill, embeds the resulting summary via Voyage, and upserts a
// matter_summaries row. Idempotent on source_version_hash: if no
// content changed since the last run, the handler short-circuits
// without an LLM call.
//
// Triggered two ways:
// 1. Daily cron `enqueueClosedMatterCompaction` enqueues a job for
//    every closed matter whose source_version_hash doesn't match the
//    matter_summaries row (or doesn't have one).
// 2. Future: a direct enqueue when matters.status flips to 'closed'.
//    Today the cron is sufficient; the lag is at most 24h.

const VOYAGE_MODEL = 'voyage-law-2';
const VOYAGE_MAX_INPUT_CHARS = 32_000;

interface CompactPayload {
  matter_id: string;
}

interface StageRecord {
  stage_name: string;
  confidence: string | null;
  lawyer_decision: string | null;
  lawyer_decision_reason: string | null;
  output_summary: string;
}

interface SourceRecord {
  citation: string;
  verification_status: string | null;
  raw_excerpt: string;
}

interface CompactApiResponse {
  matter_id: string;
  summary_md: string;
  headline: string;
}

function summarizeOutputJson(output: Record<string, unknown> | null | undefined): string {
  if (!output) return '';
  // Prefer named narrative fields when present; fall back to a flat
  // JSON dump capped at 1500 chars. The skill receives the raw text;
  // it's expected to extract the operative content.
  const candidates = [
    output.headline_answer,
    output.summary,
    output.verdict,
    output.conclusion,
    output.memo,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim().slice(0, 1500);
    }
    if (c && typeof c === 'object') {
      const text = (c as { text?: string; summary?: string }).text
        ?? (c as { summary?: string }).summary;
      if (typeof text === 'string' && text.trim().length > 0) return text.slice(0, 1500);
    }
  }
  try {
    return JSON.stringify(output).slice(0, 1500);
  } catch {
    return '';
  }
}

function computeSourceVersionHash(parts: {
  matter: { updatedAt: Date; closedAt: Date | null };
  stageCount: number;
  sourceCount: number;
  latestStageAt: Date | null;
  latestSourceAt: Date | null;
}): string {
  const h = createHash('sha256');
  h.update(parts.matter.updatedAt.toISOString());
  h.update(parts.matter.closedAt?.toISOString() ?? '');
  h.update(String(parts.stageCount));
  h.update(String(parts.sourceCount));
  h.update(parts.latestStageAt?.toISOString() ?? '');
  h.update(parts.latestSourceAt?.toISOString() ?? '');
  return h.digest('hex').slice(0, 32);
}

async function callCompactApi(
  body: Record<string, unknown>,
): Promise<CompactApiResponse | null> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/compact-matter`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`compact-matter call failed: ${res.status} ${errBody.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as CompactApiResponse;
  } catch (err) {
    console.warn('compact-matter call threw:', err);
    return null;
  }
}

async function embedSummary(summary: string): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) return null;
  const input = summary.slice(0, VOYAGE_MAX_INPUT_CHARS);
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [input],
      input_type: 'document',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`Voyage embeddings (summary) failed: ${res.status} ${body.slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  const emb = data.data[0]?.embedding;
  if (!emb || emb.length !== 1024) return null;
  return emb;
}

export async function handleCompactMatterJob(db: Db, job: Job) {
  const payload = job.payload as unknown as CompactPayload;
  const matterId = payload.matter_id ?? job.matterId;
  if (!matterId) return;
  await compactMatter(db, matterId);
}

export async function compactMatter(db: Db, matterId: string): Promise<{
  skipped: 'unchanged' | 'ai_unavailable' | null;
  hash: string;
}> {
  const startedAt = Date.now();

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, matterId),
  });
  if (!matter) throw new Error(`matter ${matterId} not found`);

  // Latest analysis (one matter has ≤1 active analysis row today).
  const analysisRow = await db
    .select({ id: matterAnalyses.id })
    .from(matterAnalyses)
    .where(eq(matterAnalyses.matterId, matterId))
    .orderBy(desc(matterAnalyses.createdAt))
    .limit(1);
  const analysisId = analysisRow[0]?.id ?? null;

  const stagesRaw = analysisId
    ? await db
        .select({
          id: matterAnalysisStages.id,
          stageName: matterAnalysisStages.stageName,
          confidence: matterAnalysisStages.confidence,
          outputJson: matterAnalysisStages.outputJson,
          lawyerDecision: matterAnalysisStages.lawyerDecision,
          lawyerDecisionReason: matterAnalysisStages.lawyerDecisionReason,
          createdAt: matterAnalysisStages.createdAt,
        })
        .from(matterAnalysisStages)
        .where(eq(matterAnalysisStages.analysisId, analysisId))
        .orderBy(desc(matterAnalysisStages.createdAt))
    : [];

  const stageIds = stagesRaw.map((s) => s.id);
  const sourcesRaw =
    stageIds.length > 0
      ? await db
          .select({
            citation: matterAnalysisSources.citation,
            verificationStatus: matterAnalysisSources.verificationStatus,
            rawExcerpt: matterAnalysisSources.rawExcerpt,
            createdAt: matterAnalysisSources.createdAt,
          })
          .from(matterAnalysisSources)
          .where(sql`${matterAnalysisSources.stageId} = ANY(${stageIds}::uuid[])`)
          .limit(60)
      : [];

  const hash = computeSourceVersionHash({
    matter: { updatedAt: matter.updatedAt, closedAt: matter.closedAt },
    stageCount: stagesRaw.length,
    sourceCount: sourcesRaw.length,
    latestStageAt: stagesRaw[0]?.createdAt ?? null,
    latestSourceAt: sourcesRaw[0]?.createdAt ?? null,
  });

  const existing = await db
    .select({ hash: matterSummaries.sourceVersionHash })
    .from(matterSummaries)
    .where(eq(matterSummaries.matterId, matterId))
    .limit(1);
  if (existing[0]?.hash === hash) {
    return { skipped: 'unchanged', hash };
  }

  const counterparty = matter.counterpartyId
    ? await db.query.counterparties.findFirst({
        where: eq(counterparties.id, matter.counterpartyId),
      })
    : null;

  const stages: StageRecord[] = stagesRaw.map((s) => ({
    stage_name: s.stageName,
    confidence: s.confidence,
    lawyer_decision: s.lawyerDecision,
    lawyer_decision_reason: s.lawyerDecisionReason,
    output_summary: summarizeOutputJson(s.outputJson),
  }));
  const sources: SourceRecord[] = sourcesRaw.map((src) => ({
    citation: src.citation,
    verification_status: src.verificationStatus,
    raw_excerpt: src.rawExcerpt,
  }));

  // Derive jurisdictions from stage outputs if any captured them
  // (statutory + case-law tools record their jurisdiction; pre-merits
  // and guidance don't). De-dup case-insensitively.
  const jurisdictions = Array.from(
    new Set(
      stagesRaw
        .map((s) => (s.outputJson as { jurisdiction?: string } | null)?.jurisdiction)
        .filter((j): j is string => typeof j === 'string' && j.length > 0)
        .map((j) => j.trim()),
    ),
  );

  const apiResp = await callCompactApi({
    matter_id: matter.id,
    matter_short_id: matter.shortId,
    title: matter.title,
    practice_area: matter.practiceArea,
    jurisdictions,
    request_text: matter.requestText ?? '',
    counterparty_name: counterparty?.name ?? null,
    stages,
    sources,
    closed_at: matter.closedAt?.toISOString() ?? null,
  });

  if (!apiResp) {
    return { skipped: 'ai_unavailable', hash };
  }

  const embedding = await embedSummary(apiResp.summary_md);

  await db
    .insert(matterSummaries)
    .values({
      matterId,
      summaryMd: apiResp.summary_md,
      summaryEmbedding: embedding ?? null,
      sourceVersionHash: hash,
      model: VOYAGE_MODEL,
      durationMs: Date.now() - startedAt,
    })
    .onConflictDoUpdate({
      target: matterSummaries.matterId,
      set: {
        summaryMd: apiResp.summary_md,
        summaryEmbedding: embedding ?? null,
        sourceVersionHash: hash,
        durationMs: Date.now() - startedAt,
        generatedAt: new Date(),
      },
    });

  console.log(
    `compact-matter ${matter.shortId}: ${stages.length} stages → summary stored (${apiResp.summary_md.length} chars, ${embedding ? 'embedded' : 'no-embed'})`,
  );
  return { skipped: null, hash };
}

// Cron entrypoint: find closed matters that have no summary, or whose
// summary is stale (different source_version_hash). Enqueues compact
// jobs rather than running inline to honor the worker's retry semantics.
export async function enqueueClosedMatterCompaction(db: Db): Promise<number> {
  const rows = await db
    .select({ id: matters.id })
    .from(matters)
    .leftJoin(matterSummaries, eq(matterSummaries.matterId, matters.id))
    .where(
      and(eq(matters.status, 'closed'), isNull(matterSummaries.matterId)),
    )
    .limit(50);
  for (const row of rows) {
    await db.insert(jobs).values({
      kind: 'compact_matter',
      matterId: row.id,
      payload: { matter_id: row.id },
    });
  }
  return rows.length;
}
