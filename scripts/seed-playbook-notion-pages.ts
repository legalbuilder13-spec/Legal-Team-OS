#!/usr/bin/env tsx
// One-off seed script — for each row in `playbooks` with notion_page_id
// IS NULL, create a child page under the Notion Playbooks tree with the
// playbook body, then UPDATE playbooks SET notion_page_id = <new id>.
//
// Motivation: per scripts/LAUNCH_GATE_2026-05-15.md, the analysis
// pipeline's Stage 1 search returns 0 candidates because none of the
// registry's playbook rows point at Notion pages. This script wires
// them up so the M4 canon-tier boost has something to amplify and
// the grader has something to score.
//
// Usage:
//   DATABASE_URL=... \
//   NOTION_API_KEY=... \
//   PLAYBOOKS_PARENT_PAGE_ID=35f598cc-a369-8145-83ba-cf7786ff2d33 \
//     pnpm --filter @legal/web exec tsx ../../scripts/seed-playbook-notion-pages.ts
//
// Optional flags:
//   --dry-run        Log what would happen; no Notion writes, no DB updates.
//   --limit N        Cap how many playbooks to process (default: all).
//
// The integration must already be shared on the Playbooks tree (see
// reference_notion.md). The script is idempotent — playbooks that
// already have notion_page_id set are skipped.

import { Client } from '@notionhq/client';
import { sql } from 'drizzle-orm';
import { getDb, playbooks } from '@legal/db';
import { eq } from 'drizzle-orm';

interface CliOpts {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit') opts.limit = parseInt(argv[++i] ?? '', 10) || null;
  }
  return opts;
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

async function createPlaybookPage(
  notion: Client,
  parentPageId: string,
  title: string,
  body: string,
): Promise<{ id: string; url: string }> {
  // Split on blank lines into paragraphs; Notion blocks have a 2000-char
  // limit per rich_text segment, so slice each paragraph defensively.
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const children = paragraphs.length > 0
    ? paragraphs.map((p) => paragraphBlock(p.trim()))
    : [paragraphBlock(body || '(empty playbook)')];

  const created = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: title.slice(0, 200) } }],
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const apiKey = process.env.NOTION_API_KEY;
  const parentPageId = process.env.PLAYBOOKS_PARENT_PAGE_ID;
  if (!apiKey) throw new Error('NOTION_API_KEY is required');
  if (!parentPageId) throw new Error('PLAYBOOKS_PARENT_PAGE_ID is required');

  const db = getDb();
  const notion = new Client({ auth: apiKey });

  // Fetch every unwired playbook. We don't filter by isActive — the
  // launch-gate situation is "no playbooks have notion_page_id," so
  // we err on the side of wiring everything we have. If a playbook
  // is inactive, M4 won't promote it and Stage 1 won't return it
  // (active filter is applied elsewhere); having a notion_page_id
  // on an inactive row is harmless.
  let rows = await db
    .select({
      id: playbooks.id,
      title: playbooks.title,
      body: playbooks.body,
      practiceArea: playbooks.practiceArea,
      isActive: playbooks.isActive,
    })
    .from(playbooks)
    .where(sql`${playbooks.notionPageId} IS NULL`);

  if (opts.limit !== null) rows = rows.slice(0, opts.limit);

  console.log(
    `Found ${rows.length} playbook${rows.length === 1 ? '' : 's'} without notion_page_id.`,
  );
  if (opts.dryRun) {
    for (const r of rows) {
      console.log(
        `  [dry-run] would create page for "${r.title}" (${r.practiceArea}, active=${r.isActive}, body_chars=${r.body.length})`,
      );
    }
    return;
  }

  let createdCount = 0;
  let errorCount = 0;
  for (const r of rows) {
    try {
      const titleWithArea = `${r.title} — ${r.practiceArea}`;
      const created = await createPlaybookPage(
        notion,
        parentPageId,
        titleWithArea,
        r.body,
      );
      await db
        .update(playbooks)
        .set({ notionPageId: created.id, updatedAt: new Date() })
        .where(eq(playbooks.id, r.id));
      createdCount += 1;
      console.log(`  ✓ ${r.title}  →  ${created.url}`);
    } catch (err) {
      errorCount += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${r.title}: ${msg.slice(0, 300)}`);
    }
  }

  console.log(
    `\nDone. created=${createdCount} error=${errorCount} skipped=${rows.length - createdCount - errorCount}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
