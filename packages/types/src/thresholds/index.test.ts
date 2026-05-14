import { describe, expect, it } from 'vitest';
import { THRESHOLD_CHECKLISTS, getThresholdChecklist } from './index.js';

describe('THRESHOLD_CHECKLISTS', () => {
  const populated = [
    'commercial',
    'employment',
    'privacy',
    'litigation',
    'ip',
    'corporate',
    'regulatory',
    'real_estate',
  ] as const;

  it.each(populated)('has at least one item for %s', (area) => {
    const list = THRESHOLD_CHECKLISTS[area];
    expect(list.items.length).toBeGreaterThan(0);
  });

  it('leaves the `other` practice area empty', () => {
    expect(THRESHOLD_CHECKLISTS.other.items).toEqual([]);
  });

  it('every populated checklist has a non-default version', () => {
    for (const area of populated) {
      const list = THRESHOLD_CHECKLISTS[area];
      expect(list.version).not.toBe('0.0.0');
    }
  });

  it('every item has a unique id within its checklist', () => {
    for (const list of Object.values(THRESHOLD_CHECKLISTS)) {
      const ids = list.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every item has a non-empty prompt', () => {
    for (const list of Object.values(THRESHOLD_CHECKLISTS)) {
      for (const item of list.items) {
        expect(item.prompt.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('getThresholdChecklist', () => {
  it('returns the same list shape as the registry', () => {
    const direct = THRESHOLD_CHECKLISTS.employment;
    const fetched = getThresholdChecklist('employment');
    expect(fetched.items.length).toBe(direct.items.length);
    expect(fetched.version).toBe(direct.version);
  });

  it('returns the empty `other` stub when the area is unrecognized in spirit', () => {
    expect(getThresholdChecklist('other').items).toEqual([]);
  });
});
