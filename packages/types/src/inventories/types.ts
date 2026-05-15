// PRD §12.1 + how-lawyers-think Part VI §6.9 — per-practice-area
// inventory templates. Pre-loaded as candidate nodes when the matter
// matches the practice area; the deconstruct skill prunes irrelevant
// items and builds the tree.

// PR-B — per-leaf annotations per how-lawyers-think Part VI §D6.
// Every operational target carries burden allocations, standard of
// proof, default procedural posture, and the appellate standard of
// review. Optional because not every inventory item is a litigable
// claim (some are pure data classification or procedural reminders).
// When omitted, the deconstruct skill assumes Schaffer v. Weast default
// allocation (proponent bears burden; preponderance unless statute
// specifies otherwise).

export type BurdenAllocation =
  | 'plaintiff'
  | 'defendant'
  | 'movant'
  | 'non_movant'
  | 'agency'
  | 'split'
  | 'shifting';

export type StandardOfProof =
  | 'preponderance'
  | 'clear_and_convincing'
  | 'beyond_reasonable_doubt'
  | 'substantial_evidence';

export type ProceduralPosture =
  | 'pre_suit'
  | 'pleadings'
  | 'motion_to_dismiss'
  | 'discovery'
  | 'summary_judgment'
  | 'trial'
  | 'jmol'
  | 'appeal'
  | 'agency_proceeding';

export type AppellateReview =
  | 'de_novo'
  | 'clear_error'
  | 'abuse_of_discretion'
  | 'substantial_evidence'
  | 'arbitrary_and_capricious';

export type InventoryNodeType =
  | 'rule'
  | 'standard'
  | 'factor'
  | 'right'
  | 'evidence'
  | 'threshold'
  | 'classification'
  | 'procedural';

export interface InventoryItemAnnotations {
  nodeType?: InventoryNodeType;
  burdenOfProduction?: BurdenAllocation;
  burdenOfPersuasion?: BurdenAllocation;
  standardOfProof?: StandardOfProof;
  defaultPosture?: ProceduralPosture;
  appellateStandardOfReview?: AppellateReview;
  // When true, Schaffer v. Weast default allocation applies (the
  // proponent of the issue bears the burden). Default true when burdens
  // are unspecified.
  schafferDefault?: boolean;
}

export interface InventoryItem {
  id: string;
  // Top-level grouping shown in the deconstruction tree as a parent
  // node. The skill expands/prunes children under each category.
  category:
    | 'federal_statutes'
    | 'state_statutes'
    | 'local_ordinances'
    | 'common_law'
    | 'restrictive_covenants'
    | 'collateral_consequences'
    | 'contract_clauses'
    | 'remedies_defenses'
    | 'procedural'
    | 'data_categories'
    | 'cross_border'
    | 'breach_response';
  label: string;
  description: string;
  docAnchor?: string;
  // PR-B — operational annotations. Optional during the rollout; the
  // deconstruct skill defaults to Schaffer-allocation reasoning when
  // unspecified. Annotation coverage per practice area is tracked as
  // a launch-gate metric (see analysis-metrics router).
  annotations?: InventoryItemAnnotations;
}

export interface PracticeAreaInventory {
  practiceArea: string;
  version: string;
  items: InventoryItem[];
}
