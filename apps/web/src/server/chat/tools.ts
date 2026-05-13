import { and, eq, ilike, or, sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import {
  playbooks,
  knowledgeArticles,
  matters,
  matterNotes,
  matterEvents,
  auditLog,
  jobs,
  type Db,
} from '@legal/db';
import { MatterStatusSchema } from '@legal/types';
import { searchNotion, fetchNotionPage, createNotionPage, appendToNotionPage } from '../integrations/notion';
import {
  searchDrive,
  fetchDriveDocument,
  createDriveDocument,
  appendToDriveDocument,
} from '../integrations/google-drive';

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'search_playbooks',
    description:
      'Search the firm playbook library. Returns titles and bodies of active playbooks matching the query. Use this whenever the attorney asks about firm policy, standard positions, or how to handle a clause.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search playbook titles and bodies.' },
        practice_area: {
          type: 'string',
          description: 'Optional practice area filter (e.g. commercial, employment, privacy, litigation, corporate, regulatory, ip, real_estate, other).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the internal knowledge base / FAQ articles for relevant information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        practice_area: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_similar_matters',
    description:
      'Find similar past matters (closed) by full-text search across title, request, and summary. Use to find precedent.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Max results (default 5, max 15).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_salesforce_account',
    description:
      'Return the Salesforce account context cached on this matter (revenue, industry, owner). Returns null if not fetched or not configured.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_notion',
    description:
      'Search the connected Notion workspace for pages or databases. Returns id, title, url, and last edited time. Use fetch_notion_page to read the full body of a result.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_notion_page',
    description: 'Fetch the full markdown body of a Notion page by id.',
    input_schema: {
      type: 'object',
      properties: { page_id: { type: 'string' } },
      required: ['page_id'],
    },
  },
  {
    name: 'save_to_notion',
    description:
      'Create a new Notion page under the configured parent page, or append to an existing page if page_id is provided. Use this when the attorney asks to save the conversation, a draft, or a summary to Notion.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title for a new page. Ignored if page_id is given.' },
        body: { type: 'string', description: 'Markdown-ish text. Paragraphs split on blank lines.' },
        page_id: { type: 'string', description: 'If set, appends to this page instead of creating a new one.' },
      },
      required: ['body'],
    },
  },
  {
    name: 'search_drive',
    description:
      'Search the connected Google Drive for files. Returns id, name, mimeType, webViewLink. Use fetch_drive_doc to read the body.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_drive_doc',
    description:
      'Fetch the body of a Drive file by id. Supports Google Docs (returns plain text), text files, and JSON. Other binary types return a stub.',
    input_schema: {
      type: 'object',
      properties: { file_id: { type: 'string' } },
      required: ['file_id'],
    },
  },
  {
    name: 'save_to_drive',
    description:
      'Create a new Google Doc under the configured default folder, or append to an existing doc if file_id is provided.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        file_id: { type: 'string', description: 'If set, appends to this existing Doc.' },
      },
      required: ['body'],
    },
  },
  {
    name: 'propose_note',
    description:
      'Propose adding a note to the current matter. The note is added immediately and visible to the attorney.',
    input_schema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
  },
  {
    name: 'propose_status_change',
    description:
      'Propose changing the matter status. Valid: open, in_review, waiting_on_requester, waiting_on_third_party, closed, cancelled.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
    },
  },
];

export interface ToolContext {
  db: Db;
  matterId: string;
  userId: string;
  userName: string;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'open',
  in_review: 'in review',
  waiting_on_requester: 'waiting on requester',
  waiting_on_third_party: 'waiting on third party',
  closed: 'closed',
  cancelled: 'cancelled',
};

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case 'search_playbooks': {
        const q = String(input.query ?? '').slice(0, 200);
        const area = typeof input.practice_area === 'string' ? input.practice_area : null;
        const conditions = [eq(playbooks.isActive, true)];
        if (q) {
          conditions.push(
            or(ilike(playbooks.title, `%${q}%`), ilike(playbooks.body, `%${q}%`))!,
          );
        }
        if (area) {
          conditions.push(sql`${playbooks.practiceArea}::text = ${area}`);
        }
        const rows = await ctx.db
          .select({
            id: playbooks.id,
            title: playbooks.title,
            practiceArea: playbooks.practiceArea,
            body: playbooks.body,
            version: playbooks.version,
          })
          .from(playbooks)
          .where(and(...conditions))
          .limit(5);
        return JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            practice_area: r.practiceArea,
            version: r.version,
            body: r.body.slice(0, 4000),
          })),
        );
      }

      case 'search_knowledge': {
        const q = String(input.query ?? '').slice(0, 200);
        const area = typeof input.practice_area === 'string' ? input.practice_area : null;
        const conditions = [eq(knowledgeArticles.isActive, true)];
        if (q) {
          conditions.push(
            or(ilike(knowledgeArticles.title, `%${q}%`), ilike(knowledgeArticles.body, `%${q}%`))!,
          );
        }
        if (area) {
          conditions.push(sql`${knowledgeArticles.practiceArea}::text = ${area}`);
        }
        const rows = await ctx.db
          .select()
          .from(knowledgeArticles)
          .where(and(...conditions))
          .limit(5);
        return JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            practice_area: r.practiceArea,
            tags: r.tags,
            body: r.body.slice(0, 4000),
          })),
        );
      }

      case 'search_similar_matters': {
        const q = String(input.query ?? '').slice(0, 500);
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 15);
        if (!q) return JSON.stringify([]);
        const result = await ctx.db.execute(sql`
          SELECT id, short_id, title, summary, practice_area, priority, status, closed_at,
            ts_rank(
              to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '') || ' ' || coalesce(summary, '')),
              plainto_tsquery('english', ${q})
            ) as rank
          FROM matters
          WHERE id != ${ctx.matterId}
            AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, '') || ' ' || coalesce(summary, ''))
                @@ plainto_tsquery('english', ${q})
          ORDER BY rank DESC
          LIMIT ${limit}
        `);
        return JSON.stringify(result);
      }

      case 'read_salesforce_account': {
        const matter = await ctx.db.query.matters.findFirst({
          where: eq(matters.id, ctx.matterId),
        });
        const sf = (matter?.context as Record<string, unknown> | null)?.salesforce;
        return JSON.stringify(sf ?? null);
      }

      case 'search_notion': {
        const q = String(input.query ?? '').slice(0, 200);
        const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);
        const hits = await searchNotion(q, limit);
        if (hits.length === 0) {
          return JSON.stringify({
            results: [],
            note: 'No results, or Notion not configured (NOTION_API_KEY unset).',
          });
        }
        return JSON.stringify({ results: hits });
      }

      case 'fetch_notion_page': {
        const pageId = String(input.page_id ?? '');
        if (!pageId) return JSON.stringify({ error: 'page_id required' });
        const page = await fetchNotionPage(pageId);
        if (!page) return JSON.stringify({ error: 'Notion not configured or page not found' });
        return JSON.stringify(page);
      }

      case 'save_to_notion': {
        const body = String(input.body ?? '').slice(0, 50_000);
        const pageId = typeof input.page_id === 'string' ? input.page_id : null;
        if (!body) return JSON.stringify({ error: 'body required' });
        if (pageId) {
          const ok = await appendToNotionPage(pageId, body);
          return JSON.stringify({ appended: ok, page_id: pageId });
        }
        const title = String(input.title ?? 'Untitled note from Legal Team OS').slice(0, 200);
        try {
          const created = await createNotionPage({ title, body });
          if (!created) return JSON.stringify({ error: 'Notion not configured' });
          return JSON.stringify({ created: true, ...created });
        } catch (e) {
          return JSON.stringify({ error: (e as Error).message });
        }
      }

      case 'search_drive': {
        const q = String(input.query ?? '').slice(0, 200);
        const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
        const hits = await searchDrive(q, limit);
        if (hits.length === 0) {
          return JSON.stringify({
            results: [],
            note: 'No results, or Google Drive not configured (GOOGLE_SERVICE_ACCOUNT_JSON unset).',
          });
        }
        return JSON.stringify({ results: hits });
      }

      case 'fetch_drive_doc': {
        const fileId = String(input.file_id ?? '');
        if (!fileId) return JSON.stringify({ error: 'file_id required' });
        const doc = await fetchDriveDocument(fileId);
        if (!doc) return JSON.stringify({ error: 'Drive not configured or file not found' });
        return JSON.stringify(doc);
      }

      case 'save_to_drive': {
        const body = String(input.body ?? '').slice(0, 100_000);
        const fileId = typeof input.file_id === 'string' ? input.file_id : null;
        if (!body) return JSON.stringify({ error: 'body required' });
        if (fileId) {
          const ok = await appendToDriveDocument(fileId, body);
          return JSON.stringify({ appended: ok, file_id: fileId });
        }
        const title = String(input.title ?? 'Untitled note from Legal Team OS').slice(0, 200);
        try {
          const created = await createDriveDocument({ title, body });
          if (!created) return JSON.stringify({ error: 'Drive not configured' });
          return JSON.stringify({ created: true, ...created });
        } catch (e) {
          return JSON.stringify({ error: (e as Error).message });
        }
      }

      case 'propose_note': {
        const body = String(input.body ?? '').slice(0, 5000).trim();
        if (!body) return JSON.stringify({ error: 'body required' });
        const [note] = await ctx.db
          .insert(matterNotes)
          .values({
            matterId: ctx.matterId,
            body,
            authorId: ctx.userId,
            source: 'copilot',
          })
          .returning();
        await ctx.db.insert(matterEvents).values({
          matterId: ctx.matterId,
          actorId: ctx.userId,
          kind: 'note.added',
          payload: { noteId: note?.id, source: 'copilot' },
        });
        await ctx.db.insert(auditLog).values({
          actorId: ctx.userId,
          matterId: ctx.matterId,
          action: 'note.added',
          details: { noteId: note?.id, source: 'copilot' },
        });
        return JSON.stringify({ added: true, note_id: note?.id });
      }

      case 'propose_status_change': {
        const parsed = MatterStatusSchema.safeParse(input.status);
        if (!parsed.success) {
          return JSON.stringify({ error: `invalid status: ${input.status}` });
        }
        const status = parsed.data;
        const closedAt = status === 'closed' ? new Date() : null;
        const [updated] = await ctx.db
          .update(matters)
          .set({ status, closedAt, updatedAt: new Date() })
          .where(eq(matters.id, ctx.matterId))
          .returning();
        await ctx.db.insert(matterEvents).values({
          matterId: ctx.matterId,
          actorId: ctx.userId,
          kind: 'status.changed',
          payload: { status, source: 'copilot' },
        });
        await ctx.db.insert(auditLog).values({
          actorId: ctx.userId,
          matterId: ctx.matterId,
          action: 'matter.status_changed',
          details: { status, source: 'copilot' },
        });
        if (updated?.slackChannelId) {
          await ctx.db.insert(jobs).values({
            kind: 'slack_notify',
            matterId: ctx.matterId,
            payload: {
              matter_id: ctx.matterId,
              text: `Status changed to *${STATUS_LABEL[status] ?? status}* via copilot (${ctx.userName}).`,
            },
          });
        }
        return JSON.stringify({ updated: true, status });
      }

      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}

