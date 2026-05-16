// PR-8 — registry of doctrinally contested decomposition areas per
// how-lawyers-think Part VI §6.12 D11. When the deconstruct tree
// touches a contested doctrine, the skill must produce two trees
// side-by-side (under each named frame) rather than silently picking
// one. The Goldberg/Zipursky lesson made operational: a wrong
// decomposition frame quietly poisons every downstream node.

export interface ContestedDoctrine {
  id: string;
  label: string;
  // Two or more competing decomposition frames. The skill emits a
  // tree under each + a frame_choice_required: true flag; the UI
  // surfaces both for the lawyer to pick.
  frames: string[];
  practiceAreas: string[];
  canonicalSource: string;
  triggerKeywords: string[];
}

export const CONTESTED_DOCTRINES: ContestedDoctrine[] = [
  {
    id: 'torts_duty',
    label: 'Negligence — duty as filter vs. flattened foreseeability',
    frames: [
      'restatement_third_duty_as_filter',
      'restatement_second_foreseeability_first',
    ],
    practiceAreas: ['litigation', 'ip', 'real_estate'],
    canonicalSource: 'Goldberg & Zipursky, Recognizing Wrongs (Harvard 2020)',
    triggerKeywords: ['duty', 'foreseeability', 'negligence', 'reasonable person'],
  },
  {
    id: 'due_process_tiers',
    label: 'Procedural due process — balancing vs. categorical',
    frames: [
      'mathews_eldridge_balancing',
      'medina_categorical_minimum_required',
    ],
    practiceAreas: ['litigation', 'regulatory'],
    canonicalSource: 'Mathews v. Eldridge, 424 U.S. 319 (1976); Medina v. California',
    triggerKeywords: ['due process', 'procedural', 'pre-deprivation', 'hearing'],
  },
  {
    id: 'antitrust_rule_of_reason',
    label: 'Antitrust — structured rule of reason vs. quick look vs. per se',
    frames: [
      'structured_rule_of_reason_three_step',
      'quick_look_abbreviated',
      'per_se_categorical',
    ],
    practiceAreas: ['commercial', 'regulatory'],
    canonicalSource: 'NCAA v. Alston, 594 U.S. 69 (2021); California Dental v. FTC',
    triggerKeywords: ['antitrust', 'restraint of trade', 'sherman act', 'price-fixing'],
  },
  {
    id: 'takings_analysis',
    label: 'Takings — Penn Central balancing vs. Lucas categorical vs. Cedar Point per se',
    frames: [
      'penn_central_three_factors',
      'lucas_total_deprivation_categorical',
      'cedar_point_physical_invasion_per_se',
    ],
    practiceAreas: ['real_estate', 'regulatory'],
    canonicalSource: 'Penn Central; Lucas v. South Carolina; Cedar Point Nursery v. Hassid',
    triggerKeywords: ['taking', 'regulatory taking', 'just compensation', 'inverse condemnation'],
  },
  {
    id: 'employment_at_will_carveouts',
    label: 'At-will employment — public-policy exception vs. implied-contract vs. covenant',
    frames: [
      'public_policy_exception_only',
      'implied_in_fact_contract_recognized',
      'good_faith_covenant_recognized',
    ],
    practiceAreas: ['employment'],
    canonicalSource: 'Wrongful Termination treatise; Tameny v. Atlantic Richfield',
    triggerKeywords: ['at-will', 'wrongful termination', 'public policy', 'good faith covenant'],
  },
  {
    id: 'fair_use_factors',
    label: 'Fair use — Campbell transformativeness vs. Warhol commercial substitution',
    frames: [
      'campbell_transformativeness_dominant',
      'warhol_commercial_substitution_centered',
    ],
    practiceAreas: ['ip'],
    canonicalSource: 'Campbell v. Acuff-Rose Music; Andy Warhol Found. v. Goldsmith',
    triggerKeywords: ['fair use', 'transformative', 'derivative', 'copyright defense'],
  },
];

export function contestedDoctrinesForPracticeArea(area: string): ContestedDoctrine[] {
  return CONTESTED_DOCTRINES.filter((d) => d.practiceAreas.includes(area));
}
