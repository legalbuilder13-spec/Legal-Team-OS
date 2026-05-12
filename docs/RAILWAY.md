# Railway provisioning

This is the one-time setup to bring V1 up on Railway. Plan on ~45 minutes for the dashboard work plus a 10-minute first deploy.

Per-service build/start config lives in `apps/<name>/railway.json` — Railway reads each one automatically once you point a service at the right `rootDirectory`.

## 1. Create the project + plugins

In the Railway dashboard:

1. **New Project** → name it `legal-team-os` (or whatever).
2. **Add Plugin → Postgres**. Wait for it to provision (~30s). Railway exposes `DATABASE_URL` as a reference variable.
3. **Add Plugin → Redis** (optional in V1 — only used by the bot for Slack event dedup if you ever turn off Socket Mode). Exposes `REDIS_URL`.

## 2. Generate shared secrets

Two tokens are shared between services. Generate them once locally:

```sh
openssl rand -hex 32   # → INTERNAL_API_TOKEN (web ↔ bot)
openssl rand -hex 32   # → AI_SERVICE_TOKEN   (worker → ai)
```

Save both somewhere temporary — you'll paste them into Railway env vars in step 4. Do **not** commit them.

## 3. Create the four services

For each service: **+ New → GitHub Repo** (or `Empty Service` and link the repo afterwards), pointing at this repo's main branch. Then **Settings → Source → Root Directory** to the path below. Railway picks up the matching `railway.json` automatically.

| Service name | Root Directory | Config file                       |
| ------------ | -------------- | --------------------------------- |
| `web`        | `apps/web`     | `apps/web/railway.json`           |
| `bot`        | `apps/bot`     | `apps/bot/railway.json`           |
| `ai`         | `apps/ai`      | `apps/ai/railway.json`            |
| `worker`     | `apps/worker`  | `apps/worker/railway.json`        |

The TypeScript services share the workspace, so the build command in each `railway.json` runs `pnpm install --frozen-lockfile` then `pnpm --filter @legal/<name> build` — Railway clones the whole repo and the filter scopes the build to one app. The `ai` service uses pip + uvicorn instead.

**Web also needs a public domain**: in the `web` service → Settings → Networking → **Generate Domain**. Use that URL for `WEB_APP_URL` in step 4.

## 4. Set environment variables

Set per-service in **Variables**. Bold = required.

### `web`

| Variable | Value |
|---|---|
| **`DATABASE_URL`** | `${{Postgres.DATABASE_URL}}` (reference variable) |
| **`CLERK_SECRET_KEY`** | `sk_live_…` from Clerk |
| **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`** | `pk_live_…` from Clerk |
| **`INTERNAL_API_TOKEN`** | the first hex from step 2 |
| **`WEB_APP_URL`** | the public domain Railway generated for this service (e.g. `https://web-production-abcd.up.railway.app`) |
| `AI_SERVICE_URL` | `${{ai.RAILWAY_PRIVATE_DOMAIN}}:8000` *(private network — see note below)* |
| `AI_SERVICE_TOKEN` | the second hex from step 2 |

### `bot`

| Variable | Value |
|---|---|
| **`SLACK_BOT_TOKEN`** | `xoxb-…` from the Slack app install |
| **`SLACK_SIGNING_SECRET`** | from Slack app Basic Information |
| **`SLACK_APP_TOKEN`** | `xapp-…` (App-Level Token, `connections:write`) |
| **`SOCKET_MODE`** | `true` |
| **`INTERNAL_API_TOKEN`** | same hex as `web` |
| **`WEB_APP_URL`** | same public domain as `web` |
| `PORT` | leave unset — Railway injects |

### `ai`

| Variable | Value |
|---|---|
| **`ANTHROPIC_API_KEY`** | `sk-ant-…` |
| `ANTHROPIC_MODEL` | `claude-opus-4-7` (default; leave unset to use it) |
| **`DATABASE_URL`** | `${{Postgres.DATABASE_URL}}` |
| **`AI_SERVICE_TOKEN`** | same hex as `web` and `worker` |
| `SALESFORCE_INSTANCE_URL` | optional — leave blank for v1 |
| `SALESFORCE_CLIENT_ID` | optional |
| `SALESFORCE_CLIENT_SECRET` | optional |
| `SALESFORCE_USERNAME` | optional |
| `SALESFORCE_PASSWORD` | optional |

If you skip Salesforce, the matter detail page shows a "not configured" card. That's fine — wire it up week 2.

### `worker`

| Variable | Value |
|---|---|
| **`DATABASE_URL`** | `${{Postgres.DATABASE_URL}}` |
| **`AI_SERVICE_URL`** | `${{ai.RAILWAY_PRIVATE_DOMAIN}}:8000` |
| **`AI_SERVICE_TOKEN`** | same hex as `ai` |
| **`SLACK_BOT_TOKEN`** | same `xoxb-…` as `bot` |
| **`WEB_APP_URL`** | same public domain as `web` |
| `DIGEST_CRON` | `0 9 * * 1-5` (default) |
| `DIGEST_TIMEZONE` | `America/Los_Angeles` (default) |

**Private network note.** Within a Railway project, services reach each other over the private network using `RAILWAY_PRIVATE_DOMAIN`. The web service must NOT use the AI service's public domain (slower + counts against egress + needs the token). Set `AI_SERVICE_URL=http://${{ai.RAILWAY_PRIVATE_DOMAIN}}:8000` on `web` and `worker`. Configure the `ai` service to listen on `0.0.0.0:$PORT` (already done in `apps/ai/railway.json`).

## 5. Apply migrations + seed

Before the services serve traffic, run migrations + seed against the Railway Postgres. Easiest path is `railway run` from your laptop with the Railway CLI:

```sh
npm i -g @railway/cli
railway login
railway link        # pick the legal-team-os project
railway service     # pick "web" (or any service that has DATABASE_URL set)
railway run pnpm db:migrate
railway run pnpm db:seed
```

The seed creates an admin user (Gabriela Chen), three attorneys, three routing rules, and five sample matters. It's idempotent, so re-running is safe.

## 6. Deploy

Push to `main` (or whatever branch each service tracks). Railway builds + deploys all four services on every push. The first deploy of each service takes 3-5 minutes; subsequent deploys are 1-2 minutes thanks to layer caching.

After the first deploy:

- Visit `https://<web-domain>/` — should redirect to Clerk sign-in. Sign in with your work email; first sign-in becomes admin.
- `https://<web-domain>/admin/users` — confirm you see yourself, Gabriela, Marcus, Sofia, Daniel.
- `https://<web-domain>/admin/routing` — confirm the three rules are present.
- From Slack: `/legal hello world` — should DM you a triaged matter link within ~30s. If nothing happens, check the `worker` service logs.

## 7. Health checks

After the first deploy, verify each service is up:

- `web` → `https://<web-domain>/api/health` → `{"status":"ok"}`
- `ai`  → `https://<ai-public-domain>/healthz` → `{"status":"ok"}` *(only if you exposed `ai` publicly; otherwise check the Railway service status indicator)*
- `bot`, `worker` → no HTTP endpoint; just look for the green "Running" status in the Railway dashboard and the startup log lines (`Slack bot running on port …` / `Worker started — digest cron: …`).

## 8. Common first-deploy snags

- **"Module not found: @legal/db"** during the web build → the workspace install step didn't run. Verify the `buildCommand` in `apps/web/railway.json` is intact.
- **Bot fails with `slack_app_not_found` on startup** → wrong app-level token. Generate a fresh one in Slack → Basic Information → App-Level Tokens with `connections:write`.
- **Worker logs `relation "matters" does not exist`** → you skipped step 5. Run `railway run pnpm db:migrate`.
- **Triage jobs hang in `pending`** → check that `AI_SERVICE_URL` on the worker points at the private domain *and* the `ai` service has finished its first deploy. Worker retries with exponential backoff up to 5 attempts.

## Optional: provision via the Railway CLI instead

If you'd rather not click in the dashboard, the rough CLI flow is:

```sh
railway init                              # create the project
railway add --plugin postgresql           # Postgres
railway add --service web --root apps/web
railway add --service bot --root apps/bot
railway add --service ai  --root apps/ai
railway add --service worker --root apps/worker

# Then variables: railway variables set --service web KEY=VALUE
# Generated domain: railway domain --service web
# Deploy: railway up
```

The dashboard is still where you'd manage day-2 ops (logs, metrics, secret rotation), so most teams pick that and skip the CLI bootstrap.
