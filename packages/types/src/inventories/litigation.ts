// PR-B follow-up — first-pass annotations added 2026-05-16; attorney review required.
import type { InventoryItem } from './types.js';

// PRD §12.1 — litigation inventory. Procedural posture-heavy; claim
// elements + defenses + remedies form the merits layer.

export const LITIGATION_INVENTORY_VERSION = '1.1.0';

export const LITIGATION_INVENTORY: InventoryItem[] = [
  // Procedural framework
  {
    id: 'jurisdiction_smj',
    category: 'procedural',
    label: 'Subject-matter jurisdiction',
    description: 'Federal question vs. diversity vs. supplemental; CAFA. Removal + remand.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'jurisdiction_pj',
    category: 'procedural',
    label: 'Personal jurisdiction',
    description: 'International Shoe / Daimler / Bristol-Myers. Long-arm + due process.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'venue_forum',
    category: 'procedural',
    label: 'Venue + forum selection',
    description: '§ 1391 venue, transfer under § 1404(a), forum non conveniens, contractual forum selection.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  {
    id: 'standing',
    category: 'procedural',
    label: 'Standing',
    description: 'Article III: injury, causation, redressability (Lujan). Prudential limits.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'class_certification',
    category: 'procedural',
    label: 'Class certification',
    description: 'Rule 23(a) prerequisites + 23(b) type. Wal-Mart commonality + Comcast damages.',
    annotations: {
      nodeType: 'procedural',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'discovery',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  {
    id: 'preliminary_injunction',
    category: 'procedural',
    label: 'Preliminary injunction / TRO',
    description: 'Winter four-factor test: likelihood of success, irreparable harm, balance, public interest.',
    annotations: {
      nodeType: 'factor',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'pleadings',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  // Claim elements (the deconstruction tree typically branches here)
  {
    id: 'negligence',
    category: 'common_law',
    label: 'Negligence',
    description: 'Duty, breach, cause-in-fact, proximate cause, damages. Restatement (Third) of Torts.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
      pjiAnchor: {
        source: 'CACI',
        section: 'CACI 400 (Negligence—Essential Factual Elements)',
        operativeLanguage:
          'To establish a claim of negligence, plaintiff must prove (1) that defendant was negligent; (2) that plaintiff was harmed; and (3) that defendant\'s negligence was a substantial factor in causing plaintiff\'s harm.',
        url: 'https://www.courts.ca.gov/partners/juryinstructions.htm',
      },
    },
  },
  {
    id: 'breach_of_contract',
    category: 'common_law',
    label: 'Breach of contract',
    description: 'Formation, performance, breach, excuse, damages.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
      pjiAnchor: {
        source: 'CACI',
        section: 'CACI 303 (Breach of Contract—Essential Factual Elements)',
        operativeLanguage:
          'To recover damages from defendant for breach of contract, plaintiff must prove (1) that plaintiff and defendant entered into a contract; (2) that plaintiff did all, or substantially all, of the significant things that the contract required; (3) that defendant failed to do something that the contract required; and (4) that plaintiff was harmed by that failure.',
        url: 'https://www.courts.ca.gov/partners/juryinstructions.htm',
      },
    },
  },
  {
    id: 'fraud',
    category: 'common_law',
    label: 'Fraud / misrepresentation',
    description: 'Misrepresentation, materiality, scienter, intent to induce, justifiable reliance, damages.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'clear_and_convincing',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'clear_error',
      pjiAnchor: {
        source: 'CACI',
        section: 'CACI 1900 (Intentional Misrepresentation—Essential Factual Elements)',
        operativeLanguage:
          'To recover for intentional misrepresentation, plaintiff must prove (1) defendant represented to plaintiff that a fact was true; (2) the representation was false; (3) defendant knew the representation was false or made it recklessly; (4) defendant intended to induce reliance; (5) plaintiff reasonably relied; and (6) plaintiff was harmed as a result.',
        url: 'https://www.courts.ca.gov/partners/juryinstructions.htm',
      },
    },
  },
  {
    id: 'unjust_enrichment',
    category: 'common_law',
    label: 'Unjust enrichment',
    description: 'Benefit conferred + appreciation + inequitable retention.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'civil_conspiracy',
    category: 'common_law',
    label: 'Civil conspiracy',
    description: 'Agreement + underlying tort + overt act + damages. Most jurisdictions require predicate tort.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'section_1983',
    category: 'federal_statutes',
    label: '§ 1983 constitutional claim',
    description: 'Action under color of state law + deprivation of federal right. Monell theory for entities.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // Defenses
  {
    id: 'statute_of_limitations',
    category: 'remedies_defenses',
    label: 'Statute of limitations / repose',
    description: 'Accrual, discovery, tolling. Repose is absolute.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'qualified_immunity',
    category: 'remedies_defenses',
    label: 'Qualified immunity',
    description: 'Clearly established law at time of conduct (Saucier / Pearson).',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'summary_judgment',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'comparative_fault',
    category: 'remedies_defenses',
    label: 'Comparative / contributory fault',
    description: 'Pure comparative vs. modified vs. contributory (DC, MD, NC, VA, AL).',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'clear_error',
    },
  },
  {
    id: 'assumption_of_risk',
    category: 'remedies_defenses',
    label: 'Assumption of risk',
    description: 'Express vs. implied. Primary (no-duty) vs. secondary.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'preemption',
    category: 'remedies_defenses',
    label: 'Preemption',
    description: 'Express, field, conflict, obstacle preemption. Save-clause analysis.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'res_judicata_collateral_estoppel',
    category: 'remedies_defenses',
    label: 'Res judicata / collateral estoppel',
    description: 'Claim vs. issue preclusion; same parties or privity; final judgment.',
    annotations: {
      nodeType: 'threshold',
      burdenOfPersuasion: 'defendant',
      standardOfProof: 'preponderance',
      defaultPosture: 'motion_to_dismiss',
      appellateStandardOfReview: 'de_novo',
    },
  },
  // Remedies
  {
    id: 'damages_compensatory',
    category: 'remedies_defenses',
    label: 'Compensatory damages',
    description: 'Economic + noneconomic. Avoidable consequences / mitigation duty.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'clear_error',
    },
  },
  {
    id: 'damages_punitive',
    category: 'remedies_defenses',
    label: 'Punitive damages',
    description: 'State Farm / BMW v. Gore single-digit ratio guidepost; gross-negligence / malice predicate.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'clear_and_convincing',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'de_novo',
    },
  },
  {
    id: 'equitable_relief',
    category: 'remedies_defenses',
    label: 'Equitable relief',
    description: 'Injunction (permanent), specific performance, rescission, restitution, constructive trust.',
    annotations: {
      nodeType: 'standard',
      burdenOfPersuasion: 'plaintiff',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
  {
    id: 'attorneys_fees',
    category: 'remedies_defenses',
    label: 'Attorneys\' fees',
    description: 'American rule default; statutory fee-shifting (1988, civil rights, consumer protection); contractual fee-shifting; bad-faith exception.',
    annotations: {
      nodeType: 'rule',
      burdenOfPersuasion: 'movant',
      standardOfProof: 'preponderance',
      defaultPosture: 'trial',
      appellateStandardOfReview: 'abuse_of_discretion',
    },
  },
];
