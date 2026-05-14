import type { PracticeArea } from '../index.js';
import type { ThresholdItem } from '../analysis.js';
import { COMMERCIAL_THRESHOLDS, COMMERCIAL_THRESHOLDS_VERSION } from './commercial.js';
import { EMPLOYMENT_THRESHOLDS, EMPLOYMENT_THRESHOLDS_VERSION } from './employment.js';
import { PRIVACY_THRESHOLDS, PRIVACY_THRESHOLDS_VERSION } from './privacy.js';

// PRD §7.5 + §19.1. Phase 1 ships checklists for the three highest-volume
// practice areas. Other practice areas get an empty checklist for now; the
// pipeline still runs Stage 0 with no findings and continues to Stage 1.
// Phase 2+ adds litigation, ip, corporate, regulatory, real_estate.

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
  litigation: { practiceArea: 'litigation', version: '0.0.0', items: EMPTY },
  ip: { practiceArea: 'ip', version: '0.0.0', items: EMPTY },
  corporate: { practiceArea: 'corporate', version: '0.0.0', items: EMPTY },
  regulatory: { practiceArea: 'regulatory', version: '0.0.0', items: EMPTY },
  real_estate: { practiceArea: 'real_estate', version: '0.0.0', items: EMPTY },
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
};
