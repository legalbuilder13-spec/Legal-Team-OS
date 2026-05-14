import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  jsonb,
  integer,
  index,
  uniqueIndex,
  bigint,
  boolean,
  customType,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

function vector(dimensions: number) {
  return customType<{ data: number[]; default: false }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]) {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: unknown) {
      if (typeof value === 'string') {
        const inner = value.slice(1, -1);
        return inner ? inner.split(',').map(Number) : [];
      }
      return value as number[];
    },
  });
}

export const practiceArea = pgEnum('practice_area', [
  'commercial',
  'employment',
  'privacy',
  'litigation',
  'corporate',
  'regulatory',
  'ip',
  'real_estate',
  'other',
]);

export const matterStatus = pgEnum('matter_status', [
  'open',
  'in_review',
  'waiting_on_requester',
  'waiting_on_third_party',
  'closed',
  'cancelled',
]);

export const priority = pgEnum('priority', ['high', 'medium', 'low']);

export const jobStatus = pgEnum('job_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const jobKind = pgEnum('job_kind', [
  'triage',
  'context_fetch',
  'context_fetch_salesforce',
  'context_fetch_similar_matters',
  'context_fetch_notion',
  'context_fetch_slack',
  'context_fetch_drive',
  'parse_document',
  'analyze_document_clauses',
  'analyze_clause',
  'compile_rule',
  'sla_check',
  'daily_digest',
  'slack_notify',
  'generate_embedding',
  'enrich_counterparty_memory',
  'analyze_portfolio',
  'analyze',
  'run_statutory',
  'run_case_law',
  'run_deconstruct',
  'take_snapshot',
]);

export const insightKind = pgEnum('insight_kind', [
  'volume_spike',
  'playbook_deviation',
  'workload_imbalance',
  'counterparty_pattern',
  'sla_trend',
  'self_service_opportunity',
]);

export const insightStatus = pgEnum('insight_status', [
  'active',
  'dismissed',
  'actioned',
]);

export const playbookSuggestionStatus = pgEnum('playbook_suggestion_status', [
  'pending',
  'approved',
  'rejected',
]);

export const userRole = pgEnum('user_role', ['attorney', 'legal_ops', 'admin', 'requester']);

export const escalationStatus = pgEnum('escalation_status', [
  'open',
  'acknowledged',
  'resolved',
]);

export const escalationSeverity = pgEnum('escalation_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const documentParseStatus = pgEnum('document_parse_status', [
  'pending',
  'parsing',
  'parsed',
  'failed',
]);

export const clauseTag = pgEnum('clause_tag', [
  'STANDARD',
  'MODIFIED',
  'FLAGGED',
]);

export const ruleKind = pgEnum('rule_kind', [
  'sla',
  'routing',
  'triage',
  'playbook_trigger',
]);

export const ruleStatus = pgEnum('rule_status', [
  'draft',
  'shadow',
  'active',
  'archived',
]);

export const executionPatternInputType = pgEnum('execution_pattern_input_type', [
  'document',
  'fact_pattern',
  'checklist',
  'content',
]);

export const executionPatternOutputFormat = pgEnum('execution_pattern_output_format', [
  'tagged_clauses',
  'issue_memo',
  'claim_matrix',
  'gap_report',
  'risk_assessment',
  'rewrite_pairs',
  'action_checklist',
]);

// PRD §7.2: pre-review analysis pipeline enums.
export const analysisStatus = pgEnum('analysis_status', [
  'pending',
  'running',
  'complete',
  'failed',
  'escalated',
]);

export const analysisStageName = pgEnum('analysis_stage_name', [
  'pre_merits',
  'guidance',
  'statutory',
  'case_law',
  'deconstruct',
]);

export const analysisStageStatus = pgEnum('analysis_stage_status', [
  'skipped',
  'running',
  'complete',
  'failed',
  'deferred',
]);

export const analysisSourceType = pgEnum('analysis_source_type', [
  'notion',
  'statute',
  'regulation',
  'case',
  'guidance',
  'prior_matter',
  'webfetch',
]);

export const analysisVerificationStatus = pgEnum('analysis_verification_status', [
  'pending',
  'verified',
  'minor_discrepancy',
  'material_discrepancy',
  'not_found',
  'unverifiable',
]);

export const analysisConfidence = pgEnum('analysis_confidence', [
  'HIGH',
  'MEDIUM',
  'LOW',
  'SPLIT',
  'N_A',
]);

// PR10 — explicit lawyer decision per stage. 'pending' until the
// lawyer clicks accept/reject; 'escalated' when the override target
// was a senior reviewer rather than a final disposition.
export const lawyerDecision = pgEnum('lawyer_decision', [
  'pending',
  'accepted',
  'rejected',
  'escalated',
]);

// PR12 §15 — per-organization domain config. Singleton in v1; multi-
// tenant scoping is a future PR.
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    domainConfig: jsonb('domain_config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkId: text('clerk_id').unique(),
    slackUserId: text('slack_user_id').unique(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('requester'),
    practiceAreas: practiceArea('practice_areas').array(),
    // PR12 — points at the user's organization for domain-config
    // lookup. Nullable; null = default org via slug='default'.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    organizationIdx: index('users_organization_idx').on(t.organizationId),
  }),
);

export const counterparties = pgTable(
  'counterparties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    domain: text('domain'),
    salesforceAccountId: text('salesforce_account_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    behavioralProfile: jsonb('behavioral_profile')
      .$type<{
        summary?: string;
        totalMatters?: number;
        avgCycleTimeDays?: number;
        lastContactAt?: string;
        practiceAreas?: Array<{ area: string; count: number }>;
        commonRedlines?: string[];
        escalationTriggers?: string[];
        typicalPositions?: string[];
        // D2 LLM-extracted fields
        negotiationPositions?: Array<{
          topic: string;
          theirPosition: string | null;
          ourPosition: string | null;
          lastOutcome: string | null;
        }>;
        responseLatencyDays?: number | null;
        escalationFrequency?: number;
        executiveInvolvement?: 'high' | 'medium' | 'low' | 'unknown';
        lastEnrichedAt?: string;
      }>()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: index('counterparties_name_idx').on(t.name),
    domainIdx: index('counterparties_domain_idx').on(t.domain),
  }),
);

export const matters = pgTable(
  'matters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shortId: varchar('short_id', { length: 16 }).notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary'),
    requestText: text('request_text').notNull(),
    practiceArea: practiceArea('practice_area'),
    status: matterStatus('status').notNull().default('open'),
    priority: priority('priority'),
    requesterId: uuid('requester_id').references(() => users.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    counterpartyId: uuid('counterparty_id').references(() => counterparties.id),
    slackChannelId: text('slack_channel_id'),
    slackThreadTs: text('slack_thread_ts'),
    slackTeamId: text('slack_team_id'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    triageMetadata: jsonb('triage_metadata').$type<Record<string, unknown>>().default({}),
    context: jsonb('context').$type<Record<string, unknown>>().default({}),
    embedding: vector(1024)('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('matters_status_idx').on(t.status),
    assigneeIdx: index('matters_assignee_idx').on(t.assigneeId),
    practiceAreaIdx: index('matters_practice_area_idx').on(t.practiceArea),
    createdAtIdx: index('matters_created_at_idx').on(t.createdAt),
  }),
);

export const matterEvents = pgTable(
  'matter_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: index('matter_events_matter_idx').on(t.matterId, t.createdAt),
  }),
);

export const matterNotes = pgTable(
  'matter_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    source: text('source').notNull().default('web'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: index('matter_notes_matter_idx').on(t.matterId, t.createdAt),
  }),
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    data: bytea('data'),
    slackFileId: text('slack_file_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: index('attachments_matter_idx').on(t.matterId),
  }),
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: jobKind('kind').notNull(),
    status: jobStatus('status').notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    matterId: uuid('matter_id').references(() => matters.id, { onDelete: 'cascade' }),
    runAt: timestamp('run_at', { withTimezone: true }).defaultNow().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index('jobs_pending_idx')
      .on(t.runAt)
      .where(sql`status = 'pending'`),
    kindIdx: index('jobs_kind_idx').on(t.kind, t.status),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    actorKind: text('actor_kind').notNull().default('user'),
    matterId: uuid('matter_id').references(() => matters.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: index('audit_log_matter_idx').on(t.matterId, t.createdAt),
    actorIdx: index('audit_log_actor_idx').on(t.actorId, t.createdAt),
  }),
);

export const routingRules = pgTable(
  'routing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceArea: practiceArea('practice_area').notNull(),
    defaultAssigneeId: uuid('default_assignee_id').references(() => users.id),
    slaHours: integer('sla_hours').notNull().default(48),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    practiceAreaIdx: uniqueIndex('routing_rules_practice_area_idx').on(t.practiceArea),
  }),
);

export const playbooks = pgTable(
  'playbooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceArea: practiceArea('practice_area').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    practiceAreaIdx: index('playbooks_practice_area_idx').on(t.practiceArea),
  }),
);

export const playbookVersions = pgTable(
  'playbook_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playbookId: uuid('playbook_id')
      .notNull()
      .references(() => playbooks.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    changeSummary: text('change_summary'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    playbookIdx: index('playbook_versions_playbook_idx').on(t.playbookId, t.versionNumber),
  }),
);

export const playbookPositions = pgTable(
  'playbook_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playbookId: uuid('playbook_id')
      .notNull()
      .references(() => playbooks.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    trigger: text('trigger').notNull(),
    standardPosition: text('standard_position').notNull(),
    acceptableRange: text('acceptable_range'),
    flaggedConditions: text('flagged_conditions'),
    suggestedRedline: text('suggested_redline'),
    citation: text('citation'),
    embedding: vector(1024)('embedding'),
    isActive: boolean('is_active').notNull().default(true),
    compiledTrigger: jsonb('compiled_trigger').$type<Record<string, unknown>>().notNull().default({}),
    compilerVersion: text('compiler_version'),
    compiledAt: timestamp('compiled_at', { withTimezone: true }),
    compileError: text('compile_error'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    playbookIdx: index('playbook_positions_playbook_idx').on(t.playbookId),
    activeIdx: index('playbook_positions_active_idx').on(t.isActive),
  }),
);

export const playbookSuggestions = pgTable(
  'playbook_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playbookId: uuid('playbook_id').references(() => playbooks.id, { onDelete: 'cascade' }),
    practiceArea: practiceArea('practice_area').notNull(),
    suggestedTitle: text('suggested_title').notNull(),
    suggestedBody: text('suggested_body').notNull(),
    rationale: text('rationale').notNull(),
    evidenceMatterIds: jsonb('evidence_matter_ids').$type<string[]>().default([]),
    status: playbookSuggestionStatus('status').notNull().default('pending'),
    proposedById: uuid('proposed_by_id').references(() => users.id),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('playbook_suggestions_status_idx').on(t.status),
  }),
);

export const knowledgeArticles = pgTable(
  'knowledge_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceArea: practiceArea('practice_area').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: text('tags').array().default([]).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    viewCount: integer('view_count').notNull().default(0),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    practiceAreaIdx: index('knowledge_articles_practice_area_idx').on(t.practiceArea),
    activeIdx: index('knowledge_articles_active_idx').on(t.isActive),
  }),
);

export const chatRole = pgEnum('chat_role', ['user', 'assistant', 'tool']);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    role: chatRole('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls').$type<unknown[]>().default([]),
    toolName: text('tool_name'),
    toolUseId: text('tool_use_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: index('chat_messages_matter_idx').on(t.matterId, t.createdAt),
  }),
);

export const systemInsights = pgTable(
  'system_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: insightKind('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: text('severity').notNull().default('medium'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().default({}),
    status: insightStatus('status').notNull().default('active'),
    dismissedById: uuid('dismissed_by_id').references(() => users.id),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('system_insights_status_idx').on(t.status, t.createdAt),
  }),
);

export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    severity: escalationSeverity('severity').notNull().default('medium'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: escalationStatus('status').notNull().default('open'),
    createdByKind: text('created_by_kind').notNull().default('system'),
    createdById: uuid('created_by_id').references(() => users.id),
    acknowledgedById: uuid('acknowledged_by_id').references(() => users.id),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    triggerRule: text('trigger_rule'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index('escalations_status_idx').on(t.status, t.createdAt),
    matterIdx: index('escalations_matter_idx').on(t.matterId),
  }),
);

export const matterDrafts = pgTable(
  'matter_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Draft'),
    body: text('body').notNull().default(''),
    sourceDocument: text('source_document'),
    version: integer('version').notNull().default(1),
    createdById: uuid('created_by_id').references(() => users.id),
    updatedById: uuid('updated_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: uniqueIndex('matter_drafts_matter_idx').on(t.matterId),
  }),
);

export const matterDraftVersions = pgTable(
  'matter_draft_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => matterDrafts.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    changeSummary: text('change_summary'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    draftIdx: index('matter_draft_versions_draft_idx').on(t.draftId, t.versionNumber),
  }),
);

export const rules = pgTable(
  'rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: ruleKind('kind').notNull(),
    name: text('name').notNull(),
    naturalText: text('natural_text').notNull(),
    compiled: jsonb('compiled').$type<Record<string, unknown>>().notNull().default({}),
    compileError: text('compile_error'),
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull().default({}),
    priority: integer('priority').notNull().default(100),
    status: ruleStatus('status').notNull().default('draft'),
    supersedesId: uuid('supersedes_id'),
    compilerVersion: text('compiler_version'),
    compiledAt: timestamp('compiled_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedById: uuid('activated_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    kindStatusIdx: index('rules_kind_status_idx').on(t.kind, t.status),
    priorityIdx: index('rules_priority_idx').on(t.kind, t.priority),
  }),
);

export const executionPatterns = pgTable(
  'execution_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceArea: practiceArea('practice_area').notNull(),
    matterType: text('matter_type'),
    inputType: executionPatternInputType('input_type').notNull(),
    outputFormat: executionPatternOutputFormat('output_format').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    promptTemplate: text('prompt_template').notNull(),
    outputSchema: jsonb('output_schema').$type<Record<string, unknown>>().notNull().default({}),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    practiceAreaIdx: index('execution_patterns_practice_area_idx').on(t.practiceArea),
  }),
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceArea: practiceArea('practice_area').notNull(),
    matterType: text('matter_type'),
    name: text('name').notNull(),
    body: text('body').notNull(),
    variables: jsonb('variables')
      .$type<Array<{ name: string; description?: string; defaultValue?: string }>>()
      .notNull()
      .default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    practiceAreaIdx: index('templates_practice_area_idx').on(t.practiceArea),
    activeIdx: index('templates_active_idx').on(t.isActive),
  }),
);

export const matterDocuments = pgTable(
  'matter_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    content: bytea('content').notNull(),
    parseStatus: documentParseStatus('parse_status').notNull().default('pending'),
    parseError: text('parse_error'),
    parserVersion: text('parser_version'),
    clauseCount: integer('clause_count'),
    pageCount: integer('page_count'),
    charCount: integer('char_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
  },
  (t) => ({
    matterIdx: index('matter_documents_matter_idx').on(t.matterId, t.createdAt),
    statusIdx: index('matter_documents_status_idx').on(t.parseStatus),
  }),
);

export const clauseAnalyses = pgTable(
  'clause_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clauseId: uuid('clause_id').notNull(),
    documentId: uuid('document_id').notNull(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    playbookPositionId: uuid('playbook_position_id'),
    tag: clauseTag('tag').notNull(),
    reasoning: text('reasoning').notNull(),
    suggestedRedline: text('suggested_redline'),
    modelVersion: text('model_version').notNull(),
    citations: jsonb('citations')
      .$type<
        Array<{
          source: 'playbook_position' | 'prior_matter' | 'knowledge_article';
          identifier: string;
          excerpt?: string;
        }>
      >()
      .notNull()
      .default([]),
    attorneyDecision: text('attorney_decision'),
    attorneyModifiedRedline: text('attorney_modified_redline'),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clauseUq: uniqueIndex('clause_analyses_clause_uq').on(t.clauseId),
    documentIdx: index('clause_analyses_document_idx').on(t.documentId),
    matterIdx: index('clause_analyses_matter_idx').on(t.matterId),
    tagIdx: index('clause_analyses_tag_idx').on(t.tag),
  }),
);

export const matterDocumentClauses = pgTable(
  'matter_document_clauses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => matterDocuments.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    headingPath: text('heading_path'),
    clauseText: text('clause_text').notNull(),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    pageNumber: integer('page_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    docOrdinalUq: uniqueIndex('matter_document_clauses_doc_ordinal_uq').on(
      t.documentId,
      t.ordinal,
    ),
    docIdx: index('matter_document_clauses_document_idx').on(t.documentId, t.ordinal),
  }),
);

export const entityAliases = pgTable(
  'entity_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    counterpartyId: uuid('counterparty_id')
      .notNull()
      .references(() => counterparties.id, { onDelete: 'cascade' }),
    aliasText: text('alias_text').notNull(),
    aliasSource: text('alias_source').notNull(),
    confidence: text('confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    counterpartyTextUq: uniqueIndex('entity_aliases_counterparty_text_uq').on(
      t.counterpartyId,
      t.aliasText,
    ),
    counterpartyIdx: index('entity_aliases_counterparty_idx').on(t.counterpartyId),
  }),
);

export const userIntegrations = pgTable(
  'user_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accessTokenEncrypted: bytea('access_token_encrypted').notNull(),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    scope: text('scope'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    externalUserId: text('external_user_id'),
    externalUserEmail: text('external_user_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userProviderUq: uniqueIndex('user_integrations_user_provider_uq').on(t.userId, t.provider),
    userIdx: index('user_integrations_user_idx').on(t.userId),
    expiresIdx: index('user_integrations_expires_idx').on(t.expiresAt),
  }),
);

export const contextCache = pgTable(
  'context_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    entityKey: text('entity_key').notNull(),
    queryHash: text('query_hash').notNull().default('v1'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    keyUq: uniqueIndex('context_cache_key_uq').on(t.source, t.entityKey, t.queryHash),
    expiresIdx: index('context_cache_expires_idx').on(t.expiresAt),
  }),
);

// PRD §7.2: pre-review analysis pipeline.
// One row per analysis run (one per matter, occasionally more if re-run).
export const matterAnalyses = pgTable(
  'matter_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matterId: uuid('matter_id')
      .notNull()
      .references(() => matters.id, { onDelete: 'cascade' }),
    pipelineVersion: text('pipeline_version').notNull(),
    status: analysisStatus('status').notNull().default('pending'),
    overallConfidence: analysisConfidence('overall_confidence').notNull().default('N_A'),
    escalationReason: text('escalation_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCostCents: integer('total_cost_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    matterIdx: index('matter_analyses_matter_idx').on(t.matterId, t.createdAt),
    statusIdx: index('matter_analyses_status_idx').on(t.status),
  }),
);

// One row per stage that ran. Auto pipeline writes pre_merits + guidance
// rows; each lawyer-invoked tool writes a statutory/case_law/deconstruct row.
export const matterAnalysisStages = pgTable(
  'matter_analysis_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => matterAnalyses.id, { onDelete: 'cascade' }),
    stageName: analysisStageName('stage_name').notNull(),
    status: analysisStageStatus('status').notNull().default('running'),
    inputHash: text('input_hash').notNull(),
    outputJson: jsonb('output_json').$type<Record<string, unknown>>().notNull().default({}),
    confidence: analysisConfidence('confidence').notNull().default('N_A'),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    retries: integer('retries').notNull().default(0),
    auditNotes: text('audit_notes'),
    invokedByUserId: uuid('invoked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // PR10 — lawyer accept/reject state. 'pending' until the lawyer
    // clicks accept/reject in the matter detail page. Drives the §20.1
    // override-rate launch-gate metric + sharpens the tool-suggestion
    // intelligence's acceptance signal.
    lawyerDecision: lawyerDecision('lawyer_decision').notNull().default('pending'),
    lawyerDecisionReason: text('lawyer_decision_reason'),
    lawyerDecidedAt: timestamp('lawyer_decided_at', { withTimezone: true }),
    lawyerDecidedByUserId: uuid('lawyer_decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    analysisIdx: index('matter_analysis_stages_analysis_idx').on(t.analysisId, t.createdAt),
    nameIdx: index('matter_analysis_stages_name_idx').on(t.stageName, t.status),
    dedupIdx: index('matter_analysis_stages_dedup_idx').on(t.analysisId, t.stageName, t.inputHash),
    decisionIdx: index('matter_analysis_stages_decision_idx').on(t.lawyerDecision),
  }),
);

// Every factual claim a stage makes traces to one of these. The audit
// backbone — verification protocol writes verification_status and the
// snapshot URL here.
export const matterAnalysisSources = pgTable(
  'matter_analysis_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => matterAnalysisStages.id, { onDelete: 'cascade' }),
    sourceType: analysisSourceType('source_type').notNull(),
    citation: text('citation').notNull(),
    url: text('url'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
    hash: text('hash').notNull(),
    verificationStatus: analysisVerificationStatus('verification_status')
      .notNull()
      .default('pending'),
    verificationEvidenceUrl: text('verification_evidence_url'),
    rawExcerpt: text('raw_excerpt').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    stageIdx: index('matter_analysis_sources_stage_idx').on(t.stageId),
    hashIdx: index('matter_analysis_sources_hash_idx').on(t.hash),
    citationIdx: index('matter_analysis_sources_citation_idx').on(t.citation),
  }),
);

export const matterAnalysesRelations = relations(matterAnalyses, ({ one, many }) => ({
  matter: one(matters, { fields: [matterAnalyses.matterId], references: [matters.id] }),
  stages: many(matterAnalysisStages),
}));

export const matterAnalysisStagesRelations = relations(
  matterAnalysisStages,
  ({ one, many }) => ({
    analysis: one(matterAnalyses, {
      fields: [matterAnalysisStages.analysisId],
      references: [matterAnalyses.id],
    }),
    invokedBy: one(users, {
      fields: [matterAnalysisStages.invokedByUserId],
      references: [users.id],
    }),
    sources: many(matterAnalysisSources),
  }),
);

export const matterAnalysisSourcesRelations = relations(matterAnalysisSources, ({ one }) => ({
  stage: one(matterAnalysisStages, {
    fields: [matterAnalysisSources.stageId],
    references: [matterAnalysisStages.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  requestedMatters: many(matters, { relationName: 'requester' }),
  assignedMatters: many(matters, { relationName: 'assignee' }),
  notes: many(matterNotes),
}));

export const mattersRelations = relations(matters, ({ one, many }) => ({
  requester: one(users, {
    fields: [matters.requesterId],
    references: [users.id],
    relationName: 'requester',
  }),
  assignee: one(users, {
    fields: [matters.assigneeId],
    references: [users.id],
    relationName: 'assignee',
  }),
  counterparty: one(counterparties, {
    fields: [matters.counterpartyId],
    references: [counterparties.id],
  }),
  events: many(matterEvents),
  notes: many(matterNotes),
  attachments: many(attachments),
}));

export const matterEventsRelations = relations(matterEvents, ({ one }) => ({
  matter: one(matters, { fields: [matterEvents.matterId], references: [matters.id] }),
  actor: one(users, { fields: [matterEvents.actorId], references: [users.id] }),
}));

export const matterNotesRelations = relations(matterNotes, ({ one }) => ({
  matter: one(matters, { fields: [matterNotes.matterId], references: [matters.id] }),
  author: one(users, { fields: [matterNotes.authorId], references: [users.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  matter: one(matters, { fields: [attachments.matterId], references: [matters.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Matter = typeof matters.$inferSelect;
export type NewMatter = typeof matters.$inferInsert;
export type MatterEvent = typeof matterEvents.$inferSelect;
export type NewMatterEvent = typeof matterEvents.$inferInsert;
export type MatterNote = typeof matterNotes.$inferSelect;
export type NewMatterNote = typeof matterNotes.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Counterparty = typeof counterparties.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type RoutingRule = typeof routingRules.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;
export type PlaybookVersion = typeof playbookVersions.$inferSelect;
export type PlaybookSuggestion = typeof playbookSuggestions.$inferSelect;
export type KnowledgeArticle = typeof knowledgeArticles.$inferSelect;
export type NewKnowledgeArticle = typeof knowledgeArticles.$inferInsert;
export type SystemInsight = typeof systemInsights.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
export type MatterDraft = typeof matterDrafts.$inferSelect;
export type NewMatterDraft = typeof matterDrafts.$inferInsert;
export type MatterDraftVersion = typeof matterDraftVersions.$inferSelect;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type MatterAnalysis = typeof matterAnalyses.$inferSelect;
export type NewMatterAnalysis = typeof matterAnalyses.$inferInsert;
export type MatterAnalysisStage = typeof matterAnalysisStages.$inferSelect;
export type NewMatterAnalysisStage = typeof matterAnalysisStages.$inferInsert;
export type MatterAnalysisSource = typeof matterAnalysisSources.$inferSelect;
export type NewMatterAnalysisSource = typeof matterAnalysisSources.$inferInsert;
