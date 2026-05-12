import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TOKEN: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  POLL_INTERVAL_MS: z.coerce.number().default(2000),
  DIGEST_CRON: z.string().default('0 9 * * 1-5'),
  DIGEST_TIMEZONE: z.string().default('America/Los_Angeles'),
  OPENAI_API_KEY: z.string().optional(),
});

export const env = Env.parse(process.env);
