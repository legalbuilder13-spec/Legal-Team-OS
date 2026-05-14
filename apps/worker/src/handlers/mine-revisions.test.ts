import { describe, expect, it } from 'vitest';
import { runMineRevisions } from './mine-revisions.js';

// Smoke tests for mine-revisions. Full coverage requires a Postgres
// fixture; these tests stub the db.select chain just enough to verify
// the no-revisions short-circuit.

function makeStubDb(stages: unknown[]): unknown {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => stages,
        }),
      }),
    }),
  };
}

describe('runMineRevisions', () => {
  it('short-circuits when no revisions in window', async () => {
    const db = makeStubDb([]);
    const result = await runMineRevisions(
      db as unknown as Parameters<typeof runMineRevisions>[0],
      { lookbackDays: 30 },
    );
    expect(result.skipped).toBe('no_revisions');
    expect(result.revisionCount).toBe(0);
    expect(result.proposalCount).toBe(0);
  });

  it('short-circuits when only one revision in window', async () => {
    const db = makeStubDb([
      {
        id: 's-1',
        stageName: 'statutory',
        outputJson: { summary: 'AI text' },
        lawyerRevisedOutput: { text: 'lawyer revised text' },
        analysisId: 'a-1',
        decidedAt: new Date(),
      },
    ]);
    const result = await runMineRevisions(
      db as unknown as Parameters<typeof runMineRevisions>[0],
      { lookbackDays: 30 },
    );
    expect(result.skipped).toBe('no_revisions');
    expect(result.revisionCount).toBe(1);
    expect(result.proposalCount).toBe(0);
  });
});
