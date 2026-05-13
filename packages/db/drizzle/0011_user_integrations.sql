-- Per-user integration credentials, encrypted at rest via pgcrypto.
-- Future per-user OAuth flows (Slack, Notion, Drive) will write to this
-- table; context-fetch handlers will prefer user-scoped tokens over
-- workspace tokens when available. The InsightCard.permissionsContext
-- field is populated with the user identity that performed the fetch,
-- creating an audit trail of cross-system permission-aware queries.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "user_integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "access_token_encrypted" bytea NOT NULL,
  "refresh_token_encrypted" bytea,
  "scope" text,
  "expires_at" timestamp with time zone,
  "external_user_id" text,
  "external_user_email" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_integrations_user_provider_uq" UNIQUE ("user_id", "provider")
);

CREATE INDEX "user_integrations_user_idx" ON "user_integrations" ("user_id");
CREATE INDEX "user_integrations_expires_idx" ON "user_integrations" ("expires_at");
