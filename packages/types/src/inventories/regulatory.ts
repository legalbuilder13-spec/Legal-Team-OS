// PR-B follow-up — first-pass annotations added 2026-05-16; attorney review required.
import type { InventoryItem } from './types.js';

// PRD §12.1 — regulatory inventory. Covers the most common federal +
// state regulatory regimes encountered by in-house teams across
// industries (excluding the industry-specific layer, which lives in
// per-organization domain config).

export const REGULATORY_INVENTORY_VERSION = '1.1.0';

export const REGULATORY_INVENTORY: InventoryItem[] = [
  // Federal regulatory frameworks
  {
    id: 'apa_review',
    category: 'federal_statutes',
    label: 'APA judicial review',
    description: '5 U.S.C. § 706. Arbitrary + capricious; substantial evidence; abuse of discretion. Post-Loper Bright de novo on statutory interpretation.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'appeal',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'major_questions_doctrine',
    category: 'federal_statutes',
    label: 'Major questions doctrine',
    description: 'West Virginia v. EPA / Biden v. Nebraska. Vast-economic-and-political-significance assertions require clear statutory authorization.',
    annotations: {
      nodeType: 'standard',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'appeal',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'rulemaking_notice_comment',
    category: 'federal_statutes',
    label: 'Notice + comment rulemaking',
    description: 'APA § 553. Logical-outgrowth doctrine, interim final rules, good-cause exceptions.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'fda_pma_510k',
    category: 'federal_statutes',
    label: 'FDA premarket pathways',
    description: '510(k) substantial equivalence vs. PMA vs. De Novo. Class I/II/III device classification. Drug NDA + 505(b)(2).',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'ftc_uda',
    category: 'federal_statutes',
    label: 'FTC unfair / deceptive practices',
    description: 'FTC Act § 5. Deception + materiality; unfairness three-factor test. Substantiation requirements.',
    annotations: {
      nodeType: 'standard',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'consumer_financial_protection',
    category: 'federal_statutes',
    label: 'CFPB / consumer financial regulation',
    description: 'UDAAP enforcement, RESPA/TILA/EFTA/FDCPA compliance. Recent agency-funding-structure ruling.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'sec_enforcement',
    category: 'federal_statutes',
    label: 'SEC enforcement',
    description: 'Wells notice process, neither-admit-nor-deny settlements, follow-on disqualifications, individual liability.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'doj_corporate_enforcement',
    category: 'federal_statutes',
    label: 'DOJ corporate enforcement',
    description: 'Updated DAG memo on monitorships + voluntary disclosure. Corporate enforcement policy + cooperation credit.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'beyond_reasonable_doubt',
      defaultPosture: 'pre_suit',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  {
    id: 'cma_export_controls',
    category: 'federal_statutes',
    label: 'Export controls (EAR / ITAR)',
    description: 'Commerce + State Department licensing. Entity List + foreign-direct-product rule. Deemed exports.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'ofac_sanctions',
    category: 'federal_statutes',
    label: 'OFAC sanctions',
    description: 'SDN List + country programs + sectoral sanctions. 50% rule for owned-by entities. Voluntary self-disclosure framework.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  // Cross-cutting compliance
  {
    id: 'whistleblower_programs',
    category: 'federal_statutes',
    label: 'Whistleblower / bounty programs',
    description: 'SEC + CFTC + DOJ kleptocracy + FinCEN whistleblower programs. Anti-retaliation provisions.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  {
    id: 'agency_subpoena_response',
    category: 'procedural',
    label: 'Agency subpoena / CID response',
    description: 'Scope objections, privilege, work-product, joint-defense privilege, Fifth Amendment (individuals).',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'pre_suit',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  {
    id: 'consent_decree',
    category: 'remedies_defenses',
    label: 'Consent decree / consent order',
    description: 'Negotiated injunctive terms, compliance monitor, reporting obligations, termination provisions.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  {
    id: 'civil_penalty_calculation',
    category: 'remedies_defenses',
    label: 'Civil penalty calculation',
    description: 'Per-violation vs. continuing-violation; aggregation; inflation adjustment; ability-to-pay considerations.',
    annotations: {
      nodeType: 'factor',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  // State regulators
  {
    id: 'state_ag_enforcement',
    category: 'state_statutes',
    label: 'State AG enforcement',
    description: 'State UDAP statutes (e.g., CA UCL § 17200, NY GBL § 349, MA Ch. 93A). Parens patriae. Multistate AG actions.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'preponderance',
      defaultPosture: 'pleadings',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'state_licensing_boards',
    category: 'state_statutes',
    label: 'State licensing boards',
    description: 'Healthcare boards, financial-services regulators, professional-licensure boards. Fitness-to-practice + disciplinary process.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'clear_and_convincing',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
  // Industry-specific (high-level)
  {
    id: 'environmental_compliance',
    category: 'federal_statutes',
    label: 'Environmental compliance',
    description: 'CAA, CWA, RCRA, CERCLA, TSCA. EPA enforcement + state delegated programs.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'arbitrary_and_capricious',
    },
  },
  {
    id: 'osha',
    category: 'federal_statutes',
    label: 'OSHA',
    description: 'General duty clause + specific standards. Multi-employer worksite. Whistleblower (§ 11(c)).',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'agency',
      standardOfProof: 'substantial_evidence',
      defaultPosture: 'agency_proceeding',
      appellateStandardOfReview: 'substantial_evidence',
    },
  },
];
