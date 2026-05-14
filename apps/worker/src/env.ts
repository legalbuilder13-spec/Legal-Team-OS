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
  // PRD §11 + §20.2 — case-law backend. Optional; without it the worker
  // hits CourtListener's anonymous tier (~100 req/day rate limit).
  // Commercial citator providers can be plumbed in with their own env
  // vars + a fetcher under integrations/case_law_sources.ts.
  COURTLISTENER_API_KEY: z.string().optional(),
  // PRD §9.2 — screenshot-and-compare verification. When SCREENSHOTS_ENABLED
  // is true, the worker uses Playwright + an S3-compatible bucket to
  // capture PNGs of every primary source it fetched. Default off so
  // deployments without the dependencies / bucket configured fall back
  // gracefully to text-level verification (Phase 2's behavior).
  SCREENSHOTS_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false'),
  SNAPSHOTS_BUCKET: z.string().optional(),
  SNAPSHOTS_S3_ENDPOINT: z.string().url().optional(),
  SNAPSHOTS_S3_REGION: z.string().default('auto'),
  // Public base URL used to build view-snapshot links when the bucket
  // is publicly readable. If unset, the web router signs URLs per-request.
  SNAPSHOTS_PUBLIC_BASE_URL: z.string().url().optional(),
  SNAPSHOTS_S3_ACCESS_KEY_ID: z.string().optional(),
  SNAPSHOTS_S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export const env = Env.parse(process.env);
