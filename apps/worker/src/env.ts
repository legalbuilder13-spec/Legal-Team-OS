import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TOKEN: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_USER_TOKEN: z.string().optional(),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  POLL_INTERVAL_MS: z.coerce.number().default(2000),
  DIGEST_CRON: z.string().default('0 9 * * 1-5'),
  DIGEST_TIMEZONE: z.string().default('America/Los_Angeles'),
  OPENAI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  NOTION_API_KEY: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_DEFAULT_FOLDER_ID: z.string().optional(),
  // PRD §19.1: gate for the pre-review analysis pipeline. Default off
  // until per-organization shadow-mode validation completes.
  ANALYSIS_PIPELINE_ENABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('shadow')])
    .default('false'),
});

export const env = Env.parse(process.env);
