import { describe, expect, it } from 'vitest';
import { PRACTICE_AREA_INVENTORIES, getPracticeAreaInventory } from './index.js';

describe('PRACTICE_AREA_INVENTORIES', () => {
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

  it.each(populated)('has at least 8 items for %s', (area) => {
    const inv = PRACTICE_AREA_INVENTORIES[area];
    expect(inv.items.length).toBeGreaterThanOrEqual(8);
  });

  it('leaves the `other` practice area empty', () => {
    expect(PRACTICE_AREA_INVENTORIES.other.items).toEqual([]);
  });

  it('every populated inventory has a non-default version', () => {
    for (const area of populated) {
      expect(PRACTICE_AREA_INVENTORIES[area].version).not.toBe('0.0.0');
    }
  });

  it('every item id is unique within its inventory', () => {
    for (const inv of Object.values(PRACTICE_AREA_INVENTORIES)) {
      const ids = inv.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every item has a non-empty label + description', () => {
    for (const inv of Object.values(PRACTICE_AREA_INVENTORIES)) {
      for (const item of inv.items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(10);
      }
    }
  });

  it('category strings come from the allowed set', () => {
    const allowed = new Set([
      'federal_statutes',
      'state_statutes',
      'local_ordinances',
      'common_law',
      'restrictive_covenants',
      'collateral_consequences',
      'contract_clauses',
      'remedies_defenses',
      'procedural',
      'data_categories',
      'cross_border',
      'breach_response',
    ]);
    for (const inv of Object.values(PRACTICE_AREA_INVENTORIES)) {
      for (const item of inv.items) {
        expect(allowed.has(item.category)).toBe(true);
      }
    }
  });
});

describe('getPracticeAreaInventory', () => {
  it('matches the registry lookup', () => {
    expect(getPracticeAreaInventory('employment').items.length).toBe(
      PRACTICE_AREA_INVENTORIES.employment.items.length,
    );
  });
});
