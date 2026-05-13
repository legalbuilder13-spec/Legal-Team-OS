import { describe, expect, it } from 'vitest';
import { bucketBySla, type AttorneyMatter } from '../utils';

function matter(slaOffsetHours: number | null, id = 'm1'): AttorneyMatter {
  return {
    id,
    shortId: id,
    title: 't',
    priority: 'medium',
    status: 'open',
    slaDueAt:
      slaOffsetHours === null
        ? null
        : new Date(Date.UTC(2026, 0, 1, 12) + slaOffsetHours * 3600 * 1000),
  };
}

describe('bucketBySla', () => {
  const ref = new Date(Date.UTC(2026, 0, 1, 12)).getTime();

  it('classifies negative offsets as overdue', () => {
    const out = bucketBySla([matter(-1), matter(-24)], ref);
    expect(out.overdue).toHaveLength(2);
    expect(out.dueToday).toHaveLength(0);
  });

  it('classifies offsets within 24h as due today', () => {
    const out = bucketBySla([matter(1), matter(23)], ref);
    expect(out.dueToday).toHaveLength(2);
  });

  it('classifies offsets within 7d as due this week', () => {
    const out = bucketBySla([matter(48), matter(24 * 6)], ref);
    expect(out.dueThisWeek).toHaveLength(2);
  });

  it('treats null SLA as noSla bucket', () => {
    const out = bucketBySla([matter(null)], ref);
    expect(out.noSla).toHaveLength(1);
    expect(out.overdue).toHaveLength(0);
  });

  it('partitions a mixed input correctly', () => {
    const out = bucketBySla(
      [matter(-2, 'a'), matter(12, 'b'), matter(72, 'c'), matter(null, 'd')],
      ref,
    );
    expect(out.overdue.map((m) => m.id)).toEqual(['a']);
    expect(out.dueToday.map((m) => m.id)).toEqual(['b']);
    expect(out.dueThisWeek.map((m) => m.id)).toEqual(['c']);
    expect(out.noSla.map((m) => m.id)).toEqual(['d']);
  });
});
