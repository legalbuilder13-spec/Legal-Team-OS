import { createHash } from 'node:crypto';
import { matterAnalysisSources, jobs, type Db } from '@legal/db';
import type { AnalysisSourceType, AnalysisVerificationStatus } from '@legal/types';
import { env } from '../../env.js';

// PRD §7.2 — every factual claim a stage makes traces to a
// matter_analysis_sources row. This helper is the single write path so the
// audit backbone stays consistent. Verification status starts 'pending';
// the verification protocol flips it. PR6: when SCREENSHOTS_ENABLED and
// the source has a URL, also enqueue a take_snapshot job so the full
// PRD §9.2 screenshot-and-compare gate fires asynchronously.

export interface RecordSourceInput {
  stageId: string;
  sourceType: AnalysisSourceType;
  citation: string;
  url?: string;
  rawExcerpt: string;
  // Optional precomputed hash; falls back to SHA256 of rawExcerpt+citation.
  hash?: string;
  verificationStatus?: AnalysisVerificationStatus;
  verificationEvidenceUrl?: string;
}

export function hashContent(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

export async function recordSource(db: Db, input: RecordSourceInput): Promise<string> {
  const hash = input.hash ?? hashContent(input.citation, input.rawExcerpt);
  const [row] = await db
    .insert(matterAnalysisSources)
    .values({
      stageId: input.stageId,
      sourceType: input.sourceType,
      citation: input.citation,
      url: input.url,
      hash,
      rawExcerpt: input.rawExcerpt,
      verificationStatus: input.verificationStatus ?? 'pending',
      verificationEvidenceUrl: input.verificationEvidenceUrl,
    })
    .returning({ id: matterAnalysisSources.id });
  const sourceId = row!.id;

  // PR6 — screenshot gate (PRD §9.2 step 3). Only fires when the
  // feature flag is on AND the source has a URL AND verification
  // isn't already a terminal failure (no point screenshotting a
  // not_found source). The handler itself short-circuits if the
  // flag goes off between enqueue + dispatch.
  if (
    env.SCREENSHOTS_ENABLED === 'true' &&
    input.url &&
    (input.verificationStatus ?? 'pending') !== 'not_found' &&
    (input.verificationStatus ?? 'pending') !== 'unverifiable'
  ) {
    await db.insert(jobs).values({
      kind: 'take_snapshot',
      payload: { source_id: sourceId },
    });
  }

  return sourceId;
}
