import type { PracticeArea } from '../index.js';
import type { InventoryItem, PracticeAreaInventory } from './types.js';
import { COMMERCIAL_INVENTORY, COMMERCIAL_INVENTORY_VERSION } from './commercial.js';
import { EMPLOYMENT_INVENTORY, EMPLOYMENT_INVENTORY_VERSION } from './employment.js';
import { PRIVACY_INVENTORY, PRIVACY_INVENTORY_VERSION } from './privacy.js';
import { LITIGATION_INVENTORY, LITIGATION_INVENTORY_VERSION } from './litigation.js';
import { IP_INVENTORY, IP_INVENTORY_VERSION } from './ip.js';
import { CORPORATE_INVENTORY, CORPORATE_INVENTORY_VERSION } from './corporate.js';
import { REGULATORY_INVENTORY, REGULATORY_INVENTORY_VERSION } from './regulatory.js';
import { REAL_ESTATE_INVENTORY, REAL_ESTATE_INVENTORY_VERSION } from './real_estate.js';

// PRD §12.1. PR5 fills out the remaining five practice areas so every
// triage classification has a curated inventory template. The
// deconstruct tool gets candidate nodes per area; the skill prunes
// down to what the matter actually implicates.

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
  litigation: {
    practiceArea: 'litigation',
    version: LITIGATION_INVENTORY_VERSION,
    items: LITIGATION_INVENTORY,
  },
  ip: { practiceArea: 'ip', version: IP_INVENTORY_VERSION, items: IP_INVENTORY },
  corporate: {
    practiceArea: 'corporate',
    version: CORPORATE_INVENTORY_VERSION,
    items: CORPORATE_INVENTORY,
  },
  regulatory: {
    practiceArea: 'regulatory',
    version: REGULATORY_INVENTORY_VERSION,
    items: REGULATORY_INVENTORY,
  },
  real_estate: {
    practiceArea: 'real_estate',
    version: REAL_ESTATE_INVENTORY_VERSION,
    items: REAL_ESTATE_INVENTORY,
  },
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
  LITIGATION_INVENTORY,
  LITIGATION_INVENTORY_VERSION,
  IP_INVENTORY,
  IP_INVENTORY_VERSION,
  CORPORATE_INVENTORY,
  CORPORATE_INVENTORY_VERSION,
  REGULATORY_INVENTORY,
  REGULATORY_INVENTORY_VERSION,
  REAL_ESTATE_INVENTORY,
  REAL_ESTATE_INVENTORY_VERSION,
};
