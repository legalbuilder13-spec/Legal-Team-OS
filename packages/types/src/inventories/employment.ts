import type { InventoryItem } from './types.js';

// PRD §12.1 / how-lawyers-think Part VI §6.9 — employment inventory.
// The "Can I fire this employee?" compound-question example from the
// doc, generalized so any employment matter (termination, leave,
// classification, harassment, wage-hour) is covered.

export const EMPLOYMENT_INVENTORY_VERSION = '1.0.0';

export const EMPLOYMENT_INVENTORY: InventoryItem[] = [
  // Federal statutes
  {
    id: 'title_vii',
    category: 'federal_statutes',
    label: 'Title VII',
    description:
      'Race, color, religion, sex (including SO/GI per Bostock), national origin discrimination. Title VII of the Civil Rights Act of 1964.',
  },
  {
    id: 'ada',
    category: 'federal_statutes',
    label: 'ADA',
    description: 'Americans with Disabilities Act — disability discrimination + reasonable accommodation.',
  },
  {
    id: 'adea',
    category: 'federal_statutes',
    label: 'ADEA',
    description: 'Age Discrimination in Employment Act — age 40+ protected class.',
  },
  {
    id: 'fmla',
    category: 'federal_statutes',
    label: 'FMLA',
    description: 'Family and Medical Leave Act — interference + retaliation; 12-week unpaid leave.',
  },
  {
    id: 'usefra',
    category: 'federal_statutes',
    label: 'USERRA',
    description: 'Uniformed Services Employment and Reemployment Rights Act — military leave.',
  },
  {
    id: 'epa',
    category: 'federal_statutes',
    label: 'Equal Pay Act',
    description: 'Sex-based wage discrimination for substantially equal work.',
  },
  {
    id: 'nlra',
    category: 'federal_statutes',
    label: 'NLRA §7',
    description:
      'Protected concerted activity — applies in non-union workplaces too. Section 7 covers group complaints about wages/conditions.',
  },
  {
    id: 'flsa_retaliation',
    category: 'federal_statutes',
    label: 'FLSA retaliation',
    description: 'Anti-retaliation for wage/hour complaints under FLSA §215(a)(3).',
  },
  {
    id: 'sox_whistleblower',
    category: 'federal_statutes',
    label: 'SOX / Dodd-Frank whistleblower',
    description: 'Whistleblower protections for public-company employees + financial-services workers.',
  },
  {
    id: 'gina',
    category: 'federal_statutes',
    label: 'GINA',
    description: 'Genetic Information Nondiscrimination Act.',
  },
  // State statutes
  {
    id: 'state_fepa',
    category: 'state_statutes',
    label: 'State FEPA equivalent',
    description:
      'State fair-employment-practices act (e.g., FEHA in CA, NYSHRL in NY, IHRA in IL). Often broader protected classes than Title VII; lower employee-size thresholds.',
  },
  {
    id: 'state_warn',
    category: 'state_statutes',
    label: 'State WARN Act',
    description:
      'State plant-closing / mass-layoff notice acts. Several states have notice thresholds lower than federal WARN (60 days).',
  },
  {
    id: 'state_leave_acts',
    category: 'state_statutes',
    label: 'State leave acts',
    description: 'State family-leave (CFRA, NY PFL), state paid sick leave, state pregnancy accommodation.',
  },
  {
    id: 'state_whistleblower',
    category: 'state_statutes',
    label: 'State whistleblower',
    description: 'State whistleblower statutes — often broader than federal.',
  },
  // Local
  {
    id: 'local_human_rights',
    category: 'local_ordinances',
    label: 'Local human rights laws',
    description: 'NYC HRL, Cook County HRO, Philadelphia FPA, etc. Often the most protective.',
  },
  // Common law
  {
    id: 'wrongful_discharge_public_policy',
    category: 'common_law',
    label: 'Wrongful discharge in violation of public policy',
    description: 'Common-law claim where termination violates an articulated public policy.',
  },
  {
    id: 'implied_contract_handbook',
    category: 'common_law',
    label: 'Implied contract / handbook',
    description: 'Employee handbook or course-of-dealing may create implied contract limiting at-will termination.',
  },
  {
    id: 'iied',
    category: 'common_law',
    label: 'IIED',
    description: 'Intentional infliction of emotional distress — extreme/outrageous conduct.',
  },
  {
    id: 'defamation',
    category: 'common_law',
    label: 'Defamation',
    description: 'Statements made in references or to third parties; per-se vs. per quod; qualified privilege.',
  },
  {
    id: 'tortious_interference',
    category: 'common_law',
    label: 'Tortious interference',
    description: 'Interference with prospective contractual relations (next employer).',
  },
  {
    id: 'invasion_of_privacy',
    category: 'common_law',
    label: 'Invasion of privacy',
    description: 'Intrusion upon seclusion, public disclosure of private facts, false light.',
  },
  // Restrictive covenants
  {
    id: 'non_compete',
    category: 'restrictive_covenants',
    label: 'Non-compete',
    description:
      'Enforceability varies sharply by state (CA: void; FL: enforceable; etc.). FTC rule status is in flux.',
  },
  {
    id: 'non_solicit',
    category: 'restrictive_covenants',
    label: 'Non-solicit',
    description: 'Customer-non-solicit and employee-non-solicit — generally enforced more broadly than non-competes.',
  },
  {
    id: 'nda',
    category: 'restrictive_covenants',
    label: 'NDA / confidentiality',
    description: 'Trade-secret + confidential-information protections; SOX whistleblower preemption concerns.',
  },
  {
    id: 'garden_leave',
    category: 'restrictive_covenants',
    label: 'Garden leave',
    description: 'Paid notice period as alternative or supplement to non-compete.',
  },
  // Severance & release
  {
    id: 'owbpa',
    category: 'collateral_consequences',
    label: 'OWBPA (ADEA waivers)',
    description: 'Older Workers Benefit Protection Act — 21/45-day consideration, 7-day revocation for ADEA waivers.',
  },
  {
    id: 'cal_1542',
    category: 'collateral_consequences',
    label: 'Cal. Civ. Code § 1542',
    description: 'California general-release statute — requires explicit waiver of unknown claims.',
  },
  // Collateral consequences
  {
    id: 'unemployment',
    category: 'collateral_consequences',
    label: 'Unemployment insurance',
    description: 'Misconduct vs. lack-of-work classification affects benefits + employer rate.',
  },
  {
    id: 'cobra',
    category: 'collateral_consequences',
    label: 'COBRA',
    description: 'Continuation of group health coverage — notice requirements + 60-day election period.',
  },
  {
    id: 'erisa_510',
    category: 'collateral_consequences',
    label: 'ERISA §510',
    description: 'Benefits-interference claim — termination to prevent benefits vesting.',
  },
  {
    id: 'workers_comp_retaliation',
    category: 'collateral_consequences',
    label: 'Workers comp retaliation',
    description: 'Most states prohibit retaliation for workers-comp claims.',
  },
  {
    id: 'immigration',
    category: 'collateral_consequences',
    label: 'Immigration',
    description: 'E-Verify, visa sponsorship, post-termination grace periods (typically 60 days for H-1B).',
  },
  {
    id: 'equity',
    category: 'collateral_consequences',
    label: 'Equity vesting / clawback',
    description: 'Acceleration triggers, post-termination exercise windows, clawback provisions.',
  },
];
