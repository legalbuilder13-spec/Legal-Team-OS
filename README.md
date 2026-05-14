# Legal Team OS

Legal Builder's in-house Legal Workflow Orchestration Platform.

V1 scope: Intake (Slack) → AI Triage → Context (Salesforce) → Matter Management (web app) → Notifications (Slack) → Insights. **No contract review in v1.**

## Structure

```
apps/
  web/      Next.js 15 + Clerk + tRPC — attorney workstation
  bot/      Slack Bolt — /legal command & notifications
  ai/       FastAPI + Anthropic — triage & context synthesis
  worker/   Node cron + job poller — async work
packages/
  db/       Drizzle schema (source of truth)
  types/    Shared TS types (Zod-validated)
```

## Tech stack

- **Hosting:** Railway (one project, every service)
- **Database:** Postgres (Railway-managed; `pgvector` available)
- **LLM:** Anthropic Claude (Opus 4.7) — triage classification, summarization, context synthesis
- **Auth:** Clerk (web app, Google SSO)
- **Slack:** `@slack/bolt`, socket mode in dev
- **Workflow:** Postgres-backed job table + polling worker (no Temporal in v1)

## Slack app setup

The bot is defined by `apps/bot/slack-app-manifest.yaml`. To install:

1. Go to https://api.slack.com/apps → **Create New App** → **From manifest**, pick the Legal Builder workspace.
2. Paste the contents of `apps/bot/slack-app-manifest.yaml`.
3. After creation, in **Basic Information** generate an **App-Level Token** with scope `connections:write` → that becomes `SLACK_APP_TOKEN`.
4. **Install to workspace**. The Bot Token (`xoxb-…`) becomes `SLACK_BOT_TOKEN`, the Signing Secret becomes `SLACK_SIGNING_SECRET`.
5. **User OAuth Token** (`xoxp-…`). The worker's `context_fetch_slack` job calls `search.messages`, which Slack only allows with a user token holding the `search:read` scope. Copy the User OAuth Token from **OAuth & Permissions** into `SLACK_USER_TOKEN`. Without it, every matter logs `Slack search error: invalid_auth` and retries five times before giving up — no surface error, just missing Slack context. Re-install the app whenever you add scopes so the token reflects them.
6. Set those four values in `.env` (or in Railway env vars). The manifest enables Socket Mode, so no public webhook URL is needed for development.

The bot listens for the `/legal` slash command, app mentions, and thread replies on messages it can see (channels it's been invited to and any DMs).

## Local development

```bash
pnpm install
cp .env.example .env       # fill in keys
pnpm db:generate           # drizzle-kit generate from schema.ts
pnpm db:migrate            # apply migrations to $DATABASE_URL
pnpm db:seed               # admin + 3 attorneys + routing rules + 5 sample matters
pnpm dev                   # web, bot, worker
```

In a separate shell:

```bash
cd apps/ai
pip install -e ".[dev]"
uvicorn src.main:app --reload --port 8000
```

## Verification (day-75 walkthrough)

Local end-to-end test against seeded data:

1. `pnpm db:seed` — creates seed users, routing rules, and sample matters.
2. Visit `http://localhost:3000` — sign in via Clerk with the email `gc@example.com` (or any email; first sign-in becomes admin).
3. `/matters` lists the seed matters. Open `M-…` for the GDPR DSR row and verify the Salesforce card renders a "not configured" hint (or real data if you set Salesforce creds).
4. From Slack with the bot installed: `/legal review the Acme MSA before Friday`. Within ~30s you should receive a DM with practice area, priority, assignee, and SLA.
5. In the web app, change the matter status to `waiting_on_requester`. The bot should reply in your DM thread with the status change.
6. Reply in the DM thread: "we need redlines on §7 only" — the message should land on the matter as a note tagged `source: slack`.
7. `/dashboard` shows the new matter under "Open by practice area" and the seed closed matters under "Cycle time by practice area (last 30d)".

Unit tests (CI):

```bash
pnpm test       # runs vitest in each TS workspace
```

## Deployment

Each app has a `railway.json` with build + start config. The full one-time provisioning steps (create project, plugins, four services, env vars, migrations, seed, sanity checks) live in [docs/RAILWAY.md](docs/RAILWAY.md).
