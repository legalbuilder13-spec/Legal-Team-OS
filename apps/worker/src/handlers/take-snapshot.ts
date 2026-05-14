import { eq } from 'drizzle-orm';
import {
  matterAnalysisSources,
  type Db,
  type Job,
} from '@legal/db';
import type { AnalysisVerificationStatus } from '@legal/types';
import { env } from '../env.js';
import { capturePageSnapshot } from '../integrations/playwright_snapshot.js';
import { putSnapshot } from '../integrations/snapshot_storage.js';

// PRD §9.2 step 3 — full screenshot-and-compare verification.
// Enqueued by run-statutory.ts and run-case-law.ts after their source
// rows are written. Captures the page via Playwright, uploads the PNG
// to S3-compatible storage, writes the resulting URL to
// matter_analysis_sources.verification_evidence_url, and (for sources
// with raw_excerpt) re-verifies that excerpt appears in the rendered
// page text. Discrepancies flip verification_status.

interface TakeSnapshotPayload {
  source_id: string;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function compareExcerpt(
  excerpt: string,
  pageText: string,
): AnalysisVerificationStatus {
  if (!excerpt) return 'verified';
  // Compare against a normalized window of the page text. Exact match
  // of the excerpt = verified. A relaxed substring match where 80% of
  // word tokens appear = minor_discrepancy. Otherwise material.
  const target = normalize(excerpt);
  const haystack = normalize(pageText);
  if (haystack.includes(target)) return 'verified';

  const tokens = target.split(' ').filter((t) => t.length > 3);
  if (tokens.length === 0) return 'minor_discrepancy';
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  const ratio = hits / tokens.length;
  if (ratio >= 0.8) return 'minor_discrepancy';
  return 'material_discrepancy';
}

export async function handleTakeSnapshotJob(db: Db, job: Job) {
  if (env.SCREENSHOTS_ENABLED !== 'true') {
    console.log('take-snapshot: SCREENSHOTS_ENABLED=false, skipping');
    return;
  }

  const payload = job.payload as unknown as TakeSnapshotPayload;
  const source = await db.query.matterAnalysisSources.findFirst({
    where: eq(matterAnalysisSources.id, payload.source_id),
  });
  if (!source) throw new Error(`source ${payload.source_id} not found`);
  if (!source.url) {
    // No URL to snapshot. Leave verification_status as-is.
    console.log(`take-snapshot: source ${source.id} has no URL, skipping`);
    return;
  }

  const result = await capturePageSnapshot(source.url);
  if (!result) {
    // Playwright failed or wasn't available. Mark the source as
    // unverifiable so the lawyer sees that the screenshot gate didn't
    // produce evidence; the text-level verification from upstream
    // still stands.
    await db
      .update(matterAnalysisSources)
      .set({ verificationStatus: 'unverifiable' })
      .where(eq(matterAnalysisSources.id, source.id));
    return;
  }

  // Upload the PNG. Key includes the source id for traceability +
  // a content sha so the same URL fetched twice doesn't collide.
  const key = `analysis/${source.id}/${result.contentSha.slice(0, 12)}.png`;
  const upload = await putSnapshot(key, result.pngBuffer, 'image/png');

  // Verify excerpt against rendered text.
  const verification = compareExcerpt(source.rawExcerpt, result.visibleText);

  await db
    .update(matterAnalysisSources)
    .set({
      verificationEvidenceUrl: upload?.publicUrl ?? `s3://${env.SNAPSHOTS_BUCKET}/${key}`,
      verificationStatus: verification,
    })
    .where(eq(matterAnalysisSources.id, source.id));
}
