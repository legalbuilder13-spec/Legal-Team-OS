import { describe, expect, it } from 'vitest';
import { runNudgeMissedPlaybooks } from './nudge-missed-playbooks.js';

// Smoke test. Stubs db.select chain to return no candidates;
// asserts the short-circuit path returns the expected result shape.

function makeStubDb(): unknown {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
  };
}

describe('runNudgeMissedPlaybooks', () => {
  it('short-circuits when no candidate stages exist', async () => {
    const db = makeStubDb();
    const result = await runNudgeMissedPlaybooks(
      db as unknown as Parameters<typeof runNudgeMissedPlaybooks>[0],
    );
    expect(result.skipped).toBe('no_candidates');
    expect(result.candidates).toBe(0);
    expect(result.dmsSent).toBe(0);
  });
});
