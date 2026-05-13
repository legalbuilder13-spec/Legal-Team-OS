import { z } from 'zod';

export const PracticeAreaSchema = z.enum([
  'commercial',
  'employment',
  'privacy',
  'litigation',
  'corporate',
  'regulatory',
  'ip',
  'real_estate',
  'other',
]);
export type PracticeArea = z.infer<typeof PracticeAreaSchema>;

export const PrioritySchema = z.enum(['high', 'medium', 'low']);
export type Priority = z.infer<typeof PrioritySchema>;

export const DEFAULT_SLA_HOURS_BY_AREA: Record<PracticeArea, number> = {
  commercial: 48,
  employment: 24,
  privacy: 24,
  litigation: 8,
  corporate: 72,
  regulatory: 48,
  ip: 72,
  real_estate: 72,
  other: 48,
};

export const MatterStatusSchema = z.enum([
  'open',
  'in_review',
  'waiting_on_requester',
  'waiting_on_third_party',
  'closed',
  'cancelled',
]);
export type MatterStatus = z.infer<typeof MatterStatusSchema>;

export * from './insight-card.js';
export * from './rule-dsl.js';

export const IntakePayloadSchema = z.object({
  source: z.literal('slack'),
  slackUserId: z.string().min(1),
  slackUserName: z.string(),
  slackUserEmail: z.string().email().nullable(),
  slackChannelId: z.string().min(1),
  slackTeamId: z.string().nullable(),
  slackThreadTs: z.string().nullable(),
  text: z.string().min(1),
  attachments: z
    .array(
      z.object({
        slackFileId: z.string(),
        filename: z.string(),
        mimeType: z.string().nullable(),
        sizeBytes: z.number().nullable(),
      }),
    )
    .default([]),
});
export type IntakePayload = z.infer<typeof IntakePayloadSchema>;
