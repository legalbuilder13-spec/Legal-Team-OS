// PR-B follow-up — first-pass annotations added 2026-05-16; attorney review required.
import type { InventoryItem } from './types.js';

// PRD §12.1 — IP inventory. Covers the four IP pillars (patent,
// copyright, trademark, trade secret) plus licensing + open-source +
// contractual IP allocation.

export const IP_INVENTORY_VERSION = '1.1.0';

export const IP_INVENTORY: InventoryItem[] = [
  // Patent
  {
    id: 'patent_infringement',
    category: 'federal_statutes',
    label: 'Patent infringement',
    description: '35 U.S.C. § 271. Literal + doctrine of equivalents. Direct, induced, contributory.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'patent_validity_defenses',
    category: 'remedies_defenses',
    label: 'Patent invalidity defenses',
    description: 'Anticipation (§ 102), obviousness (§ 103), § 101 eligibility (Alice/Mayo), § 112 indefiniteness/written description/enablement.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'clear_and_convincing',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'patent_remedies',
    category: 'remedies_defenses',
    label: 'Patent remedies',
    description: 'Lost profits, reasonable royalty (Georgia-Pacific), enhanced damages (Halo), injunctions (eBay v. MercExchange).',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  // Copyright
  {
    id: 'copyright_infringement',
    category: 'federal_statutes',
    label: 'Copyright infringement',
    description: '17 U.S.C. § 501. Ownership + copying + substantial similarity. Striking similarity for access.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
      pjiAnchor: {
        source: 'NINTH_CIR_PATTERN',
        section: '9th Cir. Pattern Civil 17.5 (Copyright Infringement—Elements)',
        operativeLanguage:
          'In order for the plaintiff to prove copyright infringement, plaintiff must prove (1) plaintiff is the owner of a valid copyright, and (2) defendant copied original expression from the copyrighted work.',
        url: 'https://www.ce9.uscourts.gov/jury-instructions/model-civil',
      },
    },
  },
  {
    id: 'copyright_fair_use',
    category: 'remedies_defenses',
    label: 'Fair use',
    description: '§ 107 four factors. Warhol Foundation refinement of transformative use; commercial purpose; market effect.',
    annotations: {
      nodeType: 'factor',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
      pjiAnchor: {
        source: 'NINTH_CIR_PATTERN',
        section: '9th Cir. Pattern Civil 17.18 (Fair Use)',
        operativeLanguage:
          'One who is not the owner of the copyright may use the copyrighted work in a reasonable way under the circumstances without the consent of the copyright owner if it would advance the public interest. This is known as the fair-use doctrine. Defendant has the burden of proving fair use by a preponderance of the evidence.',
        url: 'https://www.ce9.uscourts.gov/jury-instructions/model-civil',
      },
    },
  },
  {
    id: 'copyright_dmca',
    category: 'federal_statutes',
    label: 'DMCA',
    description: '§ 512 safe harbor (registered agent, repeat-infringer policy). § 1201 anti-circumvention.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'work_for_hire',
    category: 'contract_clauses',
    label: 'Work-for-hire / assignment',
    description: '§ 101 work-for-hire definition; written assignment for non-employees; recordation under § 205.',
    annotations: {
      nodeType: 'right',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // Trademark
  {
    id: 'trademark_infringement',
    category: 'federal_statutes',
    label: 'Trademark infringement',
    description: 'Lanham § 32 (registered) + § 43(a) (unregistered). Likelihood of confusion (Polaroid / Sleekcraft).',
    annotations: {
      nodeType: 'factor',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'clear_error',
      pjiAnchor: {
        source: 'NINTH_CIR_PATTERN',
        section: '9th Cir. Pattern Civil 15.18 (Infringement—Likelihood of Confusion—Sleekcraft Factors)',
        operativeLanguage:
          'You must consider the following factors in determining whether defendant\'s use of the mark is likely to cause confusion: (1) strength of plaintiff\'s mark; (2) proximity or relatedness of the goods/services; (3) similarity of the marks; (4) evidence of actual confusion; (5) marketing channels; (6) degree of consumer care; (7) defendant\'s intent; (8) likelihood of expansion of product lines.',
        url: 'https://www.ce9.uscourts.gov/jury-instructions/model-civil',
      },
    },
  },
  {
    id: 'trademark_dilution',
    category: 'federal_statutes',
    label: 'Trademark dilution',
    description: 'Lanham § 43(c). Blurring + tarnishment. Famous-mark predicate.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'clear_error',
    },
  },
  {
    id: 'trademark_first_amendment',
    category: 'remedies_defenses',
    label: 'Trademark First Amendment',
    description: 'Rogers test for expressive use. Jack Daniel\'s v. VIP Products clarifies when Rogers applies.',
    annotations: {
      nodeType: 'standard',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // Trade secret
  {
    id: 'trade_secret_dtsa',
    category: 'federal_statutes',
    label: 'Trade secret (DTSA)',
    description: 'Defend Trade Secrets Act + state UTSA. Reasonable secrecy measures + economic value from secrecy + misappropriation.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'inevitable_disclosure',
    category: 'remedies_defenses',
    label: 'Inevitable disclosure doctrine',
    description: 'Whether new employment will inevitably disclose former employer\'s secrets. Varies sharply by state (IL recognizes; CA rejects).',
    annotations: {
      nodeType: 'standard',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'pleadings',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  // Licensing + contracts
  {
    id: 'license_scope',
    category: 'contract_clauses',
    label: 'License scope',
    description: 'Field of use, territory, exclusivity, sublicense rights, term, termination triggers, post-termination tail.',
    annotations: {
      nodeType: 'right',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'royalty_structure',
    category: 'contract_clauses',
    label: 'Royalty structure',
    description: 'Running royalty, lump-sum, milestone, minimums. Audit rights. Most-favored-licensee clauses.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'open_source',
    category: 'contract_clauses',
    label: 'Open-source compliance',
    description: 'Copyleft (GPL, AGPL) vs. permissive (MIT, Apache). Attribution + notice + source-disclosure obligations.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'pleadings',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'employee_invention_assignment',
    category: 'contract_clauses',
    label: 'Employee invention assignment',
    description: 'PIIA scope, state-law carve-outs (CA Lab. Code § 2870, WA, IL, etc.) for inventions on own time without employer resources.',
    annotations: {
      nodeType: 'right',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'derivative_works',
    category: 'contract_clauses',
    label: 'Derivative works + improvements',
    description: 'Who owns improvements; grant-back vs. assignment vs. license. Cross-licensing in joint development.',
    annotations: {
      nodeType: 'right',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
];
