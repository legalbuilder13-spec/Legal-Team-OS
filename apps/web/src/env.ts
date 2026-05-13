import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TOKEN: z.string().optional(),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  INTERNAL_API_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
  NOTION_API_KEY: z.string().optional(),
  NOTION_DEFAULT_PARENT_PAGE_ID: z.string().optional(),
});

export const env = Env.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  AI_SERVICE_URL: process.env.AI_SERVICE_URL,
  AI_SERVICE_TOKEN: process.env.AI_SERVICE_TOKEN,
  WEB_APP_URL: process.env.WEB_APP_URL,
  INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  NOTION_API_KEY: process.env.NOTION_API_KEY,
  NOTION_DEFAULT_PARENT_PAGE_ID: process.env.NOTION_DEFAULT_PARENT_PAGE_ID,
});
