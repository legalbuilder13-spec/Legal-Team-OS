// PRD §12.1 + how-lawyers-think Part VI §6.9 — per-practice-area
// inventory templates. Pre-loaded as candidate nodes when the matter
// matches the practice area; the deconstruct skill prunes irrelevant
// items and builds the tree.

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
}

export interface PracticeAreaInventory {
  practiceArea: string;
  version: string;
  items: InventoryItem[];
}
