import type { InventoryItem } from './types.js';

// PRD §12.1 — real estate inventory. Covers title + transfer +
// development + financing + leasing.

export const REAL_ESTATE_INVENTORY_VERSION = '1.0.0';

export const REAL_ESTATE_INVENTORY: InventoryItem[] = [
  // Title + ownership
  {
    id: 'fee_simple_vs_lesser',
    category: 'common_law',
    label: 'Estate type',
    description: 'Fee simple absolute vs. defeasible (determinable, condition subsequent) vs. life estate vs. leasehold.',
  },
  {
    id: 'cotenancy',
    category: 'common_law',
    label: 'Cotenancy',
    description: 'Joint tenancy w/ROS, tenancy in common, tenancy by the entirety. Partition rights.',
  },
  {
    id: 'easements',
    category: 'common_law',
    label: 'Easements',
    description: 'By grant, prescription, necessity, implication. Appurtenant vs. in gross. Recorded vs. unrecorded.',
  },
  {
    id: 'restrictive_covenants',
    category: 'common_law',
    label: 'Restrictive covenants / equitable servitudes',
    description: 'Touch + concern + intent + notice. Race / discriminatory covenants unenforceable.',
  },
  {
    id: 'adverse_possession',
    category: 'common_law',
    label: 'Adverse possession',
    description: 'Open + notorious + continuous + hostile + exclusive for statutory period.',
  },
  // Transfer documents
  {
    id: 'purchase_sale_agreement',
    category: 'contract_clauses',
    label: 'Purchase + sale agreement',
    description: 'Earnest money, due-diligence period, financing contingency, inspection, title objections, closing date, default remedies.',
  },
  {
    id: 'deed_types',
    category: 'contract_clauses',
    label: 'Deed types',
    description: 'General warranty, special warranty, bargain + sale, quitclaim. Statutory deed forms vary by state.',
  },
  {
    id: 'title_insurance',
    category: 'contract_clauses',
    label: 'Title insurance',
    description: 'Owner\'s vs. lender\'s. Exceptions (survey, easement, encroachment, mineral). ALTA endorsements.',
  },
  // Financing
  {
    id: 'mortgage_security',
    category: 'contract_clauses',
    label: 'Mortgage / deed of trust',
    description: 'Lien vs. title theory state. Power of sale. Subordination, non-disturbance, attornment (SNDA).',
  },
  {
    id: 'commercial_loan_covenants',
    category: 'contract_clauses',
    label: 'Commercial loan covenants',
    description: 'DSCR, LTV, debt yield, cash management, recourse + bad-boy carve-outs (springing guaranty).',
  },
  {
    id: 'mezzanine_intercreditor',
    category: 'contract_clauses',
    label: 'Mezzanine + intercreditor',
    description: 'Pledge of equity in property-owning entity. UCC Article 9 foreclosure mechanics. Intercreditor priorities.',
  },
  // Leasing
  {
    id: 'commercial_lease',
    category: 'contract_clauses',
    label: 'Commercial lease',
    description: 'Triple-net vs. modified-gross vs. full-service. OpEx / CAM, audit rights. Renewal options.',
  },
  {
    id: 'subordination_snda',
    category: 'contract_clauses',
    label: 'SNDA',
    description: 'Subordination, non-disturbance, attornment between tenant + lender. Survives foreclosure.',
  },
  {
    id: 'use_exclusivity',
    category: 'contract_clauses',
    label: 'Use + exclusivity',
    description: 'Permitted use, prohibited use, exclusive (in retail), co-tenancy. Continuous-operation covenant.',
  },
  {
    id: 'assignment_subletting',
    category: 'contract_clauses',
    label: 'Assignment + subletting',
    description: 'Consent standards (reasonable / sole discretion / objective tests), recapture, profit-share.',
  },
  // Land use + environmental
  {
    id: 'zoning_entitlement',
    category: 'local_ordinances',
    label: 'Zoning + entitlement',
    description: 'Permitted, special permit, variance, PUD. Nonconforming use grandfathering. Vested-rights doctrine.',
  },
  {
    id: 'environmental_phase_1',
    category: 'federal_statutes',
    label: 'Environmental due diligence',
    description: 'Phase I ESA per ASTM E1527. Recognized environmental conditions (RECs). CERCLA innocent-landowner defense.',
  },
  {
    id: 'wetlands_endangered_species',
    category: 'federal_statutes',
    label: 'Wetlands / endangered species',
    description: '404 permitting (Sackett v. EPA scope). ESA Section 7 + 9 prohibitions on take.',
  },
  // Tenant protections + fair housing
  {
    id: 'fair_housing_act',
    category: 'federal_statutes',
    label: 'Fair Housing Act',
    description: 'Protected classes; disparate impact (Inclusive Communities) + intent. Reasonable accommodation.',
  },
  {
    id: 'rent_regulation',
    category: 'state_statutes',
    label: 'Rent regulation',
    description: 'NYC rent stabilization, CA AB 1482, OR state-wide cap. Vacancy decontrol vs. continuing stabilization.',
  },
  {
    id: 'eviction',
    category: 'state_statutes',
    label: 'Eviction process',
    description: 'Notice + grounds + court process. Anti-retaliation. Just-cause-eviction ordinances (multiple cities).',
  },
  // Transfer + tax
  {
    id: 'transfer_tax',
    category: 'state_statutes',
    label: 'Transfer + recording taxes',
    description: 'State transfer tax / doc stamps. NY mortgage recording tax. Mansion tax thresholds. Controlling-interest transfer tax.',
  },
  {
    id: 'firpta',
    category: 'federal_statutes',
    label: 'FIRPTA withholding',
    description: '15% (or 10% with certificate) withholding on disposition by foreign person. Substitute reporting / withholding certificate.',
  },
  {
    id: 'opportunity_zones',
    category: 'federal_statutes',
    label: 'Opportunity zone investments',
    description: 'QOZ-Fund + QOZ-Business structure. Substantial-improvement test for existing buildings. Deferral + step-up + exclusion.',
  },
];
