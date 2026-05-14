import { describe, expect, it } from 'vitest';
import { runMineRejections, type MineRejectionsResult } from './mine-rejections.js';

// Smoke tests for mine-rejections. The handler is mostly DB-glue;
// these tests verify the public surface compiles and a no-rows
// short-circuit returns the expected result shape. End-to-end coverage
// (audit_log row → cluster row) is gated behind an integration test
// harness with a real Postgres + AI service.

interface ExecuteCall {
  query: string;
}

function makeStubDb(rows: unknown[]): {
  // shape matches the subset of Db that runMineRejections touches.
  execute: (...args: unknown[]) => Promise<unknown[]>;
  select: () => { from: () => { where: () => { limit: () => Promise<unknown[]> } } };
  insert: () => { values: () => { returning: () => Promise<unknown[]> } };
  calls: ExecuteCall[];
} {
  const calls: ExecuteCall[] = [];
  return {
    execute: async (query: unknown) => {
      const text = typeof query === 'object' && query && 'queryChunks' in query ? '?' : String(query);
      calls.push({ query: text });
      return rows;
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [] as unknown[],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'stub-run-id' }],
      }),
    }),
    calls,
  };
}

describe('runMineRejections', () => {
  it('short-circuits when no rejection rows in window', async () => {
    const db = makeStubDb([]);
    // The handler signature accepts a Db. We cast through unknown
    // because the stub only implements the subset of methods used in
    // the no-rows fast-path; this is a unit-level smoke test, not a
    // full mock.
    const result: MineRejectionsResult = await runMineRejections(
      db as unknown as Parameters<typeof runMineRejections>[0],
      { lookbackDays: 7 },
    );
    expect(result.skipped).toBe('no_rejections');
    expect(result.rejectionCount).toBe(0);
    expect(result.clusterCount).toBe(0);
    expect(result.runId).toBeNull();
  });

  it('short-circuits when only one rejection in window', async () => {
    const db = makeStubDb([
      {
        audit_log_id: 'al-1',
        matter_id: 'm-1',
        stage_name: 'statutory',
        practice_area: 'employment',
        worker_confidence: 'MEDIUM',
        reason: 'Wrong jurisdiction',
        decided_at: new Date(),
      },
    ]);
    const result = await runMineRejections(
      db as unknown as Parameters<typeof runMineRejections>[0],
      { lookbackDays: 7 },
    );
    expect(result.skipped).toBe('no_rejections');
    expect(result.rejectionCount).toBe(1);
    expect(result.clusterCount).toBe(0);
  });
});
