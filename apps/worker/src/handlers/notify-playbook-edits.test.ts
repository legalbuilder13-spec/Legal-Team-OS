import { describe, expect, it } from 'vitest';
import { runNotifyPlaybookEdits } from './notify-playbook-edits.js';

// Smoke tests for the M7 daily Slack DM cron. The default test env has
// M7_SLACK_NOTIFY_ENABLED='off' from the zod schema default, so the
// flag-off short-circuit is the most important regression path.

function makeStubDb(rows: unknown[]): unknown {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    }),
  };
}

describe('runNotifyPlaybookEdits', () => {
  it('returns disabled when M7_SLACK_NOTIFY_ENABLED=off (default)', async () => {
    const db = makeStubDb([]);
    const result = await runNotifyPlaybookEdits(
      db as unknown as Parameters<typeof runNotifyPlaybookEdits>[0],
    );
    expect(result.skipped).toBe('disabled');
    expect(result.pendingCount).toBe(0);
    expect(result.dmsSent).toBe(0);
  });
});

// Tests that exercise the M7_SLACK_NOTIFY_ENABLED='on' branches
// (no_pending, no_admins, no_slack, full DM dispatch) require
// reloading the env module after overriding process.env, plus mocking
// the Slack /chat.postMessage fetch. Those paths are covered by the
// manual test plan in the PR description.
