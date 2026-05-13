# Session Handoff — Attorney UI rebuild

Snapshot of where the codebase is, what changed this session, what to
verify on Railway, and where to pick up. Written for the next session
(human or AI) to ramp up in under 5 minutes.

Last updated: 2026-05-13.

---

## 1. Branch & deploy state

| Where | SHA | What's there |
| --- | --- | --- |
| `main` | `3676f01` | All session work + the Railway preDeploy migration hook |
| Railway | auto-deploys from `main` | Should be live at https://web-production-253d.up.railway.app once the build finishes |
| Feature branch | `claude/analyze-lawyer-interface-FmISG` | Same commits as main; safe to delete after Railway has confirmed |

Merged PRs this session:
- **#3** — feature work (8 commits, 17K+ insertions)
- **#4** — `apps/web/railway.json` `preDeployCommand: pnpm --filter @legal/db migrate`

Direct pushes to `main` from the agent environment are blocked at the
git server (HTTP 403). Use PRs via the GitHub MCP to land changes.

---

## 2. What ships on main now

### Lawyer-facing features (was the original ask)

| Feature | Route / surface | Backed by |
| --- | --- | --- |
| Matter copilot chat | `/matters/[id]` right pane | `ChatPanel.tsx`, `chat` tRPC router, `chat/tools.ts` (Anthropic tool-use loop) |
| Inline playbooks | `/matters/[id]` right rail | `PlaybooksCard.tsx`, existing playbooks router |
| Drafting workspace | `/matters/[id]/draft` | `drafts` tRPC router, `matterDrafts` + `matterDraftVersions` tables, word-level diff in client |
| Escalations | `/escalations` + inline `EscalationsCard.tsx` | `escalations` router, table + status/severity enums, worker auto-creates on SLA breach |
| Audit log | `/admin/audit` | `admin.listAuditLog` endpoint with filters (user/system/copilot/action) |
| Notion integration | "Save to Notion" button + chat tools | `integrations/notion.ts`, `notion` router |
| Google Drive integration | "Save to Drive" button + chat tools | `integrations/google-drive.ts` (service-account auth), `drive` router |
| Attorney dashboard | `/dashboard` | `dashboard.mine` + `dashboard.myActivityChart` endpoints |

### Design system (base44-inspired, distinct violet accent)

- `tailwind.config.ts` — `darkMode: 'class'`, full `brand` violet palette (50–900, canonical 600 = `#7c3aed`), warm `ink` stone-derived neutrals (50–950), `shadow-card` / `shadow-cardHover`, `borderRadius.xl = 0.875rem`, `tracking-tightish` / `tracking-tighter2`.
- `src/styles/globals.css` — Inter via Google Fonts `<link>` (no `next/font` because the build sandbox couldn't reach Google), `.text-gradient-brand` 120° linear-gradient text fill, `.bg-hero-mesh` dual radial mesh, brand-violet focus-visible rings.
- `src/components/theme.tsx` — `ThemeProvider`, `ThemeToggle` (Sun/Monitor/Moon pill), `themeBootScript` for anti-flash. Toggle lives in the sidebar footer.
- `src/components/charts.tsx` — `ActivityChart` (3-series stacked area with gradient fills, theme-aware grid/tooltip), `StatusBreakdownChart` (horizontal bar) — both consume `useTheme()`.
- Lucide icons everywhere: sidebar nav links, stat-card chips, card header titles.
- 301 `dark:` utility instances across all 18 (authed) `.tsx` files.

### Bug fixes (pre-existing)

- `matters.findSimilar` was returning `undefined` — drizzle-orm/postgres-js `execute()` returns a `RowList` directly, not `{ rows }`. Fixed.
- JSX condition on `unknown` (`triageMetadata.reasoning`) — wrapped in `Boolean()`.

---

## 3. Database

Migrations now apply automatically on every Railway deploy via the
`preDeployCommand` in `apps/web/railway.json`.

Migrations that need to be present on the production DB:

```
packages/db/drizzle/
├── 0000_charming_green_goblin.sql   # baseline
├── 0001_playbooks_vector.sql
├── 0002_knowledge_layer.sql
├── 0003_matter_chat.sql             # chat_messages table
└── 0004_escalations_drafts.sql      # escalations, matter_drafts, matter_draft_versions + enums
```

If the deploy fails on migration, the new code does **not** go live —
Railway keeps the previous version. Failure modes to watch:
- `tsx: not found` → Railway pruned devDeps after build. Fix: move
  `tsx` from `devDependencies` to `dependencies` in `packages/db/package.json`.
- Schema conflict → check `__drizzle_migrations` table for partial state.

---

## 4. Environment variables

Existing required vars are in `.env.example`. New optional vars added
this session (all no-op when unset):

```
# Lawyer copilot (Anthropic tool-use loop)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=                          # optional, defaults sensibly

# Notion integration
NOTION_API_KEY=
NOTION_DEFAULT_PARENT_PAGE_ID=

# Google Drive (service account JSON, single line, escaped \n in private_key)
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_DRIVE_DEFAULT_FOLDER_ID=
```

For Google Drive: share target folders/docs with the service account
email, otherwise reads/writes 403.

---

## 5. Files map (where things live)

```
apps/web/src/
├── app/
│   ├── layout.tsx                            # root: ThemeProvider, Inter font link, dark body
│   ├── (authed)/
│   │   ├── layout.tsx                        # sidebar with lucide icons + ThemeToggle
│   │   ├── dashboard/page.tsx                # attorney-focused hero + chart + queue + drafts
│   │   ├── escalations/page.tsx              # filter tabs, mine-only toggle, ack/resolve
│   │   ├── admin/audit/page.tsx              # filterable audit log table
│   │   └── matters/
│   │       ├── [id]/page.tsx                 # detail view, hosts ChatPanel + cards
│   │       ├── [id]/draft/page.tsx           # markdown editor + AI gen + diff
│   │       ├── [id]/ChatPanel.tsx
│   │       ├── [id]/PlaybooksCard.tsx
│   │       ├── [id]/EscalationsCard.tsx
│   │       ├── [id]/SaveToNotionButton.tsx
│   │       └── [id]/SaveToDriveButton.tsx
│   └── api/                                  # existing routes
├── components/
│   ├── theme.tsx                             # ThemeProvider + ThemeToggle + boot script
│   └── charts.tsx                            # ActivityChart, StatusBreakdownChart (recharts)
├── server/
│   ├── chat/
│   │   ├── system-prompt.ts
│   │   └── tools.ts                          # tool registry: search_drive, fetch_drive_doc, save_to_drive, search_notion, ...
│   ├── integrations/
│   │   ├── anthropic.ts
│   │   ├── notion.ts
│   │   └── google-drive.ts                   # service-account auth, search/fetch/create/append
│   └── routers/
│       ├── index.ts                          # registers chat, notion, drive, escalations, drafts
│       ├── chat.ts
│       ├── notion.ts
│       ├── drive.ts
│       ├── escalations.ts
│       ├── drafts.ts
│       ├── dashboard.ts                      # adds .mine and .myActivityChart
│       ├── admin.ts                          # adds .listAuditLog
│       └── matters.ts                        # findSimilar bug fix
├── styles/globals.css                        # Inter, focus rings, gradient utilities
└── ...

apps/worker/src/handlers/sla-check.ts         # creates an escalation row on SLA breach

packages/db/
├── drizzle/0003_matter_chat.sql
├── drizzle/0004_escalations_drafts.sql       # escalations, matter_drafts, matter_draft_versions
└── src/schema.ts                             # corresponding drizzle tables + enums

apps/web/railway.json                         # preDeployCommand for migrations
```

---

## 6. Things to verify on Railway after deploy

1. Build logs show `pnpm install` + `next build` succeed
2. Deploy logs show `Migrations applied` from the predeploy step
3. App boots — `/api/health` returns 200
4. Visit `/dashboard` — should see the new violet hero, gradient firstName, chart
5. Toggle theme in the sidebar — should persist + survive reload (no flash)
6. Try `/matters/[id]/draft` for any existing matter — confirm the editor + version sidebar load (no 500 means migrations applied)
7. Try `/escalations` — should render empty state if no escalations exist
8. Try `/admin/audit` — filterable table should render

---

## 7. Known unfinished threads (in priority order)

These were discussed but **not** implemented:

1. **`.docx` export** for drafts. Was descoped from the drafting workspace round. Would need `docx` npm package and a new server route to stream the file. Drafts are stored as markdown — needs to be parsed into the docx model.
2. **Team / legal-ops dashboard**. The old team-wide widgets (attorney load, cycle time by practice, breach trend) still have their tRPC endpoints (`dashboard.byAttorney`, `cycleTime`, `breachTrend`) but no longer have a page. Suggested home: `/dashboard/team` or merge into `/admin`. Endpoints are ready to consume.
3. **Cycle-time / breach-trend charts in admin**. The recharts components in `components/charts.tsx` are general-purpose; trivial to add another route that uses them with the legal-ops endpoints.
4. **Command palette / global search**. Was teased but not started.
5. **Per-lawyer AI memory** for the copilot — currently every chat thread is matter-scoped; no user-level long-term memory.
6. **Real Slack thread reply** from the copilot — there's a stub at `api/internal/thread-reply/route.ts` but the copilot doesn't call it.
7. **Writable Salesforce** — current Salesforce integration is read-only (`apps/ai/src/context/salesforce.py`).
8. **Polish dark mode on admin tables**. Sweep was applied via perl; some admin pages may have rough edges (table hover states, badge contrast) that haven't been visually verified because we never ran the dev server in this session.

---

## 8. How to pick up in a new session

1. **First thing**: `git fetch && git status` — confirm `main` is at `3676f01` or later and the working tree is clean.
2. **Don't try `git push origin main`** — the agent environment returns HTTP 403. Use the GitHub MCP (`mcp__github__create_pull_request` + `mcp__github__merge_pull_request`) instead, exactly like PRs #3 and #4.
3. **Don't try `next dev` in the agent sandbox** — Google Fonts is blocked and Clerk demands a real key. Smoke tests use `pnpm -r typecheck` + `pnpm --filter @legal/web build` with stub envs; the build will succeed up to static prerender, which fails on the stub Clerk key. That's expected and not a code bug.
4. **Design system is locked in**. To change the accent color, edit `tailwind.config.ts` `brand.*` only — every component reads from those tokens. Don't introduce a parallel palette.
5. **Migrations**: any new schema goes in `packages/db/src/schema.ts`, then `pnpm --filter @legal/db generate` to produce a new SQL file in `packages/db/drizzle/`, then commit. The preDeploy hook applies it on the next Railway deploy.
6. **GitHub MCP scope**: only `legalbuilder13-spec/legal-team-os` is authorized.

---

## 9. Quick links

- Repo: https://github.com/legalbuilder13-spec/Legal-Team-OS
- Production: https://web-production-253d.up.railway.app
- Merged PRs from this session: [#3](https://github.com/legalbuilder13-spec/Legal-Team-OS/pull/3), [#4](https://github.com/legalbuilder13-spec/Legal-Team-OS/pull/4)
