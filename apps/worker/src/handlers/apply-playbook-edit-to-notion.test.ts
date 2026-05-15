import { describe, expect, it, vi } from 'vitest';
import { handleApplyPlaybookEditToNotionJob } from './apply-playbook-edit-to-notion.js';

// Smoke tests for the M7 Notion auto-apply handler. The default test
// env has M7_AUTO_APPLY_NOTION='off' (from the zod schema default), so
// the most important regression path — flag off → noop — is exercised
// directly. Other paths use a stub DB whose update() calls are
// captured for assertion.

interface UpdateCall {
  set: Record<string, unknown>;
  where: unknown;
}

function makeStubDb(proposals: Record<string, unknown>[]): {
  db: unknown;
  updates: UpdateCall[];
} {
  const updates: UpdateCall[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => proposals,
        }),
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: (w: unknown) => {
          updates.push({ set: s, where: w });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, updates };
}

const fakeJob = (proposalId: string | null): unknown => ({
  id: 'job-1',
  kind: 'apply_playbook_edit_to_notion',
  payload: proposalId === null ? null : { proposal_id: proposalId },
  matterId: null,
  status: 'running',
  attempts: 1,
  startedAt: new Date(),
  completedAt: null,
  runAt: new Date(),
  scheduledFor: new Date(),
});

describe('handleApplyPlaybookEditToNotionJob', () => {
  it('noops when payload is missing proposal_id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, updates } = makeStubDb([]);
    await handleApplyPlaybookEditToNotionJob(
      db as unknown as Parameters<typeof handleApplyPlaybookEditToNotionJob>[0],
      fakeJob(null) as unknown as Parameters<
        typeof handleApplyPlaybookEditToNotionJob
      >[1],
    );
    expect(warn).toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    warn.mockRestore();
  });

  it('noops with disabled log when M7_AUTO_APPLY_NOTION=off (default)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { db, updates } = makeStubDb([]);
    await handleApplyPlaybookEditToNotionJob(
      db as unknown as Parameters<typeof handleApplyPlaybookEditToNotionJob>[0],
      fakeJob('00000000-0000-0000-0000-000000000001') as unknown as Parameters<
        typeof handleApplyPlaybookEditToNotionJob
      >[1],
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
    );
    // Disabled path must not touch the proposal row.
    expect(updates).toHaveLength(0);
    log.mockRestore();
  });
});

// Tests that exercise the M7_AUTO_APPLY_NOTION='on' path require
// reloading the env module after overriding process.env, which fights
// the vitest config's top-level env stubs. Those branches (proposal
// not found, wrong status, already applied, missing notion_page_id,
// missing NOTION_API_KEY) are covered in the typecheck + manual test
// plan in the PR description rather than here.
