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
  'sla_check',
  'daily_digest',
  'slack_notify',
  'generate_embedding',
]);

export const userRole = pgEnum('user_role', ['attorney', 'legal_ops', 'admin', 'requester']);

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
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
    embedding: vector(1536)('embedding'),
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
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    practiceAreaIdx: index('playbooks_practice_area_idx').on(t.practiceArea),
  }),
);

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
