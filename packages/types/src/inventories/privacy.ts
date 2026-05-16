// PR-B follow-up — first-pass annotations added 2026-05-16; attorney review required.
import type { InventoryItem } from './types.js';

// PRD §12.1 — privacy / data-protection inventory. Covers federal
// sectoral regimes, state comprehensive laws, EU/UK regimes, breach
// response, and cross-border transfer mechanisms.

export const PRIVACY_INVENTORY_VERSION = '1.1.0';

export const PRIVACY_INVENTORY: InventoryItem[] = [
  // Federal sectoral
  {
    id: 'hipaa',
    category: 'federal_statutes',
    label: 'HIPAA',
    description: 'Privacy + Security Rule for PHI; covered entities, business associates, breach notification.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'glba',
    category: 'federal_statutes',
    label: 'GLBA',
    description: 'Financial-institution privacy + safeguards; FTC + functional-regulator enforcement.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'fcra',
    category: 'federal_statutes',
    label: 'FCRA',
    description: 'Consumer reporting agencies, furnishers, users; permissible purposes, dispute procedures.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'ferpa',
    category: 'federal_statutes',
    label: 'FERPA',
    description: 'Education records of students; covered entities are schools receiving federal funds.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'coppa',
    category: 'federal_statutes',
    label: 'COPPA',
    description: 'Children under 13; verifiable parental consent.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'can_spam',
    category: 'federal_statutes',
    label: 'CAN-SPAM + TCPA',
    description: 'Commercial email opt-out; TCPA consent for autodialed/prerecorded calls + texts.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // State comprehensive privacy
  {
    id: 'ccpa_cpra',
    category: 'state_statutes',
    label: 'CCPA / CPRA',
    description: 'California Consumer Privacy Act + CPRA amendments; rights, sale/share, sensitive PI.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'state_comprehensive',
    category: 'state_statutes',
    label: 'Other state comprehensive laws',
    description:
      'VA (VCDPA), CO (CPA), CT (CTDPA), UT (UCPA), TX (TDPSA), OR (OCPA), MT, IA, DE, NH, NE, etc. — applicability thresholds + carve-outs vary.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'biometric',
    category: 'state_statutes',
    label: 'Biometric privacy (BIPA, etc.)',
    description: 'IL BIPA (private right of action + statutory damages), TX, WA biometric laws.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // Cross-border
  {
    id: 'gdpr',
    category: 'cross_border',
    label: 'GDPR',
    description: 'EU + EEA personal data; legal bases, data subject rights, accountability, DPIA, DPO.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'uk_gdpr_dpa',
    category: 'cross_border',
    label: 'UK GDPR + DPA 2018',
    description: 'Post-Brexit UK regime; mostly parallel to EU GDPR with divergence on enforcement.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'transfer_mechanism',
    category: 'cross_border',
    label: 'Cross-border transfer mechanism',
    description: 'SCCs, adequacy decisions, BCRs, Data Privacy Framework (US/EU/UK/Swiss).',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'pre_suit',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // Breach response
  {
    id: 'state_breach_notification',
    category: 'breach_response',
    label: 'State breach-notification laws',
    description: 'All 50 states + DC; thresholds, AG/individual notice timelines, content requirements.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'hipaa_breach_notification',
    category: 'breach_response',
    label: 'HIPAA breach notification',
    description: 'Without-undue-delay (≤60 days), HHS reporting, media notice if >500 in jurisdiction.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'gdpr_breach_notification',
    category: 'breach_response',
    label: 'GDPR breach notification',
    description: '72-hour supervisory authority notification + data subject notice if high risk.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  // Data categories
  {
    id: 'sensitive_data',
    category: 'data_categories',
    label: 'Sensitive data',
    description: 'Health, financial, government ID, geolocation, biometric, sexual orientation, immigration status.',
    annotations: {
      nodeType: 'classification',
    },
  },
  {
    id: 'dsr',
    category: 'data_categories',
    label: 'Data subject rights (DSR)',
    description: 'Access, deletion, correction, portability, opt-out of sale/share/targeted ads.',
    annotations: {
      nodeType: 'right',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
];
