# Legal-Team-OS — Gap Remediation Plan

**Status:** Draft for review
**Author:** Engineering planning session, May 2026
**Scope:** Close the gaps between the current Legal-Team-OS implementation and the Legal Workflow Orchestration Platform PRD (May 2026, v1.0).

---

## 0. Executive Summary

Legal-Team-OS today implements roughly **30–40%** of the PRD by surface area. Stages 1 (Intake), 2 (Triage), and 8 (Insights) are reasonably close to spec. Stages 3, 4, 5, 7 are scaffolded but shallow. **Stage 6 (Completion & Action) and the Self-Service track are the largest gaps.** Integration coverage is ~4 of the ~30 systems the PRD lists.

This plan organizes the gap-closing work into **13 phases**. Phases are sequenced by dependency, but several can run in parallel with multiple teams. A single senior engineer pushing serially would need ~12–15 months. A 3-person team in parallel could compress to ~6–9 months.

**Recommended near-term priorities (next quarter):**
1. Phase 0 — Foundation decisions (unblocks everything)
2. Phase 1 — Practice area templates (highest visible value per week of effort)
3. Phase 2 — Document-native work execution (substrate for review UX, the biggest functional gap)
4. Phase 3 — Per-item review workflow (makes Phase 2 usable)

Phases 4 (Completion), 5 (Self-Service), 11 (Security) should be kicked off in parallel once Phase 2 is underway.

---

## 1. Methodology

Each phase below specifies:

- **Objective** — what "done" looks like in plain English.
- **PRD gaps closed** — explicit reference to the gap-analysis sections.
- **Engineering deliverables** — code/infra changes.
- **Content / SME deliverables** — non-engineering work (legal playbooks, attorney sign-off, etc.).
- **Dependencies** — upstream phases or decisions.
- **Effort (eng-weeks)** — rough estimate, 1 senior engineer full-time. Ranges, not commitments.
- **Risk & tradeoffs** — what could derail, what we're consciously not doing.
- **Success metrics** — how we'll know it's done.

Effort estimates are deliberately rough. Refine after Phase 0.

---

## Phase 0 — Foundation Decisions

**Objective:** Lock in the architectural decisions that block every downstream phase. Output is a decision doc, not code.

**PRD gaps closed:** None directly, but unblocks Phases 1–12.

**Decisions to make:**

1. **Practice area taxonomy.** Reconcile the repo's current 9 areas (commercial, employment, privacy, litigation, corporate, regulatory, ip, real_estate, other) with the PRD's 9 (Sales, Procurement, HR, Litigation, Compliance, Commercial, Product & IP, Marketing, General Corporate). Recommend a *hybrid* — keep current as v1-supported, add missing PRD areas as `enum` values with empty templates so the data model is future-proof.
2. **Template architecture.** Decide whether per-practice-area config lives in: (a) YAML/JSON files in `packages/db/templates/`, (b) a new `practiceAreaTemplates` table, or (c) hybrid (files are source-of-truth, loaded into tables at deploy time). Recommend (c).
3. **Document substrate.** Pick the .docx/.pdf parsing approach: (a) Unstructured.io, (b) custom parser using `python-docx` + `pdfplumber`, (c) Anthropic's native document understanding. Recommend evaluating (c) first since the rest of the AI stack is already Anthropic-native; fall back to (a) if accuracy is insufficient for clause segmentation.
4. **Job queue.** Decide whether to migrate from PostgreSQL polling to Temporal/BullMQ before scale becomes an issue. Recommend deferring until concrete bottleneck appears; re-evaluate at Phase 12.
5. **E-signature.** DocuSign vs. native vs. both. Recommend DocuSign-first (lower lift, attorney-familiar); native as Phase 4b stretch.
6. **CRM strategy.** Salesforce-only or add HubSpot. Recommend Salesforce write-back first (Phase 4), HubSpot read-only in Phase 7.
7. **Self-service scope.** All 9 areas, or pilot one (e.g., NDAs in commercial)? Recommend pilot to validate the pattern before broad rollout.

**Effort:** 1–2 weeks (decision doc + architectural spikes).

**Risk:** Decision paralysis. Mitigation — timebox to 2 weeks, document tradeoffs, ship the decision even if 80% confident.

**Success metric:** Signed-off decision doc in `docs/ARCHITECTURE_DECISIONS.md`.

---

## Phase 1 — Practice Area Templates

**Objective:** Every one of the 9 practice areas has a complete template containing default routing rules, playbooks, knowledge articles, matter types, context sources, output formats, downstream actions, and integration mappings — loaded via deploy script and visible in the admin UI.

**PRD gaps closed:**
- §12.3 — Practice Area Templates
- Routing rules for all 9 areas (today: 3/9)
- Playbooks for all 9 areas (today: 3/9)
- Knowledge articles for all 9 areas (today: 4 total)
- Foundation for §7.2.4 (practice-area-specific execution patterns)

**Engineering deliverables:**
- New `packages/db/templates/<area>.yaml` file structure (see Phase 0 decision)
- Loader script that ingests templates into `routingRules`, `playbooks`, `knowledgeArticles`, plus a new `workflowConfig` and `integrationMappings` table per practice area
- Admin UI page to view template content (read-only initially; edit is Phase 10)
- Migration to add `workflowConfig`, `integrationMappings`, and any new enum values

**Content / SME deliverables:**
- For each of 9 areas: 3–5 playbooks with standard positions, escalation triggers, suggested language
- Default matter types per area
- SLA tiers per area (high/medium/low)
- Default assignee role per area
- 3–5 knowledge articles per area

**Dependencies:** Phase 0 decisions 1 (taxonomy), 2 (template architecture).

**Effort:** Engineering ~3 weeks. SME/legal authoring ~1–2 days per area (~3 weeks of attorney calendar if serial, ~1 week if parallel across 3 attorneys).

**Risk & tradeoffs:**
- SME time is the long pole, not engineering. Without committed attorney hours, templates ship empty and the platform stays generic.
- Tradeoff: ship 3 well-built templates first (recommend commercial, employment, regulatory) and explicitly mark the other 6 as "coming soon" rather than shipping 9 shallow templates.

**Success metrics:**
- 9 template files exist in repo (even if 6 are stubs).
- 3 fully-authored templates power matters end-to-end with practice-area-specific playbooks and routing.
- Admin UI shows template content for any selected practice area.

---

## Phase 2 — Document-Native Work Execution

**Objective:** Attorneys receive contracts/documents with every clause tagged STANDARD / MODIFIED / FLAGGED against the applicable playbook, with surgical redlines and citations to playbook positions and prior precedent.

**PRD gaps closed:**
- §7.2.2 — Clause/Claim-Level Tagging
- §7.2.3 — Native AI Capabilities (surgical redlining, comment-reply, accept/reject)
- §7.2.4 — Practice-Area-Specific Execution Patterns (claim matrix, gap report, content rewrites, etc.)
- §7.3 — Document parsing engine
- §12.2 — Native AI Document Capabilities

**Engineering deliverables:**
- Document ingestion pipeline: `.docx`, `.pdf`, Google Docs URL → segmented clause/section structure
- Clause-tagging service: takes (segments, playbook) → returns tagged segments with rationale and citations
- Per-area renderer modules (Phase 1 template's `output_format` field dispatches here):
  - `clause_review` (Sales, Commercial, Procurement)
  - `claim_matrix` (Litigation)
  - `gap_report` (Compliance, Regulatory)
  - `risk_assessment` (Product & IP)
  - `flagged_content_with_rewrites` (Marketing)
  - `deal_structure_analysis` (Commercial — partnership/JV)
  - `issue_flagged_memo` (HR)
  - `action_item_checklist` (General Corporate)
- Surgical redline generation: produces `.docx` track-changes output, not just markdown
- Comment generation and reply on counterparty comments
- Accept/reject recommendation for incoming tracked changes
- Multi-source citation in analysis (playbook §, prior matters, KB articles)
- Parallel clause analysis for large documents
- New DB tables: `documentSegments`, `clauseAnalyses`, `redlineSuggestions`

**Content / SME deliverables:**
- Validation set: 20+ real contracts per practice area with attorney-marked "ground truth" tagging for accuracy benchmarking
- Output format style guides (what does a "good" gap report look like?)

**Dependencies:** Phase 0 decision 3 (document substrate), Phase 1 (templates with `output_format` dispatch and playbook positions).

**Effort:** 10–14 weeks. Largest phase. Sub-phases:
- 2a (3 wks): document ingestion + clause segmentation
- 2b (3 wks): clause tagging service + STANDARD/MODIFIED/FLAGGED
- 2c (4 wks): per-area renderers (each ~3–4 days)
- 2d (3 wks): surgical redlining, comment-reply, accept/reject in .docx

**Risk & tradeoffs:**
- Clause segmentation accuracy on real-world contracts is the biggest unknown. PDFs with weird layouts will break naive parsers.
- Mitigation: start with .docx (well-structured), add PDF in iteration 2.
- The "surgical" in surgical redlining is doing real work — naive LLM redlines tend to rewrite whole clauses. Need careful prompting + post-processing diff to keep changes minimal.
- Tradeoff: ship clause tagging *before* surgical redlining. Tagged-but-not-redlined output is still a 10x improvement over today.

**Success metrics:**
- ≥85% clause-tagging accuracy on validation set (per practice area).
- Attorney reports the redlines are usable without major rework on ≥70% of clauses.
- Time-to-first-draft on a contract review reduced ≥50% in pilot.

---

## Phase 3 — Per-Item Review Workflow

**Objective:** Attorneys see a queue of matters with per-item review surfaces. Each tagged clause/claim has an APPROVED / MODIFIED / FLAGGED decision with inline redline UI, side-by-side document view, batch approval for standard items, and threaded discussion on flagged items.

**PRD gaps closed:**
- §8.2.1 — Reviewer Assignment (with workload/expertise/round-robin)
- §8.2.2 — Per-Item Decision Points
- §8.2.3 — Native Review Tools (inline redline, side-by-side, batch approval, threaded discussion)
- §8.3 — Diff engine, audit trail per decision

**Engineering deliverables:**
- Review queue page (`/queue`) with SLA countdown, priority sort, complexity sort
- Matter review page redesign: per-item cards with APPROVED / MODIFIED / FLAGGED actions
- Inline redline component (strikethrough AI-suggested vs. attorney-modified text)
- Side-by-side document view (analysis ↔ source)
- Batch approval ("approve all STANDARD items") with confirmation
- Threaded item-level comments (extends current matter chat to be per-item)
- Reviewer assignment logic: round-robin, workload-aware, expertise-aware, complexity escalation to senior counsel
- Per-decision audit log entries (extends existing `auditLog`)

**Dependencies:** Phase 2 (need clause-tagged output before per-item review makes sense).

**Effort:** 5–7 weeks.

**Risk & tradeoffs:**
- UI complexity is real. Side-by-side + inline redline + threaded discussion is a lot of screen real estate. Recommend tablet-first design as PRD §15.4 implies.
- Mitigation: prototype the review surface in Figma with 2–3 attorneys before building.
- Tradeoff: skip threaded discussion v1; add in v2 if attorneys ask.

**Success metrics:**
- Attorney can review a 30-clause contract in ≤15 minutes (vs. current ~45+).
- Batch approval is used on ≥60% of clauses (proxy for "AI got it right enough to not need touching").
- 100% of decisions are auditable (decision, modifier, timestamp, rationale).

---

## Phase 4 — Completion & Action Substrate

**Objective:** Once an attorney approves a matter, the platform actually *does* things: sends documents for signature, dispatches email, writes back to CRM, files executed documents, updates ticketing systems.

**PRD gaps closed:**
- §9.2.1 — E-Signature Routing (DocuSign + native)
- §9.2.2 — Communication Actions (email, Slack, ticketing close-out)
- §9.2.3 — System Updates (CRM, contract repo, matter mgmt)
- §9.3 — Action sequencing engine

**Engineering deliverables:**
- DocuSign integration: envelope creation, signing order (sequential/parallel), reminder scheduling, status webhooks, executed-doc retrieval
- Outbound email service: SMTP + templated body, attachment support, threading with original request, Gmail/Outlook send API
- Salesforce write-back: contract status, execution date, key extracted terms (counterparty, value, term, renewal date)
- Contract repository filing: Drive/SharePoint upload with metadata tags (counterparty, matter type, executed date, key terms)
- Ticketing system updates: Jira/ServiceNow/Zendesk/Asana close-out APIs
- Action sequencing engine: reads Phase 1 template's `downstream_actions` chain and executes in order, with retry + failure handling
- New DB tables: `actionExecutions`, `signatureEnvelopes`, `emailDispatches`
- Audit log entries per action

**Dependencies:** Phase 1 (templates declare `downstream_actions`). Independent of Phase 2–3 — can run in parallel.

**Effort:** 7–9 weeks. Sub-phases:
- 4a (3 wks): DocuSign + envelope management + webhooks
- 4b (2 wks): Outbound email + Salesforce write-back
- 4c (2 wks): Contract repo filing + ticketing close-out
- 4d (2 wks): Action sequencing engine + audit + failure recovery

**Risk & tradeoffs:**
- Each integration has its own auth, rate limits, webhook quirks. Estimates are optimistic.
- DocuSign envelope state machine is non-trivial (sent → viewed → signed → declined → voided → expired).
- Tradeoff: native e-signature is a *big* lift (PKI, audit trails, legal weight); recommend deferring to a stretch phase or skipping entirely if DocuSign covers the use case.

**Success metrics:**
- ≥90% of completed matters trigger at least one downstream action automatically.
- ≥99% action delivery rate (with retries) measured over 30 days.
- DocuSign round-trip works end-to-end in pilot.

---

## Phase 5 — Self-Service Track

**Objective:** Routine requests (standard NDAs, FAQ-answerable questions, template generation, status lookups) resolve automatically without attorney involvement. Requesters get answers in minutes; attorneys see only what needs judgment.

**PRD gaps closed:**
- §5.2.3 — Dual-Path Routing (Self-Service vs. Work Execution)
- §12.4 — Self-Service Engine entirely
- Insights §11.2.1 — Self-service resolution rate metric becomes meaningful

**Engineering deliverables:**
- Triage classifier extension: emit `routing_track` (self_service | work_execution) alongside practice area + priority. Trained on rules + matter type + requester signals.
- Self-service resolver service that handles:
  - **Template generation**: standard NDA from structured inputs (counterparty, deal value, jurisdiction); engagement letters; form contracts
  - **FAQ resolution**: semantic search over KB → cite-grounded answer with confidence threshold; below threshold escalates to attorney
  - **Status lookups**: contract execution status, matter status, compliance deadlines, by entity or matter ID
  - **Document assembly**: merge fields populated from CRM/HRIS/requester input → ready-to-sign document
- Self-service portal (`/portal` or Slack-native): requester sees own requests, can self-serve, can escalate with one click
- "Flag for attorney review" button on every self-service output (escalation path)
- Confidence scoring + auto-escalate on low confidence
- New DB tables: `selfServiceResolutions`, `templateInstances`, `escalations` (extend existing)
- Updated Stage 8 insight: self-service resolution rate

**Content / SME deliverables:**
- 10–20 fillable templates (NDA variants, engagement letter, simple SOW)
- 30–50 FAQ entries authored and approved
- Escalation thresholds per matter type ("if deal value > $X, never self-serve")

**Dependencies:** Phase 1 (templates declare which matter types are self-service-eligible). Independent of Phase 2–4.

**Effort:** 8–10 weeks. Sub-phases:
- 5a (2 wks): routing classifier + escalation path
- 5b (3 wks): template generation + document assembly
- 5c (2 wks): FAQ resolution + KB semantic search
- 5d (2 wks): self-service portal UI + Slack-native flow

**Risk & tradeoffs:**
- This is the highest-leverage feature in the PRD — done well, it deflects 40–60% of attorney workload. Done poorly, it generates bad legal advice and trust collapses.
- Mitigation: aggressive confidence thresholds, mandatory attorney review of templated outputs for first 30 days, audit dashboard for legal ops.
- Tradeoff: pilot with **one matter type only** (e.g., standard NDAs under $1M). Don't try to ship self-service for all 9 areas at once.

**Success metrics:**
- ≥30% of triaged requests route to self-service in pilot category.
- ≥95% requester satisfaction on self-served outputs (survey).
- Zero attorney-escalated quality issues that should have been caught.

---

## Phase 6 — Intake Channel Expansion

**Objective:** Requests can enter the system from email, ticketing systems, web forms, and manual entry — not just Slack. Unified inbox supports rich filtering and bulk actions.

**PRD gaps closed:**
- §4.2.1 — Multi-Channel Capture (email, Slack, ticketing, web form, manual)
- §4.2.2 — Unified Inbox (filtering, bulk actions)
- §4.2.3 — Request Normalization (consistent schema across channels)
- §4.3 — Technical reqs (email parsing, webhook receivers, intake form builder)

**Engineering deliverables:**
- Email intake: dedicated address (e.g., legal@org.com), MIME parser, attachment extraction, forwarded-chain dedup, Gmail/Outlook API integration
- Ticketing webhooks: Jira, ServiceNow, Zendesk, Asana — each maps incoming ticket → matter with metadata
- Web form builder: drag-and-drop UI for legal ops to author intake forms per matter type, conditional fields, file upload
- Manual entry UI: attorney/legal ops creates matter directly
- Unified inbox: filtering (priority, practice, requester, date, status, source), bulk actions (assign, re-prioritize, merge duplicates, archive)
- Source-channel icon + provenance metadata on each matter
- New DB tables: `intakeChannels`, `intakeFormDefinitions`, `intakeFormSubmissions`

**Dependencies:** Independent of all other phases. Can start anytime.

**Effort:** 6–8 weeks. Sub-phases:
- 6a (2 wks): email intake (Gmail first, Outlook second)
- 6b (2 wks): ticketing webhooks (Jira + ServiceNow first)
- 6c (2 wks): web form builder
- 6d (1 wk): inbox filters + bulk actions
- 6e (1 wk): manual entry UI

**Risk & tradeoffs:**
- Email parsing is messier than it looks (forwarded chains, signatures, embedded threads, encoded attachments). Budget extra time.
- Tradeoff: ship email + 1 ticketing system (Jira) first; defer web form builder if low demand.

**Success metrics:**
- ≥4 channels live (Slack + email + Jira + web form minimum).
- Time-from-request-to-matter-record ≤30 seconds on every channel.
- Unified inbox is the primary surface attorneys use (not Slack).

---

## Phase 7 — Context Orchestrator Expansion

**Objective:** Stage 3 runs parallel queries across multiple integrated systems, synthesizes insight cards, resolves entities across systems, caches frequently queried entities, and respects per-user permissions.

**PRD gaps closed:**
- §6.2.1 — Parallel Cross-System Queries (CRM, messaging, contract repo, procurement, HRIS, ticketing)
- §6.2.3 — Entity Recognition and Linking
- §6.3 — Parallel API orchestrator, entity resolution, NLP summarization, caching, permission-aware queries

**Engineering deliverables:**
- Parallel query orchestrator: dispatches queries concurrently, per-source timeout, partial-result fallback
- Per-source query adapters (build out from the current Salesforce-only state):
  - HubSpot (CRM)
  - Workday (HRIS)
  - Coupa / Zip (Procurement)
  - Jira / ServiceNow (Ticketing)
  - Microsoft Teams (Messaging)
  - Ironclad (Contract repo)
  - SharePoint / OneDrive (Doc repo)
  - Outlook (Email search)
- Entity resolution engine: dedup company/person across systems (CRM record ↔ contract party ↔ email address ↔ Slack mention)
- NLP summarization layer: distill raw API responses into 1-paragraph insight cards with relevance summary
- Caching layer: Redis or Postgres-backed, TTL configurable per entity type
- Permission-aware queries: respect source-system ACLs (e.g., don't surface a deal the requester can't see in Salesforce)
- New DB tables: `entityProfiles` (extend `counterparties`), `contextQueryCache`, `entityAliases`

**Dependencies:** Phase 1 (templates declare `context_sources`). Phase 0 decision on caching infra.

**Effort:** 6–9 weeks depending on how many integrations are shipped.

**Risk & tradeoffs:**
- Every new integration is its own auth + rate limit + schema mapping. Don't underestimate.
- Tradeoff: ship orchestrator + 3 new integrations (HubSpot, Jira, Slack thread search) first; add the rest in subsequent quarters as customer demand dictates.

**Success metrics:**
- ≤15s p95 context-gathering latency (PRD §15.1 target).
- ≥80% of matters surface ≥3 insight cards from different sources.
- Entity resolution accuracy ≥90% on validation set.

---

## Phase 8 — Learning Loop Completion

**Objective:** Every completed matter feeds the system: playbook drift is auto-detected and surfaced for approval, entity memory deepens, archived matters are searchable as precedent.

**PRD gaps closed:**
- §10.2.1 — Playbook Evolution (auto BEFORE/AFTER recommendations from attorney drift)
- §10.2.3 — Matter Archive (full audit trail, searchable, precedent retrieval)
- §10.3 — Diff engine for playbook drift, branching playbook versions, vector embedding store

**Engineering deliverables:**
- Playbook drift detection: nightly job that compares attorney-modified output against playbook positions across recent matters; if a position is overridden ≥N% of the time, generates a `playbookSuggestion` with BEFORE/AFTER and supporting matter citations
- Playbook approval workflow: owner reviews suggestion, sees diff, approves or rejects, version bumped on approval
- Branching playbook versions: per jurisdiction (US-CA, US-NY, EU, etc.), per business unit
- Precedent retrieval: when a new matter enters Stage 4, surface 3–5 most similar past matters via embedding search, with attorney resolution notes
- Entity dedup improvements (overlaps with Phase 7 entity resolution)
- Archive search UI: filter by entity, matter type, practice area, date range, attorney, outcome, free-text

**Dependencies:** Phase 2 (need clause-level data to detect drift at clause level). Phase 7 entity work overlaps.

**Effort:** 4–6 weeks.

**Risk & tradeoffs:**
- Drift detection signal-to-noise is the hard part. Too sensitive → suggestion spam. Too insensitive → never fires.
- Tradeoff: start with conservative thresholds (≥50% override rate, ≥10 matters) and tune from there.

**Success metrics:**
- ≥1 playbook suggestion generated per month per active practice area.
- ≥40% of suggestions accepted (proxy for signal quality).
- Precedent retrieval surfaces a "useful" past matter in ≥60% of new matters (attorney-reported).

---

## Phase 9 — Insights Polish

**Objective:** The Stage 8 dashboard surfaces the full PRD-listed metrics, with exports, configurable alerts, and concrete AI-suggested actions.

**PRD gaps closed:**
- §11.2.1 — Cost savings / attorney hours saved metric
- §11.2.2 — Deadline alerts for contract expirations and regulatory filings (not just matter SLA)
- §11.2.3 — Concrete AI-suggested actions ("3 contracts with Acme expire in 60 days — initiate renewals")
- §11.3 — Configurable alert thresholds in UI; export to PDF/PowerPoint/CSV; scheduled monthly report

**Engineering deliverables:**
- Cost savings calc: time-saved-per-matter model, configurable hourly rate, monthly + YTD rollup
- Self-service resolution rate metric (depends on Phase 5)
- Contract expiration alerts: scan contract repo metadata (from Phase 4 filing), alert N days before expiration
- Regulatory deadline tracking: integrate with compliance template's deadline schema
- AI-suggested-actions generator: nightly job analyzes portfolio + entity memory + insights → emits concrete recommendations
- Configurable alert thresholds in admin UI
- Export pipeline: dashboard → PDF (full report), PowerPoint (exec summary), CSV (raw data)
- Scheduled report generation: monthly portfolio review email to GC + legal ops

**Dependencies:** Phases 4 (contract repo filing) and 5 (self-service rate) feed metrics here. Otherwise independent.

**Effort:** 3–4 weeks.

**Risk & tradeoffs:**
- Cost-savings is inherently squishy ("attorney hours saved" is an estimate). Be transparent in the UI about methodology.
- Tradeoff: ship PDF export first; PowerPoint and CSV are nice-to-have.

**Success metrics:**
- GC opens the monthly report ≥80% of months (proxy for usefulness).
- ≥3 AI-suggested actions per week, ≥30% acted on.

---

## Phase 10 — Natural Language Configuration

**Objective:** Every system rule (triage routing, playbook positions, SLAs, escalation thresholds) is configurable in plain English via a chat-like admin UI, not by editing tables or YAML.

**PRD gaps closed:**
- §12.1 — Natural Language Configuration

**Engineering deliverables:**
- NL-to-rule compiler: takes English ("any contract over $1M routes to Commercial as High Priority"), produces structured rule record, presents back to user for confirmation before saving
- NL-to-playbook authoring: "our new position on liability caps is 2x annual contract value" → produces playbook diff, requests approval
- NL-to-SLA: "High priority matters in EU should resolve within 24 hours" → updates routingRule with jurisdiction overlay
- Admin chat surface: persistent conversation with system, can change rules, view current rules, undo changes
- All NL changes versioned + auditable

**Dependencies:** Phase 1 (template structure must exist before NL can author into it). Phase 8 helpful (NL suggestions can come from drift detection).

**Effort:** 4–6 weeks.

**Risk & tradeoffs:**
- NL is fun but can be a wrapper around a form that's already easy enough. Watch for "demo magic" with no real productivity gain.
- Tradeoff: ship NL for the most-frequently-edited surfaces (playbook positions, triage rules) first. Skip for rarely-edited surfaces (RBAC, integration configs).

**Success metrics:**
- ≥50% of playbook/routing edits done via NL surface (vs. raw forms).
- Legal ops reports NL surface saves time on rule authoring.

---

## Phase 11 — Security & Compliance Hardening

**Objective:** The platform meets enterprise security expectations: SAML/OIDC SSO, role-based access, matter-level ACLs, SOC 2 Type II, prompt injection defenses, configurable retention.

**PRD gaps closed:**
- §14.1 — Authentication & Authorization (SAML, OIDC, RBAC, scoped permissions)
- §14.2 — Data Security (SOC 2, residency, retention policies)
- §14.3 — AI Security (prompt injection defenses, output audit trail)

**Engineering deliverables:**
- SAML 2.0 + OIDC SSO via Clerk or alternative (Okta, Azure AD, OneLogin support)
- Full RBAC: Admin, Attorney, Legal Ops, Requester, Read-Only roles
- Practice-area-scoped permissions: attorneys see only their practice groups by default
- Matter-level ACLs for sensitive matters (M&A, exec employment)
- Audit log enhancements: API call logging, every read/write tracked
- Prompt injection defenses on AI inputs (input sanitization, output validation, prompt structure)
- Per-AI-call audit log entries
- Configurable data retention per matter type
- Data residency: per-tenant region pinning (US, EU)
- SOC 2 Type II preparation: documented controls, evidence collection, third-party audit

**Dependencies:** None — can run in parallel with all other phases. Should start early since SOC 2 audit timelines are long (~6 months).

**Effort:** 8–12 weeks engineering, plus ~6 months calendar for SOC 2 Type II audit.

**Risk & tradeoffs:**
- SOC 2 audit is gated by *time observed in control state*, not engineering work. The earlier this starts, the earlier it certifies.
- Tradeoff: if enterprise sales aren't imminent, defer SOC 2 cert (but still implement the controls). RBAC + SAML are higher-priority than SOC 2 paperwork.

**Success metrics:**
- SAML SSO working with at least 2 IdPs (Google + Okta).
- All 5 RBAC roles tested with permission boundaries.
- SOC 2 Type II report obtained (if pursued).
- Zero prompt-injection vulnerabilities found in security review.

---

## Phase 12 — Non-Functional & Infrastructure

**Objective:** The platform meets PRD §15 performance, scalability, and reliability targets.

**PRD gaps closed:**
- §15.1 — Performance (sub-30s triage, sub-15s context, sub-3min contract analysis, sub-2s page load)
- §15.2 — Scalability (10k matters, 500 users, horizontal AI scaling)
- §15.3 — Reliability (99.9% uptime, failover, RPO/RTO)
- §15.4 — Usability (WCAG 2.1 AA, onboarding wizard)

**Engineering deliverables:**
- Job queue migration: PostgreSQL polling → BullMQ or Temporal (decision in Phase 0). Only if measured bottleneck.
- Horizontal worker scaling: containerized, auto-scaling on queue depth
- Performance benchmarking suite: measure triage, context, analysis, page load latencies; alert on regression
- HA setup: multi-AZ Postgres, automated failover for web/worker
- Backup + PITR: 1-hour RPO, 4-hour RTO
- WCAG 2.1 AA compliance audit + fixes
- Onboarding wizard: guided setup for new team (integration connection, playbook config, practice area activation)

**Dependencies:** Should be informed by real load (don't optimize prematurely). Start when concrete bottleneck appears, or when first enterprise customer requires the SLA.

**Effort:** 4–6 weeks.

**Risk & tradeoffs:**
- Premature optimization is the trap. Don't migrate the job queue until queue depth becomes a real problem.
- Tradeoff: WCAG full compliance is expensive; start with keyboard navigation + screen reader for review workflow (highest-touch surface).

**Success metrics:**
- All §15.1 latency targets met at 95th percentile.
- 99.9% uptime over a quarter.
- Onboarding wizard takes ≤30 minutes for a new team.

---

## Critical Path & Sequencing

**Strict dependencies (must be sequential):**
- Phase 0 → everything
- Phase 1 → Phase 2 → Phase 3
- Phase 1 → Phase 4
- Phase 2 → Phase 8

**Can run in parallel (with sufficient team):**
- Phase 6 (intake channels) — independent, can start anytime after Phase 0
- Phase 11 (security) — independent, should start early
- Phase 5 (self-service) — depends only on Phase 1
- Phase 7 (context orchestrator) — depends only on Phase 1

**Recommended 12-month roadmap, 3-person team:**

```
Months 1     2     3     4     5     6     7     8     9     10    11    12
Phase 0 ▓
Phase 1   ▓▓▓
Phase 2          ▓▓▓▓▓▓▓▓▓▓▓▓
Phase 3                          ▓▓▓▓▓
Phase 4    ▓▓▓▓▓▓▓▓▓ (parallel track 2)
Phase 5                ▓▓▓▓▓▓▓▓▓▓ (parallel track 2)
Phase 6  ▓▓▓▓▓▓▓ (parallel track 3)
Phase 7              ▓▓▓▓▓▓▓▓ (parallel track 3)
Phase 8                                 ▓▓▓▓
Phase 9                                       ▓▓
Phase 10                                        ▓▓▓▓
Phase 11 ▓▓▓▓▓▓▓▓▓▓▓ (parallel, partial-time)
Phase 12                                              ▓▓
```

---

## Explicit Non-Goals (for this plan)

To keep scope honest, this plan **does not** address:

- Mobile native apps (PRD §15.4 only requires tablet via responsive web)
- Multi-language support (PRD silent on i18n)
- Custom on-prem deployments (cloud-only assumed)
- Acquisition of third-party legal databases (Westlaw, LexisNexis)
- Court e-filing integrations (PRD §12.3 mentions "court filing systems" for litigation but doesn't specify)
- Time tracking and billing (out of scope per PRD)
- Conflict-of-interest checking (out of scope per PRD)

If any of these are actually required, they need their own phase.

---

## Open Questions for the Team

Before locking this plan, please weigh in on:

1. **Team size and timeline.** Plan above assumes 3 engineers. Is that realistic? If smaller, which phases get cut or deferred?
2. **Taxonomy decision (Phase 0 #1).** Adopt PRD taxonomy, keep current, or hybrid? This blocks Phase 1.
3. **Self-service pilot scope (Phase 5).** All 9 areas or pilot one? Recommend pilot.
4. **DocuSign vs. native e-sign (Phase 4).** DocuSign-first or build native? Recommend DocuSign.
5. **SOC 2 priority (Phase 11).** Pursue Type II this year, or defer? Depends on enterprise sales pipeline.
6. **PDF parsing accuracy bar (Phase 2).** What's the minimum acceptable clause-tagging accuracy for go-live? Recommend ≥85%.
7. **SME availability.** Phase 1 (templates) and Phase 2 (validation sets) need significant attorney time. Who's accountable?
8. **Budget for integrations (Phase 4 + 6 + 7).** DocuSign, Workday, Coupa, Ironclad each have licensing costs. Approved?

---

## How to Edit This Plan

This document is the source of record for the gap-closing roadmap. Edit directly in this file:

- Reorder phases by editing the section order
- Adjust effort estimates inline
- Add/remove deliverables under each phase
- Mark phases as deferred, deprioritized, or done in the heading
- Capture decisions from Phase 0 by replacing the "Decisions to make" bullets with the actual decisions

When a phase is complete, update its heading to `## Phase N — Title (✅ Completed [date])` and link to the relevant PRs.
