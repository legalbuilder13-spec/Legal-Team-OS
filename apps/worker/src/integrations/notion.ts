// Minimal Notion REST client for the worker. We don't depend on
// @notionhq/client here — only need search + page-block-read, both of
// which are simple JSON endpoints. Keeping the worker dependency-light
// avoids churning pnpm-lock for every new context source.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionSearchHit {
  id: string;
  title: string;
  url: string;
  lastEditedAt: string | null;
  type: 'page' | 'database';
}

interface NotionRawSearchResult {
  id: string;
  object: 'page' | 'database';
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
  title?: Array<{ plain_text?: string }>;
}

function extractTitle(result: NotionRawSearchResult): string {
  // Databases have a top-level `title` array; pages have a `title`-type
  // property inside `properties` (whose key name is user-configurable).
  if (result.object === 'database' && Array.isArray(result.title)) {
    const t = result.title
      .map((seg) => seg.plain_text ?? '')
      .join('')
      .trim();
    if (t) return t;
  }
  if (result.properties) {
    for (const value of Object.values(result.properties)) {
      const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
      if (prop?.type === 'title' && Array.isArray(prop.title)) {
        const text = prop.title
          .map((seg) => seg.plain_text ?? '')
          .join('')
          .trim();
        if (text) return text;
      }
    }
  }
  return 'Untitled';
}

export async function searchNotion(
  apiKey: string,
  query: string,
  limit = 8,
): Promise<NotionSearchHit[]> {
  const res = await fetch(`${NOTION_API}/search`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'notion-version': NOTION_VERSION,
    },
    body: JSON.stringify({
      query,
      page_size: limit,
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion search failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { results: NotionRawSearchResult[] };
  return data.results.map((r) => ({
    id: r.id,
    title: extractTitle(r),
    url: r.url ?? `https://notion.so/${r.id.replace(/-/g, '')}`,
    lastEditedAt: r.last_edited_time ?? null,
    type: r.object,
  }));
}

interface NotionBlock {
  type: string;
  paragraph?: { rich_text: Array<{ plain_text?: string }> };
  heading_1?: { rich_text: Array<{ plain_text?: string }> };
  heading_2?: { rich_text: Array<{ plain_text?: string }> };
  heading_3?: { rich_text: Array<{ plain_text?: string }> };
  bulleted_list_item?: { rich_text: Array<{ plain_text?: string }> };
  numbered_list_item?: { rich_text: Array<{ plain_text?: string }> };
  to_do?: { rich_text: Array<{ plain_text?: string }> };
  quote?: { rich_text: Array<{ plain_text?: string }> };
  callout?: { rich_text: Array<{ plain_text?: string }> };
}

function blockText(block: NotionBlock): string {
  const segment =
    block.paragraph ??
    block.heading_1 ??
    block.heading_2 ??
    block.heading_3 ??
    block.bulleted_list_item ??
    block.numbered_list_item ??
    block.to_do ??
    block.quote ??
    block.callout;
  if (!segment) return '';
  return segment.rich_text.map((rt) => rt.plain_text ?? '').join('');
}

// Fetches the top-level blocks of a Notion page and concatenates their
// plain-text content. Capped at maxChars to keep LLM prompts bounded.
export async function fetchNotionPageExcerpt(
  apiKey: string,
  pageId: string,
  maxChars = 2000,
): Promise<string> {
  const res = await fetch(`${NOTION_API}/blocks/${pageId}/children?page_size=50`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'notion-version': NOTION_VERSION,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion blocks fetch failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { results: NotionBlock[] };
  const lines: string[] = [];
  let total = 0;
  for (const block of data.results) {
    const text = blockText(block);
    if (!text) continue;
    if (total + text.length > maxChars) {
      lines.push(text.slice(0, maxChars - total));
      break;
    }
    lines.push(text);
    total += text.length;
    if (total >= maxChars) break;
  }
  return lines.join('\n');
}
