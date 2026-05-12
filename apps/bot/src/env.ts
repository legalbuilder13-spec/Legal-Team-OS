import { z } from 'zod';

const Env = z.object({
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_APP_TOKEN: z.string().optional(),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  INTERNAL_API_TOKEN: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  SOCKET_MODE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const env = Env.parse(process.env);
