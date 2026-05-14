import type { InventoryItem } from './types.js';

// PRD §12.1 — corporate inventory. Covers entity governance,
// fiduciary duties, financing, M&A, and securities.

export const CORPORATE_INVENTORY_VERSION = '1.0.0';

export const CORPORATE_INVENTORY: InventoryItem[] = [
  // Governance
  {
    id: 'business_judgment_rule',
    category: 'common_law',
    label: 'Business judgment rule',
    description: 'Presumption of valid board action absent breach of duty of care or loyalty.',
  },
  {
    id: 'duty_of_loyalty',
    category: 'common_law',
    label: 'Duty of loyalty',
    description: 'Self-dealing, interested transactions, corporate opportunity doctrine. Entire fairness when implicated.',
  },
  {
    id: 'duty_of_care',
    category: 'common_law',
    label: 'Duty of care',
    description: 'Informed, deliberate decision-making. Caremark oversight duty.',
  },
  {
    id: 'enhanced_scrutiny',
    category: 'common_law',
    label: 'Enhanced scrutiny (Revlon / Unocal / Blasius)',
    description: 'Revlon (sale of control), Unocal (defensive measures), Blasius (interference with vote).',
  },
  {
    id: 'controlling_stockholder',
    category: 'common_law',
    label: 'Controlling stockholder transactions',
    description: 'Entire-fairness default; MFW cleansing (independent committee + majority-of-minority + uncoerced).',
  },
  {
    id: 'caremark_oversight',
    category: 'common_law',
    label: 'Caremark oversight',
    description: 'Board failure to implement information + reporting system, or to monitor red flags.',
  },
  // Capital structure + financing
  {
    id: 'capital_structure',
    category: 'contract_clauses',
    label: 'Capital structure',
    description: 'Authorized + issued + outstanding; par; liquidation prefs; conversion; antidilution (full ratchet, weighted average).',
  },
  {
    id: 'preemptive_rights',
    category: 'contract_clauses',
    label: 'Preemptive rights / ROFR',
    description: 'Charter or stockholder-agreement rights triggered by issuances or transfers.',
  },
  {
    id: 'voting_agreements',
    category: 'contract_clauses',
    label: 'Voting + drag-along + tag-along',
    description: 'Drag-along thresholds + scope of bound stockholders. Tag-along protective for minority.',
  },
  {
    id: 'protective_provisions',
    category: 'contract_clauses',
    label: 'Protective provisions',
    description: 'Preferred-class consent for specified actions (amendment, sale, dividend, debt).',
  },
  {
    id: 'information_rights',
    category: 'contract_clauses',
    label: 'Information + inspection rights',
    description: 'Major-investor information rights; DGCL § 220 books-and-records demand.',
  },
  // Securities
  {
    id: 'reg_d_506',
    category: 'federal_statutes',
    label: 'Reg D 506(b) / 506(c)',
    description: 'Accredited investor exemption from § 5 registration. 506(b) (no general solicitation); 506(c) (general solicitation with verified accreditation).',
  },
  {
    id: 'reg_s',
    category: 'federal_statutes',
    label: 'Reg S (offshore)',
    description: 'Offshore offering exemption. Distribution compliance period + flow-back risk.',
  },
  {
    id: 'rule_144',
    category: 'federal_statutes',
    label: 'Rule 144 resale',
    description: 'Resale of restricted securities. Holding period (6 months / 1 year), volume + manner-of-sale limits for affiliates.',
  },
  {
    id: 'section_10b5',
    category: 'federal_statutes',
    label: 'Rule 10b-5 / fraud',
    description: 'Material misstatement or omission + scienter + reliance + loss causation + damages. Insider-trading liability.',
  },
  {
    id: 'section_16',
    category: 'federal_statutes',
    label: 'Section 16 (insiders)',
    description: 'Form 3/4/5 filings + short-swing-profit disgorgement for officers, directors, 10%+ holders.',
  },
  // M&A
  {
    id: 'merger_consideration',
    category: 'contract_clauses',
    label: 'Merger consideration',
    description: 'Cash, stock, mixed. Collar, lock-up, contingent value rights. Earnouts + working-capital adjustments.',
  },
  {
    id: 'reps_warranties',
    category: 'contract_clauses',
    label: 'Reps + warranties + indemnity',
    description: 'Fundamental vs. non-fundamental reps. Survival, caps, baskets, materiality scrapes. RWI insurance.',
  },
  {
    id: 'mac_clause',
    category: 'contract_clauses',
    label: 'MAC / MAE clause',
    description: 'Material-adverse-effect/change definition + carve-outs (industry-wide, market). Akorn / Channel Medsystems analysis.',
  },
  {
    id: 'hsr',
    category: 'federal_statutes',
    label: 'HSR + foreign filings',
    description: 'Size-of-transaction + size-of-person thresholds. CFIUS for foreign acquirer + critical-technology / TID businesses.',
  },
  {
    id: 'appraisal_rights',
    category: 'remedies_defenses',
    label: 'Appraisal rights',
    description: 'DGCL § 262. Public-stock exception. Recent Delaware decisions on deal-price as fair-value indicator.',
  },
  // Employee equity
  {
    id: 'iso_nso',
    category: 'contract_clauses',
    label: 'ISO / NSO grants',
    description: 'ISO holding periods (1-year + 2-year), $100K limit. NSO ordinary-income tax at exercise.',
  },
  {
    id: 'section_280g',
    category: 'federal_statutes',
    label: '§ 280G golden parachute',
    description: 'Excess parachute payments + 20% excise tax + corporate deduction loss. Cleansing via 75% shareholder approval.',
  },
];
