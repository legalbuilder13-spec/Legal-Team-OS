import type { PracticeArea } from '../index.js';
import type { InventoryItem, PracticeAreaInventory } from './types.js';
import { COMMERCIAL_INVENTORY, COMMERCIAL_INVENTORY_VERSION } from './commercial.js';
import { EMPLOYMENT_INVENTORY, EMPLOYMENT_INVENTORY_VERSION } from './employment.js';
import { PRIVACY_INVENTORY, PRIVACY_INVENTORY_VERSION } from './privacy.js';

// PRD §12.1 + §19.4. Per-practice-area inventory templates. Phase 4
// ships inventories for the three highest-volume practice areas; the
// others get an empty stub. Deconstruct tool gracefully degrades:
// empty inventory just means the skill builds the tree from prior
// stage outputs without a pre-loaded candidate-node list.

const EMPTY: InventoryItem[] = [];

export const PRACTICE_AREA_INVENTORIES: Record<PracticeArea, PracticeAreaInventory> = {
  commercial: {
    practiceArea: 'commercial',
    version: COMMERCIAL_INVENTORY_VERSION,
    items: COMMERCIAL_INVENTORY,
  },
  employment: {
    practiceArea: 'employment',
    version: EMPLOYMENT_INVENTORY_VERSION,
    items: EMPLOYMENT_INVENTORY,
  },
  privacy: {
    practiceArea: 'privacy',
    version: PRIVACY_INVENTORY_VERSION,
    items: PRIVACY_INVENTORY,
  },
  litigation: { practiceArea: 'litigation', version: '0.0.0', items: EMPTY },
  ip: { practiceArea: 'ip', version: '0.0.0', items: EMPTY },
  corporate: { practiceArea: 'corporate', version: '0.0.0', items: EMPTY },
  regulatory: { practiceArea: 'regulatory', version: '0.0.0', items: EMPTY },
  real_estate: { practiceArea: 'real_estate', version: '0.0.0', items: EMPTY },
  other: { practiceArea: 'other', version: '0.0.0', items: EMPTY },
};

export function getPracticeAreaInventory(area: PracticeArea): PracticeAreaInventory {
  return PRACTICE_AREA_INVENTORIES[area];
}

export type { InventoryItem, PracticeAreaInventory };
export {
  EMPLOYMENT_INVENTORY,
  EMPLOYMENT_INVENTORY_VERSION,
  COMMERCIAL_INVENTORY,
  COMMERCIAL_INVENTORY_VERSION,
  PRIVACY_INVENTORY,
  PRIVACY_INVENTORY_VERSION,
};
