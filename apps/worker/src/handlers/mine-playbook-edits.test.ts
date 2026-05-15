import { describe, expect, it } from 'vitest';
import { runMinePlaybookEdits } from './mine-playbook-edits.js';

// Smoke tests for the M7 mining handler. Full coverage requires a
// Postgres fixture + AI-service mock; these tests stub the minimum
// needed to exercise the short-circuit paths (mode='off',
// no_candidates) without touching the network.

function makeStubDb(candidates: unknown[]): unknown {
  return {
    execute: async () => candidates,
    select: () => ({
      from: () => ({
        where: () => candidates,
      }),
    }),
    insert: () => ({
      values: async () => undefined,
    }),
  };
}

describe('runMinePlaybookEdits', () => {
  it('returns disabled when mode=off (default)', async () => {
    const db = makeStubDb([]);
    const result = await runMinePlaybookEdits(
      db as unknown as Parameters<typeof runMinePlaybookEdits>[0],
      { mode: 'off' },
    );
    expect(result.skipped).toBe('disabled');
    expect(result.candidateCount).toBe(0);
    expect(result.proposalCount).toBe(0);
  });

  it('short-circuits with no_candidates when no closed matters in window', async () => {
    const db = makeStubDb([]);
    const result = await runMinePlaybookEdits(
      db as unknown as Parameters<typeof runMinePlaybookEdits>[0],
      { mode: 'on', lookbackDays: 7 },
    );
    expect(result.skipped).toBe('no_candidates');
    expect(result.candidateCount).toBe(0);
    expect(result.proposalCount).toBe(0);
  });

  it('short-circuits with no_candidates in single-matter mode when no rows', async () => {
    const db = makeStubDb([]);
    const result = await runMinePlaybookEdits(
      db as unknown as Parameters<typeof runMinePlaybookEdits>[0],
      { mode: 'on', matterId: '00000000-0000-0000-0000-000000000001' },
    );
    expect(result.skipped).toBe('no_candidates');
    expect(result.candidateCount).toBe(0);
  });

  it('shadow mode with candidates but no NOTION_API_KEY returns ai_unavailable', async () => {
    // The vitest env stub does not set NOTION_API_KEY, so the
    // handler should return 'ai_unavailable' before any AI call.
    const db = makeStubDb([
      {
        matter_id: 'm-1',
        matter_title: 'Test matter',
        notion_page_id: '11111111-1111-1111-1111-111111111111',
        matter_summary: 'Summary text.',
        closed_at: new Date(),
      },
    ]);
    const result = await runMinePlaybookEdits(
      db as unknown as Parameters<typeof runMinePlaybookEdits>[0],
      { mode: 'shadow' },
    );
    expect(result.candidateCount).toBe(1);
    expect(result.skipped).toBe('ai_unavailable');
    expect(result.proposalCount).toBe(0);
  });
});
