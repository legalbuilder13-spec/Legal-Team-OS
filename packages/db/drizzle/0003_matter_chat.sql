-- Matter-scoped chat history for the in-dashboard Claude copilot.

CREATE TYPE "chat_role" AS ENUM ('user', 'assistant', 'tool');

CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_id" uuid NOT NULL,
  "author_id" uuid,
  "role" "chat_role" NOT NULL,
  "content" text NOT NULL,
  "tool_calls" jsonb DEFAULT '[]'::jsonb,
  "tool_name" text,
  "tool_use_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_messages_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE,
  CONSTRAINT "chat_messages_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id")
);

CREATE INDEX "chat_messages_matter_idx" ON "chat_messages" ("matter_id", "created_at");
