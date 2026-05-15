import { eq } from 'drizzle-orm';
import {
  auditLog,
  jobs,
  matterAnalyses,
  type Db,
  type Matter,
} from '@legal/db';
import { env } from '../../env.js';

// PR-11 — explicit escalation handling.
// When any skill emits escalation_request on its response, the worker
// calls this helper to mark the analysis escalated, audit-log the
// reason, and notify Slack. The caller may then short-circuit
// downstream stages (Stage 0 escalation skips Stage 1, etc.).

export type EscalationReason =
  | 'practice_area_mismatch'
  | 'jurisdiction_outside_competence'
  | 'unresolvable_frame_flip'
  | 'too_many_missing_facts'
  | 'authority_directly_contradicts_prior_stage'
  | 'novel_legal_question'
  | 'verification_failure';

export interface EscalationPayload {
  reason: EscalationReason;
  detail: string;
  recommended_next_step: string;
}

export async function persistEscalation(
  db: Db,
  matter: Matter,
  analysisId: string,
  raisedByStage: string,
  payload: EscalationPayload,
  shadowMode: boolean,
): Promise<void> {
  await db
    .update(matterAnalyses)
    .set({
      status: 'escalated',
      escalatedAt: new Date(),
      escalationReason: `${payload.reason}: ${payload.detail}`.slice(0, 1000),
    })
    .where(eq(matterAnalyses.id, analysisId));

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.escalated_by_skill',
    details: {
      analysisId,
      raisedByStage,
      reason: payload.reason,
      detail: payload.detail,
      recommendedNextStep: payload.recommended_next_step,
    },
  });

  if (shadowMode) return;

  // Slack notify — high-priority. Routed through the same notify job
  // pipeline as triage notifications.
  const matterUrl = `${env.WEB_APP_URL}/matters/${matter.id}`;
  await db.insert(jobs).values({
    kind: 'slack_notify',
    matterId: matter.id,
    payload: {
      matter_id: matter.id,
      text: [
        `*${matter.shortId}* — analysis escalated`,
        `*Reason:* ${payload.reason.replace(/_/g, ' ')}`,
        payload.detail,
        `*Recommended:* ${payload.recommended_next_step}`,
        matterUrl,
      ].join('\n'),
    },
  });
}
