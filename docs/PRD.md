# Legal Team OS — PRD & Handoff

This document is the single source of truth for what we're building, what's built so far, and what's deferred. It's meant to be pasted into a fresh conversation with Claude (or any engineer) starting work on a copy of this repo without prior context.

---

## How to read this document

You (the engineer / agent reading this) are inheriting a V1 scaffold that's been built and code-reviewed but not yet deployed. The codebase is functional and has 18 passing unit tests. The remaining V1 work is **operational** (provisioning Railway, wiring credentials, manual verification), not **architectural**.

Before changing anything:

1. Read §**V1 scope (built)** to understand what's done.
2. Read §**V1 explicitly out of scope** so you don't accidentally re-invent contract review, SOC 2, etc.
3. Read §**Working principles** to match the existing code style and avoid scope creep.
4. Skim §**Open decisions** — if you hit one of these in the course of work, surface the tradeoff, don't pick silently.

If the user asks you to build V2 features (contract review, document drafting, multi-tenant, SOC 2), read §**V2 roadmap** first — those have implementation plans waiting.

---

## Product mission

Legal Builder's in-house legal team needs a single workflow platform to receive requests from internal employees, triage and route them to the right attorney, attach business context (Salesforce account data), and track them to resolution. The platform replaces an ad-hoc mix of Slack DMs, emails, and shared docs.

V1 is a **smart legal helpdesk**: intake from Slack, AI triage (Anthropic Claude), context attachment, matter management for attorneys via a web app, and a closed-loop Slack notification system so requesters stay informed without anyone manually typing.

V1 explicitly excludes contract review — clause parsing, redlining, drafting, e-signature, archival. That's V2.

---

## Why this exists

The team's pain points before this platform:

- Requests scatter across Slack DMs, email, in-person asks — no single inbox.
- No triage: a junior contracts question and a board-level dispute land the same way.
- No SLA tracking — requesters never know when to expect a response.
- No memory: every "have we seen this counterparty before?" question is asked from scratch.
- No dashboard: the GC can't tell how loaded each attorney is.

V1 fixes all five.

---

## V1 scope (built)

### Six-stage pipeline

1. **Intake** — Slack `/legal <text>` slash command or `@legal-bot <text>` channel mention creates a matter row. Attachments captured.
2. **Triage** — Anthropic Claude (model: `claude-opus-4-7`) classifies practice area, priority, generates a title and 1-3 sentence summary, identifies counterparty if mentioned. Returns structured output via tool use.
3. **Routing** — `routingRules` table maps practice area → default assignee. Assignee + SLA (hours) auto-assigned from the rule.
4. **Notification** — requester gets a Slack DM (or in-thread reply, if they used `@legal-bot` in a thread) with practice area, priority, assignee, SLA, and a deep link to the matter.
5. **Resolution** — attorney works the matter in the web app: notes, status transitions, attachments. Slack thread replies from the requester land as notes automatically. Every status change posts back to Slack.
6. **Insights** — dashboard shows open matters, SLA breaches, cycle time by practice area, per-attorney load, recent activity. Daily 9am Pacific DM digest to each attorney listing their queue bucketed by SLA proximity.

### Concrete features

- **Web app** (`apps/web`, Next.js 15 + Clerk + tRPC + Tailwind):
  - Matter inbox with filters (`/matters`)
  - Matter detail page with notes, status transitions, Salesforce context card (`/matters/[id]`)
  - "My Queue" view for the logged-in attorney (`/queue`)
  - Dashboard with stat cards, cycle time, per-attorney load, recent activity (`/dashboard`)
  - Admin pages: user management with role editing (`/admin/users`), routing rules editor (`/admin/routing`)
  - Public health endpoint at `/api/health`
  - Internal-token-gated endpoints: `/api/intake` (Slack-to-web ingest), `/api/internal/thread-reply` (Slack-to-note ingest)
  - tRPC API at `/api/trpc`

- **Slack bot** (`apps/bot`, @slack/bolt v4 in Socket Mode):
  - `/legal` slash command handler
  - `app_mention` handler for `@legal-bot` in channels
  - `message` event handler captures thread replies and posts them to web's thread-reply endpoint

- **AI service** (`apps/ai`, FastAPI + Anthropic Python SDK):
  - `POST /triage` — Anthropic tool-use classification, returns structured output. System prompt is prompt-cached.
  - `POST /context` — Salesforce REST account lookup by name/domain
  - `GET /healthz` — health check

- **Worker** (`apps/worker`, Node + node-cron):
  - Postgres-backed job queue with `FOR UPDATE SKIP LOCKED` claim, exponential backoff retry up to 5 attempts
  - Job kinds: `triage`, `context_fetch`, `slack_notify`, `daily_digest`, `sla_check`
  - Hourly SLA breach checker (writes `matter_events` rows of kind `sla.breached`)
  - Weekday 9am Pacific digest cron, configurable via `DIGEST_CRON` and `DIGEST_TIMEZONE` env vars

- **Database** (Postgres, schema in `packages/db/src/schema.ts`):
  - 9 tables: `users`, `matters`, `matter_events`, `matter_notes`, `attachments`, `jobs`, `audit_log`, `counterparties`, `routing_rules`
  - 6 enums: `practice_area`, `matter_status`, `priority`, `job_status`, `job_kind`, `user_role`
  - Drizzle ORM as source of truth; migration baseline committed at `packages/db/drizzle/0000_charming_green_goblin.sql`

- **Auth**:
  - Clerk for web sign-in (publishable key + secret key)
  - Three tRPC procedure tiers: `protectedProcedure` (any logged-in user), `staffProcedure` (attorney/legal_ops/admin), `adminProcedure` (admin/legal_ops only)
  - First Clerk sign-in auto-creates the user row as `admin`; subsequent users default to `attorney`
  - Internal HTTP between bot↔web and worker↔ai uses bearer tokens with `crypto.timingSafeEqual` comparison

- **Seed data** (`packages/db/src/seed.ts`):
  - Admin user (Gabriela Chen), three attorneys (Marcus Lee/commercial, Sofia Patel/employment, Daniel Park/privacy), one Slack-only requester (Jordan Rivera)
  - Three routing rules (commercial 48h, employment 24h, privacy 24h)
  - One counterparty (Acme Corp)
  - Five sample matters covering open, in_review, waiting_on_requester, and closed states, with one SLA-breached row so the dashboard has data

- **Tests**:
  - 18 unit tests in `apps/worker` covering pure helpers (`extractDomain`, `bucketBySla`, `hostnameFromWebsite`)
  - Typecheck across all 5 TypeScript workspaces

- **CI** (`.github/workflows/ci.yml`):
  - TypeScript: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`
  - Python: `ruff check`, `mypy`

---

## V1 explicitly out of scope (deferred to V2 or later)

Do **not** build these in V1 without first surfacing the tradeoff:

- **Contract parsing** (Reducto or similar) — clause tagging, structural parse of uploaded docs
- **Redlining / surgical edits** — accept/reject of tracked changes, clause-level diff UI
- **Document drafting** — generating NDAs / MSAs / offer letters from templates
- **E-signature** (DocuSign) — sending executed contracts for signature, archival
- **Native AI add-in** for Word / Google Docs
- **Self-service path** — auto-resolution for simple FAQs without attorney touch
- **Natural-language playbook authoring** — non-technical users authoring triage rules in prose
- **Vector search** over archived matters (schema has `pgvector` extension available but unused)
- **Microsoft Teams parity** — Slack is the only channel in V1
- **Email intake** (Postmark) — second channel
- **8 other practice areas worth of playbooks** — V1 has triage classification across 9 practice areas but only 3 of them have routing rules seeded
- **WorkOS / SAML / SCIM / SOC 2 evidence collection** — Clerk handles V1 auth without enterprise IdP
- **Datadog / Axiom observability** — Railway logs are sufficient for V1
- **Sentry** — also deferred per the original plan, can be added in week 10-12 when error noise warrants
- **Multi-tenant** — single-tenant for Legal Builder only
- **Temporal Cloud** workflow orchestration — Postgres-backed job queue is sufficient for V1's linear pipeline

---

## Architecture

```
Slack workspace (Legal Builder)
   │  /legal slash command, DMs, @mentions, thread replies
   ▼
[Railway: apps/bot]   @slack/bolt service (Socket Mode)
   │  POST /api/intake (web)
   │  POST /api/internal/thread-reply (web)
   ▼
[Railway: apps/web]   Next.js 15 + Clerk auth
   │  • matter inbox, detail, dashboards, admin
   │  • tRPC API
   │  • enqueues triage job via INSERT INTO jobs
   ▼
[Railway: Postgres]   matters, users, jobs, audit_log, counterparties, etc.
   ▲
   │ workers claim from jobs via FOR UPDATE SKIP LOCKED
   │
[Railway: apps/worker]
   ├── triage handler: POST /triage on apps/ai → write matter, enqueue
   │   context_fetch and slack_notify jobs
   ├── context_fetch handler: POST /context on apps/ai → store result in
   │   matters.context.salesforce, backfill counterparty
   ├── slack_notify handler: chat.postMessage via SLACK_BOT_TOKEN, channel
   │   resolves to either in-thread or DM-to-requester
   ├── sla_check (hourly cron): mark overdue matters
   └── daily_digest (weekday 9am cron): DM each attorney their queue
   ▲
   │ HTTP
   │
[Railway: apps/ai]    FastAPI
   │  • Anthropic Claude triage (tool-use, prompt-cached system prompt)
   │  • Salesforce REST account lookup
   │
Internal service-to-service traffic over Railway private network
(${{ai.RAILWAY_PRIVATE_DOMAIN}}). Bearer tokens with crypto.timingSafeEqual.
```

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | Next.js 15 (App Router) | Server components, native auth integration, Vercel-shape deploys easily move to Railway |
| Web API | tRPC v11 | End-to-end type safety, no schema duplication, fits a single-tenant internal tool well |
| Web auth | Clerk | Drop-in Google SSO + session middleware. ~1 day to wire vs ~2 days for NextAuth |
| Bot | @slack/bolt v4 | First-party Slack SDK, Socket Mode for dev simplicity |
| AI service | FastAPI (Python 3.12) | Anthropic SDK is Python-native, leaves door open for V2 work (Reducto, python-docx) without rewriting |
| ORM | Drizzle | Schema-first TypeScript, runtime types match DB exactly, lighter than Prisma |
| DB | Postgres | Available everywhere, `pgvector` extension ready for V2 |
| Workflow | Postgres jobs table + polling worker | No Temporal complexity in V1. Migrates to Temporal in V2 if needed. |
| Monorepo | Turborepo + pnpm | Standard for TS monorepos, fast cache, workspace filtering |
| Host | Railway | Single platform, one bill, managed Postgres with PITR |

---

## Data model

The 9 tables (full schema in `packages/db/src/schema.ts`):

- **users** — Clerk-authed staff (admin/legal_ops/attorney) and Slack-only requesters. Bootstrap: first Clerk sign-in becomes admin.
- **matters** — the core entity. One row per legal request. Links to requester (user), assignee (user), counterparty.
- **matter_events** — append-only event log per matter (status change, assigned, triaged, note added, sla breached). Source of the "Recent activity" feed.
- **matter_notes** — collaboration. Source can be `web` (attorney typing) or `slack` (thread reply).
- **attachments** — Slack file attachments. Stored as `bytea` in V1 (small Slack uploads); migrate to object storage in V2 if volume grows.
- **counterparties** — entity memory. Backfilled with Salesforce account ID and domain when a single SF account matches.
- **jobs** — the worker queue. `kind` enum, `status` enum, `payload` jsonb, `attempts` int, exponential backoff.
- **audit_log** — every state-changing action. Plain Postgres rows in V1; immutable storage in V2 for SOC 2.
- **routing_rules** — practice area → default assignee + SLA hours. Edited via `/admin/routing`.

Drizzle relations defined for `users`, `matters`, `matter_events`, `matter_notes`. Use `db.query.<table>.findFirst({ with: { ... } })` for relational fetches.

---

## Vendor list (V1)

**Required:**

- **Anthropic** — LLM for triage. `claude-opus-4-7` with adaptive thinking (default off), system prompt cached. Switch to `claude-haiku-4-5` later for cost if needed.
- **Slack** — sole intake + notification channel
- **Railway** — hosting (web, bot, ai, worker, Postgres) on one bill

**Recommended (low cost, saves days):**

- **Clerk** — auth. Free tier covers ~10K monthly users.

**Optional (defer):**

- **Sentry** — error tracking. Add in week 10-12 if log noise warrants.
- **Salesforce** — context lookups. The AI service's `/context` endpoint returns "not configured" if creds absent; the matter detail page renders gracefully.

**V2 vendors** (do not wire in V1):

- Reducto, DocuSign, Cloudflare R2, Nango, WorkOS, Temporal Cloud, Datadog/Axiom, Postmark

---

## The intake-to-resolution flow (V1)

Walking through what happens when an employee runs `/legal review the Acme MSA before Friday`:

1. **Bot receives** the slash command (`apps/bot/src/commands/legal.ts`).
2. Bot calls **Slack `users.info`** to get the requester's email, then POSTs the intake payload to **`apps/web/src/app/api/intake/route.ts`** with `Bearer ${INTERNAL_API_TOKEN}`.
3. Web's intake route validates with Zod (`IntakePayloadSchema` in `packages/types`), calls `ingestSlackIntake` (`apps/web/src/server/intake.ts`):
   - Upserts a `users` row for the requester (matched by `slackUserId`)
   - Inserts a `matters` row with a generated `short_id` like `M-ABCDEFGH`
   - Inserts a `jobs` row with `kind: 'triage'`, `payload: { matter_id }`
   - Inserts an `audit_log` row
4. Bot **acknowledges to the requester ephemerally** with the matter short ID and a link.
5. **Worker** polls the `jobs` table, claims the triage job via `FOR UPDATE SKIP LOCKED`, increments `attempts` to 1 (`apps/worker/src/index.ts`).
6. Worker dispatches to **`handleTriageJob`** (`apps/worker/src/handlers/triage.ts`):
   - **Guards: returns early if matter is closed/cancelled** (someone could close before triage runs)
   - POSTs to **`apps/ai`'s `/triage`** endpoint with `Bearer ${AI_SERVICE_TOKEN}`
   - AI service builds a Zod-validated prompt, sends to Anthropic Claude with the `submit_triage` tool, parses the tool-use response into a `TriageResult`
   - Worker writes back: title, summary, practice_area, priority, assigneeId (from routing rule), slaDueAt, counterparty (upserted by name), triageMetadata
   - Inserts `matter_events` of kind `triaged`
   - Inserts `audit_log`
   - Enqueues a `slack_notify` job with the triage result text
   - If counterparty name OR a domain (from requester email or request body) was found, enqueues a `context_fetch` job
7. Worker picks up the `slack_notify` job (`apps/worker/src/handlers/slack-notify.ts`):
   - Resolves channel: in-thread if `slack_thread_ts` is set, otherwise DMs the requester via `slackUserId`
   - Calls Slack `chat.postMessage`
8. Worker picks up the `context_fetch` job (`apps/worker/src/handlers/context-fetch.ts`):
   - POSTs to `apps/ai`'s `/context` endpoint
   - AI service queries Salesforce via REST (OAuth password grant cached)
   - Worker stores the response in `matters.context.salesforce`
   - If exactly one Salesforce account matched, backfills the counterparty's `salesforceAccountId`, `domain` (parsed to hostname), and metadata
9. **Attorney sees the matter** in their queue at `/queue` or the inbox at `/matters`. Opens the detail page. Sees Salesforce card with website/industry/revenue/owner.
10. Attorney adds a note, changes status to `waiting_on_requester`. The tRPC `setStatus` mutation:
    - Updates the row, inserts `matter_events` and `audit_log`
    - Enqueues a `slack_notify` job posting the status change to the requester
11. Requester replies in the Slack thread. The bot's `message` event handler matches the thread and POSTs to `/api/internal/thread-reply`, which:
    - Looks up the matter by `slackChannelId + slackThreadTs`
    - Inserts a `matter_notes` row with `source: 'slack'`
    - Inserts `matter_events` of kind `note.added`
12. Attorney closes the matter; another `slack_notify` posts the closure to the requester. The matter shows up in the dashboard's "closed in 30d" tally with its cycle time.

This sequence is exercised end-to-end by the day-75 verification walkthrough in `README.md`.

---

## External setup checklist

This is what needs to happen outside the codebase before V1 can serve real traffic. Do these in parallel.

### Slack app

1. Create from manifest at `apps/bot/slack-app-manifest.yaml` via api.slack.com/apps → Create From Manifest.
2. Generate an App-Level Token with `connections:write` scope.
3. Install to workspace, copy bot token (`xoxb-…`), signing secret, app-level token (`xapp-…`).
4. Invite the bot to `#legal-help` or wherever requesters will use `/legal`.

### Clerk

1. Create an application at clerk.com.
2. Enable Email + Google SSO.
3. Copy publishable key (`pk_…`) and secret key (`sk_…`).

### Anthropic

1. API key from console.anthropic.com (`sk-ant-…`). Add billing.

### Salesforce (optional in V1)

1. OAuth connected app with `api` scope.
2. Get client ID, secret, username, password+token.

### Railway

Full walkthrough in `docs/RAILWAY.md`. Summary:

1. New project → add Postgres plugin.
2. Generate two random tokens locally: `INTERNAL_API_TOKEN`, `AI_SERVICE_TOKEN` (each `openssl rand -hex 32`).
3. Create four services pointing at the GitHub repo, with these Root Directories:

| Service | Root Directory |
|---|---|
| `web` | `apps/web` |
| `bot` | `apps/bot` |
| `ai` | `apps/ai` |
| `worker` | `apps/worker` |

4. Generate a public domain on `web` (becomes `WEB_APP_URL`).
5. Set env vars per `docs/RAILWAY.md` per-service tables.
6. Run `railway run pnpm db:migrate && railway run pnpm db:seed` against any service that has `DATABASE_URL`.
7. Deploy by pushing to the tracked branch.

---

## Repository structure

```
.
├── apps/
│   ├── ai/                  Python FastAPI + Anthropic SDK
│   │   ├── pyproject.toml
│   │   ├── railway.json
│   │   └── src/
│   │       ├── main.py          FastAPI app, route handlers
│   │       ├── config.py        Pydantic Settings (env vars)
│   │       ├── schemas.py       Pydantic models for HTTP payloads
│   │       ├── triage.py        Anthropic triage logic, tool-use
│   │       ├── llm/client.py    Anthropic client singleton
│   │       └── context/
│   │           └── salesforce.py  SF OAuth + SOQL query
│   ├── bot/                 Slack bot (@slack/bolt v4)
│   │   ├── slack-app-manifest.yaml
│   │   ├── railway.json
│   │   └── src/
│   │       ├── index.ts             Bolt bootstrap
│   │       ├── env.ts               Zod-validated env vars
│   │       ├── intake-client.ts     POST to web's /api/intake
│   │       ├── commands/legal.ts    /legal handler
│   │       └── events/
│   │           ├── app-mention.ts   @legal-bot in channels
│   │           └── message.ts       Thread reply capture
│   ├── web/                 Next.js 15 + Clerk + tRPC
│   │   ├── next.config.mjs
│   │   ├── railway.json
│   │   ├── tailwind.config.ts
│   │   └── src/
│   │       ├── middleware.ts        Clerk auth gating
│   │       ├── env.ts               Zod-validated env vars
│   │       ├── lib/trpc.ts          tRPC React client
│   │       ├── app/
│   │       │   ├── layout.tsx       Clerk provider + tRPC provider
│   │       │   ├── trpc-provider.tsx
│   │       │   ├── sign-in/[[...sign-in]]/page.tsx
│   │       │   ├── (authed)/        Authed pages (sidebar layout)
│   │       │   │   ├── layout.tsx       Sidebar with role-gated admin links
│   │       │   │   ├── matters/page.tsx Inbox
│   │       │   │   ├── matters/[id]/page.tsx Detail
│   │       │   │   ├── queue/page.tsx   "My queue"
│   │       │   │   ├── dashboard/page.tsx Insights
│   │       │   │   └── admin/
│   │       │   │       ├── users/page.tsx
│   │       │   │       └── routing/page.tsx
│   │       │   └── api/
│   │       │       ├── health/route.ts   Public health check
│   │       │       ├── intake/route.ts   Bot→web ingest, internal-token gated
│   │       │       ├── internal/thread-reply/route.ts  Bot→web note ingest
│   │       │       └── trpc/[trpc]/route.ts  tRPC handler
│   │       └── server/
│   │           ├── trpc.ts          procedure tiers + ensureUser bootstrap
│   │           ├── auth-token.ts    crypto.timingSafeEqual helper
│   │           ├── intake.ts        ingestSlackIntake business logic
│   │           └── routers/
│   │               ├── index.ts     appRouter composition
│   │               ├── matters.ts   list/get/addNote/setStatus/assign/myQueue
│   │               ├── dashboard.ts summary/cycleTime/breachTrend/byAttorney/recentActivity
│   │               └── admin.ts     listUsers/createUser/updateUser/listRoutingRules/upsertRoutingRule
│   └── worker/              Node cron + job poller
│       ├── railway.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts             Poll loop + claimNextJob + dispatch + cron registrations
│           ├── env.ts               Zod-validated env vars
│           ├── utils.ts             Pure helpers (extractDomain, bucketBySla, hostnameFromWebsite, INTERNAL_DOMAINS, AttorneyMatter)
│           └── handlers/
│               ├── triage.ts        AI service call + matter update + chained jobs
│               ├── triage.test.ts   Unit tests for extractDomain
│               ├── slack-notify.ts  chat.postMessage with channel resolution
│               ├── context-fetch.ts AI service /context call + counterparty backfill
│               ├── context-fetch.test.ts  Unit tests for hostnameFromWebsite
│               ├── sla-check.ts     Hourly: write sla.breached events for overdue matters
│               ├── daily-digest.ts  Weekday 9am: DM each attorney their queue
│               └── daily-digest.test.ts  Unit tests for bucketBySla
├── packages/
│   ├── db/                  Drizzle schema + migrations
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── schema.ts            9 tables, 6 enums, relations
│   │       ├── client.ts            getDb() singleton
│   │       ├── migrate.ts           CLI: apply migrations
│   │       ├── seed.ts              CLI: seed data
│   │       └── index.ts             Re-exports schema + getDb
│   ├── db/drizzle/
│   │   ├── meta/                    Drizzle snapshot metadata
│   │   └── 0000_charming_green_goblin.sql  Migration baseline
│   └── types/               Shared Zod schemas
│       └── src/index.ts             PracticeAreaSchema, PrioritySchema, MatterStatusSchema, IntakePayloadSchema
├── docs/
│   ├── RAILWAY.md           Provisioning walkthrough
│   └── PRD.md               This document
├── .github/workflows/ci.yml
├── package.json             Root scripts: dev, build, test, typecheck, db:*
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .prettierrc
└── README.md
```

---

## Operational notes

### Required environment variables

Per-service tables in `docs/RAILWAY.md`. Summary of the universe:

- `DATABASE_URL` — Postgres. Set on web, ai, worker, and any process running migrations/seed.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-opus-4-7`) — ai only.
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — web only.
- `SLACK_BOT_TOKEN` — bot and worker (worker uses it for DMs and digest).
- `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`, `SOCKET_MODE=true` — bot only.
- `INTERNAL_API_TOKEN` — web and bot (shared). Random 256-bit hex.
- `AI_SERVICE_TOKEN` — ai, web, worker. Random 256-bit hex.
- `AI_SERVICE_ALLOW_UNAUTHED=1` — ai only, **dev only**. Bypasses token check.
- `AI_SERVICE_URL` — web and worker. Use Railway private domain: `http://${{ai.RAILWAY_PRIVATE_DOMAIN}}:8000`.
- `WEB_APP_URL` — bot, worker. The public domain Railway generated for `web`.
- `DIGEST_CRON` (default `0 9 * * 1-5`), `DIGEST_TIMEZONE` (default `America/Los_Angeles`) — worker only.
- `SALESFORCE_*` — ai only, optional.

### Local dev

```bash
pnpm install
cp .env.example .env       # fill in keys
pnpm db:generate           # drizzle-kit generate from schema.ts
pnpm db:migrate            # apply migrations
pnpm db:seed               # seed data (idempotent)
pnpm dev                   # web, bot, worker

# In a separate shell:
cd apps/ai
pip install -e ".[dev]"
uvicorn src.main:app --reload --port 8000
```

### Test

```bash
pnpm test          # vitest run, 18 tests across worker
pnpm typecheck     # 5 TS workspaces
```

### Migrations

Schema source of truth: `packages/db/src/schema.ts`. After editing:

```bash
pnpm db:generate   # produces a new SQL migration file
pnpm db:migrate    # applies it
```

The migration files in `packages/db/drizzle/` are checked into git. `drizzle-kit generate` is deterministic given the schema — if CI generates a diff after merging, it means someone forgot to commit a migration.

### Seed

`pnpm db:seed` is idempotent. Re-running is safe — it upserts users by email, routing rules by practice area, and matters by title.

---

## Open decisions

Surface these if you hit them during work — don't pick silently.

1. **Auth: Clerk vs NextAuth.** Chose Clerk for V1 speed. Switching costs ~1 day before any production data, ~3 days after (matter rows reference `clerkId`).
2. **Attachments storage.** V1 stores Slack file uploads as Postgres `bytea`. Fine until ~5 GB total. Then move to Railway Volumes or Cloudflare R2.
3. **Microsoft Teams parity.** Driven by which messaging tool dominates internally. Add before V2 contract review only if Slack adoption is weak.
4. **V2 start timing.** Reducto + DocuSign + python-docx is a 6-8 week chunk. Wait until V1 has a stable production deployment and a clearly-defined first playbook (recommend Sales NDA).
5. **SOC 2 timing.** When compliance mandates it: 3-4 week refactor — WorkOS for SAML/SCIM, immutable audit log to object storage, Datadog or Axiom, formal access reviews.
6. **AI model.** Currently `claude-opus-4-7`. `claude-sonnet-4-6` or `claude-haiku-4-5` may be sufficient for triage classification at much lower cost — evaluate after ~100 real triages.

---

## V2 roadmap (sequenced)

When the user asks to start V2, the rough sequence is:

1. **Contract review pilot (1 playbook, e.g. Sales NDA)**: 6-8 weeks.
   - Add `documents` and `clauses` tables to schema
   - Reducto integration in `apps/ai` for parsing
   - Clause-tagged storage with Anthropic for classification
   - Web UI for clause-level redline review
   - Word add-in is V2.1, not V2.0
2. **DocuSign**: 1 week. Send executed contracts for signature; archive copies.
3. **Cloudflare R2**: 1 week. Move attachments and contract docs off `bytea` once volume grows.
4. **Email intake** (Postmark): 1 week. Mirror the Slack `/legal` flow over inbound email.
5. **Microsoft Teams parity**: 1 week. Mirror the Slack bot.
6. **Vector search** over archived matters: 1 week. `pgvector` extension is ready; just need embeddings + a search route.
7. **More playbooks** (8 remaining practice areas): scale linearly with attorney input.
8. **SOC 2 prep**: 3-4 weeks when compliance mandates it.
9. **Temporal Cloud** migration: only when workflow has 5+ deterministic stages.
10. **Multi-tenant refactor**: only if Legal Builder sells the platform externally.

---

## Working principles for this codebase

Things to know before you write code:

1. **Don't add features the V1 plan deferred.** If the user asks for contract review, redlining, document drafting, email intake, SOC 2, or Microsoft Teams, surface that it's V2 work and ask whether to start a V2 milestone properly.
2. **Match the procedure-tier security model.** Mutations that change matter state (`setStatus`, `assign`) use `staffProcedure`. User/routing admin uses `adminProcedure`. Anyone logged in can add notes. New mutations should pick the right tier — don't put everything on `protectedProcedure`.
3. **All inter-service tokens use `crypto.timingSafeEqual`.** See `apps/web/src/server/auth-token.ts`. The AI service uses Python `hmac.compare_digest`. Don't reintroduce string `!==`.
4. **Pure helpers live in `apps/worker/src/utils.ts`.** Anything that doesn't need DB/env access goes there so it's unit-testable without bringing up the worker. The worker's `env.ts` calls `Env.parse(process.env)` at import, which dies in vitest if env vars aren't set.
5. **Job kinds are enums.** When adding a new job kind, add it to `jobKind` in `packages/db/src/schema.ts`, generate a migration, add a handler, dispatch in `apps/worker/src/index.ts`.
6. **Drizzle is the schema source of truth.** Don't write raw SQL migrations. `pnpm db:generate` produces the SQL; commit it.
7. **Anthropic prompts follow `claude-api` skill defaults.** Use `claude-opus-4-7` unless the user explicitly asks for a different model. The triage system prompt is wrapped in a `cache_control: ephemeral` block — preserve that. Tool-use is the preferred output structure. If you need adaptive thinking, use `thinking: {type: "adaptive"}`.
8. **No `console.log` of user content.** Logs may go to third-party sinks. The triage error log was a finding (#9 in the self-review); we now log only `response.id`, `stop_reason`, and content-block types — never the prompt. Apply the same hygiene anywhere you log AI responses.
9. **Slack reply matching uses (channel, thread_ts).** Don't change the schema to assume `slack_thread_ts` is unique — multiple matters can share a channel.
10. **Internal traffic uses `${{ai.RAILWAY_PRIVATE_DOMAIN}}`.** Never set `AI_SERVICE_URL` to a public domain for web/worker — slower, costs egress, exposes the token endpoint unnecessarily.

### Code style

- TypeScript: Prettier with the repo's `.prettierrc`. No ESLint configured in CI; rely on Prettier + `tsc --noEmit`.
- Python: `ruff check` + `mypy --ignore-missing-imports` in CI. Line length 100.
- No barrel exports inside an app — only `packages/db` and `packages/types` re-export.
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising behavior). Don't narrate what code does.
- Tests are colocated next to the unit they test (`triage.ts` + `triage.test.ts`) but only test pure helpers from `utils.ts` — handlers with DB calls aren't unit tested.

---

## Verification walkthrough

After deployment, run this end-to-end to confirm V1 works. The full version is in `README.md`:

1. `pnpm db:seed` against the Railway Postgres (idempotent).
2. Sign into `/matters` via Clerk. First sign-in becomes admin.
3. Confirm `/admin/users` shows yourself, Gabriela, Marcus, Sofia, Daniel.
4. Confirm `/admin/routing` shows three rules.
5. From Slack: `/legal review the Acme MSA before Friday`. Within ~30s, get a DM with practice area, priority, assignee, SLA.
6. Open the matter in `/matters/[id]`. Add a note. Change status to `waiting_on_requester`. The Slack DM thread should get a status post-back.
7. Reply in the Slack thread: "we need redlines on §7 only". The reply lands on the matter as a note tagged `source: slack`.
8. Close the matter. The Slack thread gets a closure post.
9. `/dashboard` shows the new closed matter under "Cycle time by practice area (last 30d)".

If any step fails, the most likely culprits are listed in `docs/RAILWAY.md` under "Common first-deploy snags."
