import { Client } from '@notionhq/client';
import { env } from '@/env';

let _client: Client | null = null;

export function getNotion(): Client | null {
  if (!env.NOTION_API_KEY) return null;
  if (_client) return _client;
  _client = new Client({ auth: env.NOTION_API_KEY });
  return _client;
}

export interface NotionSearchHit {
  id: string;
  title: string;
  url: string;
  lastEditedAt: string | null;
  type: 'page' | 'database';
}

function extractTitle(properties: Record<string, unknown> | undefined): string {
  if (!properties) return 'Untitled';
  for (const value of Object.values(properties)) {
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? '').join('').trim();
      if (text) return text;
    }
  }
  return 'Untitled';
}

export async function searchNotion(query: string, limit = 8): Promise<NotionSearchHit[]> {
  const notion = getNotion();
  if (!notion) return [];

  const res = await notion.search({
    query,
    page_size: limit,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });

  return res.results.map((r) => {
    const obj = r as {
      id: string;
      object: 'page' | 'database';
      url?: string;
      last_edited_time?: string;
      properties?: Record<string, unknown>;
      title?: Array<{ plain_text?: string }>;
    };
    let title = 'Untitled';
    if (obj.object === 'database' && Array.isArray(obj.title)) {
      title = obj.title.map((t) => t.plain_text ?? '').join('') || 'Untitled';
    } else {
      title = extractTitle(obj.properties);
    }
    return {
      id: obj.id,
      title,
      url: obj.url ?? `https://www.notion.so/${obj.id.replace(/-/g, '')}`,
      lastEditedAt: obj.last_edited_time ?? null,
      type: obj.object,
    };
  });
}

function blocksToText(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const block = b as {
      type?: string;
      paragraph?: { rich_text?: Array<{ plain_text?: string }> };
      heading_1?: { rich_text?: Array<{ plain_text?: string }> };
      heading_2?: { rich_text?: Array<{ plain_text?: string }> };
      heading_3?: { rich_text?: Array<{ plain_text?: string }> };
      bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
      numbered_list_item?: { rich_text?: Array<{ plain_text?: string }> };
      to_do?: { rich_text?: Array<{ plain_text?: string }>; checked?: boolean };
      code?: { rich_text?: Array<{ plain_text?: string }> };
      quote?: { rich_text?: Array<{ plain_text?: string }> };
    };
    const get = (rt?: Array<{ plain_text?: string }>) =>
      (rt ?? []).map((t) => t.plain_text ?? '').join('');
    switch (block.type) {
      case 'heading_1': parts.push(`# ${get(block.heading_1?.rich_text)}`); break;
      case 'heading_2': parts.push(`## ${get(block.heading_2?.rich_text)}`); break;
      case 'heading_3': parts.push(`### ${get(block.heading_3?.rich_text)}`); break;
      case 'bulleted_list_item': parts.push(`- ${get(block.bulleted_list_item?.rich_text)}`); break;
      case 'numbered_list_item': parts.push(`1. ${get(block.numbered_list_item?.rich_text)}`); break;
      case 'to_do':
        parts.push(`- [${block.to_do?.checked ? 'x' : ' '}] ${get(block.to_do?.rich_text)}`);
        break;
      case 'code': parts.push('```\n' + get(block.code?.rich_text) + '\n```'); break;
      case 'quote': parts.push(`> ${get(block.quote?.rich_text)}`); break;
      case 'paragraph':
      default:
        parts.push(get(block.paragraph?.rich_text));
        break;
    }
  }
  return parts.filter(Boolean).join('\n');
}

export async function fetchNotionPage(pageId: string): Promise<{ title: string; markdown: string; url: string } | null> {
  const notion = getNotion();
  if (!notion) return null;

  const [page, blocks] = await Promise.all([
    notion.pages.retrieve({ page_id: pageId }),
    notion.blocks.children.list({ block_id: pageId, page_size: 100 }),
  ]);

  const p = page as { url?: string; properties?: Record<string, unknown> };
  return {
    title: extractTitle(p.properties),
    markdown: blocksToText(blocks.results),
    url: p.url ?? `https://www.notion.so/${pageId.replace(/-/g, '')}`,
  };
}

function paragraphBlock(text: string) {
  return {
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [{ type: 'text' as const, text: { content: text.slice(0, 1900) } }],
    },
  };
}

export async function createNotionPage(args: {
  title: string;
  body: string;
  parentPageId?: string;
}): Promise<{ id: string; url: string } | null> {
  const notion = getNotion();
  if (!notion) return null;

  const parent = args.parentPageId ?? env.NOTION_DEFAULT_PARENT_PAGE_ID;
  if (!parent) {
    throw new Error('NOTION_DEFAULT_PARENT_PAGE_ID is not set and no parentPageId was provided');
  }

  const paragraphs = args.body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const children = paragraphs.length > 0
    ? paragraphs.map(paragraphBlock)
    : [paragraphBlock(args.body || '')];

  const created = await notion.pages.create({
    parent: { page_id: parent },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: args.title.slice(0, 200) } }],
      },
    },
    children,
  });
  const c = created as { id: string; url?: string };
  return {
    id: c.id,
    url: c.url ?? `https://www.notion.so/${c.id.replace(/-/g, '')}`,
  };
}

export async function appendToNotionPage(pageId: string, body: string): Promise<boolean> {
  const notion = getNotion();
  if (!notion) return false;

  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const children = paragraphs.length > 0
    ? paragraphs.map(paragraphBlock)
    : [paragraphBlock(body)];

  await notion.blocks.children.append({ block_id: pageId, children });
  return true;
}
