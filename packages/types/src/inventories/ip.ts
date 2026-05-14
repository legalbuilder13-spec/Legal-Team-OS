import type { InventoryItem } from './types.js';

// PRD §12.1 — IP inventory. Covers the four IP pillars (patent,
// copyright, trademark, trade secret) plus licensing + open-source +
// contractual IP allocation.

export const IP_INVENTORY_VERSION = '1.0.0';

export const IP_INVENTORY: InventoryItem[] = [
  // Patent
  {
    id: 'patent_infringement',
    category: 'federal_statutes',
    label: 'Patent infringement',
    description: '35 U.S.C. § 271. Literal + doctrine of equivalents. Direct, induced, contributory.',
  },
  {
    id: 'patent_validity_defenses',
    category: 'remedies_defenses',
    label: 'Patent invalidity defenses',
    description: 'Anticipation (§ 102), obviousness (§ 103), § 101 eligibility (Alice/Mayo), § 112 indefiniteness/written description/enablement.',
  },
  {
    id: 'patent_remedies',
    category: 'remedies_defenses',
    label: 'Patent remedies',
    description: 'Lost profits, reasonable royalty (Georgia-Pacific), enhanced damages (Halo), injunctions (eBay v. MercExchange).',
  },
  // Copyright
  {
    id: 'copyright_infringement',
    category: 'federal_statutes',
    label: 'Copyright infringement',
    description: '17 U.S.C. § 501. Ownership + copying + substantial similarity. Striking similarity for access.',
  },
  {
    id: 'copyright_fair_use',
    category: 'remedies_defenses',
    label: 'Fair use',
    description: '§ 107 four factors. Warhol Foundation refinement of transformative use; commercial purpose; market effect.',
  },
  {
    id: 'copyright_dmca',
    category: 'federal_statutes',
    label: 'DMCA',
    description: '§ 512 safe harbor (registered agent, repeat-infringer policy). § 1201 anti-circumvention.',
  },
  {
    id: 'work_for_hire',
    category: 'contract_clauses',
    label: 'Work-for-hire / assignment',
    description: '§ 101 work-for-hire definition; written assignment for non-employees; recordation under § 205.',
  },
  // Trademark
  {
    id: 'trademark_infringement',
    category: 'federal_statutes',
    label: 'Trademark infringement',
    description: 'Lanham § 32 (registered) + § 43(a) (unregistered). Likelihood of confusion (Polaroid / Sleekcraft).',
  },
  {
    id: 'trademark_dilution',
    category: 'federal_statutes',
    label: 'Trademark dilution',
    description: 'Lanham § 43(c). Blurring + tarnishment. Famous-mark predicate.',
  },
  {
    id: 'trademark_first_amendment',
    category: 'remedies_defenses',
    label: 'Trademark First Amendment',
    description: 'Rogers test for expressive use. Jack Daniel\'s v. VIP Products clarifies when Rogers applies.',
  },
  // Trade secret
  {
    id: 'trade_secret_dtsa',
    category: 'federal_statutes',
    label: 'Trade secret (DTSA)',
    description: 'Defend Trade Secrets Act + state UTSA. Reasonable secrecy measures + economic value from secrecy + misappropriation.',
  },
  {
    id: 'inevitable_disclosure',
    category: 'remedies_defenses',
    label: 'Inevitable disclosure doctrine',
    description: 'Whether new employment will inevitably disclose former employer\'s secrets. Varies sharply by state (IL recognizes; CA rejects).',
  },
  // Licensing + contracts
  {
    id: 'license_scope',
    category: 'contract_clauses',
    label: 'License scope',
    description: 'Field of use, territory, exclusivity, sublicense rights, term, termination triggers, post-termination tail.',
  },
  {
    id: 'royalty_structure',
    category: 'contract_clauses',
    label: 'Royalty structure',
    description: 'Running royalty, lump-sum, milestone, minimums. Audit rights. Most-favored-licensee clauses.',
  },
  {
    id: 'open_source',
    category: 'contract_clauses',
    label: 'Open-source compliance',
    description: 'Copyleft (GPL, AGPL) vs. permissive (MIT, Apache). Attribution + notice + source-disclosure obligations.',
  },
  {
    id: 'employee_invention_assignment',
    category: 'contract_clauses',
    label: 'Employee invention assignment',
    description: 'PIIA scope, state-law carve-outs (CA Lab. Code § 2870, WA, IL, etc.) for inventions on own time without employer resources.',
  },
  {
    id: 'derivative_works',
    category: 'contract_clauses',
    label: 'Derivative works + improvements',
    description: 'Who owns improvements; grant-back vs. assignment vs. license. Cross-licensing in joint development.',
  },
];
