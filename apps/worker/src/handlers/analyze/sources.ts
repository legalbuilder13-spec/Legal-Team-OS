import { createHash } from 'node:crypto';
import { matterAnalysisSources, type Db } from '@legal/db';
import type { AnalysisSourceType, AnalysisVerificationStatus } from '@legal/types';

// PRD §7.2 — every factual claim a stage makes traces to a
// matter_analysis_sources row. This helper is the single write path so the
// audit backbone stays consistent. Verification status starts 'pending';
// the verification protocol (PRD §9, Phase 2+) flips it.

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
  return row!.id;
}
