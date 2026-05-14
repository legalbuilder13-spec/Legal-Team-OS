import type { PracticeArea } from '../index.js';
import type { ThresholdItem } from '../analysis.js';
import { COMMERCIAL_THRESHOLDS, COMMERCIAL_THRESHOLDS_VERSION } from './commercial.js';
import { EMPLOYMENT_THRESHOLDS, EMPLOYMENT_THRESHOLDS_VERSION } from './employment.js';
import { PRIVACY_THRESHOLDS, PRIVACY_THRESHOLDS_VERSION } from './privacy.js';
import { LITIGATION_THRESHOLDS, LITIGATION_THRESHOLDS_VERSION } from './litigation.js';
import { IP_THRESHOLDS, IP_THRESHOLDS_VERSION } from './ip.js';
import { CORPORATE_THRESHOLDS, CORPORATE_THRESHOLDS_VERSION } from './corporate.js';
import { REGULATORY_THRESHOLDS, REGULATORY_THRESHOLDS_VERSION } from './regulatory.js';
import { REAL_ESTATE_THRESHOLDS, REAL_ESTATE_THRESHOLDS_VERSION } from './real_estate.js';

// PRD §7.5. Phase 1 shipped three checklists; PR5 adds the remaining
// five so every practice area in the triage enum has a curated list.
// `other` remains an empty stub — Stage 0 still runs but produces no
// findings.

export interface ThresholdChecklist {
  practiceArea: PracticeArea;
  version: string;
  items: ThresholdItem[];
}

const EMPTY: ThresholdItem[] = [];

export const THRESHOLD_CHECKLISTS: Record<PracticeArea, ThresholdChecklist> = {
  commercial: {
    practiceArea: 'commercial',
    version: COMMERCIAL_THRESHOLDS_VERSION,
    items: COMMERCIAL_THRESHOLDS,
  },
  employment: {
    practiceArea: 'employment',
    version: EMPLOYMENT_THRESHOLDS_VERSION,
    items: EMPLOYMENT_THRESHOLDS,
  },
  privacy: {
    practiceArea: 'privacy',
    version: PRIVACY_THRESHOLDS_VERSION,
    items: PRIVACY_THRESHOLDS,
  },
  litigation: {
    practiceArea: 'litigation',
    version: LITIGATION_THRESHOLDS_VERSION,
    items: LITIGATION_THRESHOLDS,
  },
  ip: { practiceArea: 'ip', version: IP_THRESHOLDS_VERSION, items: IP_THRESHOLDS },
  corporate: {
    practiceArea: 'corporate',
    version: CORPORATE_THRESHOLDS_VERSION,
    items: CORPORATE_THRESHOLDS,
  },
  regulatory: {
    practiceArea: 'regulatory',
    version: REGULATORY_THRESHOLDS_VERSION,
    items: REGULATORY_THRESHOLDS,
  },
  real_estate: {
    practiceArea: 'real_estate',
    version: REAL_ESTATE_THRESHOLDS_VERSION,
    items: REAL_ESTATE_THRESHOLDS,
  },
  other: { practiceArea: 'other', version: '0.0.0', items: EMPTY },
};

export function getThresholdChecklist(area: PracticeArea): ThresholdChecklist {
  return THRESHOLD_CHECKLISTS[area];
}

export {
  EMPLOYMENT_THRESHOLDS,
  EMPLOYMENT_THRESHOLDS_VERSION,
  COMMERCIAL_THRESHOLDS,
  COMMERCIAL_THRESHOLDS_VERSION,
  PRIVACY_THRESHOLDS,
  PRIVACY_THRESHOLDS_VERSION,
  LITIGATION_THRESHOLDS,
  LITIGATION_THRESHOLDS_VERSION,
  IP_THRESHOLDS,
  IP_THRESHOLDS_VERSION,
  CORPORATE_THRESHOLDS,
  CORPORATE_THRESHOLDS_VERSION,
  REGULATORY_THRESHOLDS,
  REGULATORY_THRESHOLDS_VERSION,
  REAL_ESTATE_THRESHOLDS,
  REAL_ESTATE_THRESHOLDS_VERSION,
};
