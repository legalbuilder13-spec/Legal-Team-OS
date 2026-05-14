import { describe, expect, it } from 'vitest';
import { compactMatter } from './compact-matter.js';

// Smoke tests for compact-matter. Full coverage requires a Postgres
// fixture + AI service mock; these cases verify the public surface
// compiles and the error path on missing matter throws as expected.

describe('compactMatter', () => {
  it('throws when the matter does not exist', async () => {
    const stubDb = {
      query: {
        matters: {
          findFirst: async () => undefined,
        },
      },
    };
    await expect(
      compactMatter(stubDb as unknown as Parameters<typeof compactMatter>[0], 'missing-id'),
    ).rejects.toThrow(/matter missing-id not found/);
  });
});
