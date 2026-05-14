import type { InventoryItem } from './types.js';

// PRD §12.1 — litigation inventory. Procedural posture-heavy; claim
// elements + defenses + remedies form the merits layer.

export const LITIGATION_INVENTORY_VERSION = '1.0.0';

export const LITIGATION_INVENTORY: InventoryItem[] = [
  // Procedural framework
  {
    id: 'jurisdiction_smj',
    category: 'procedural',
    label: 'Subject-matter jurisdiction',
    description: 'Federal question vs. diversity vs. supplemental; CAFA. Removal + remand.',
  },
  {
    id: 'jurisdiction_pj',
    category: 'procedural',
    label: 'Personal jurisdiction',
    description: 'International Shoe / Daimler / Bristol-Myers. Long-arm + due process.',
  },
  {
    id: 'venue_forum',
    category: 'procedural',
    label: 'Venue + forum selection',
    description: '§ 1391 venue, transfer under § 1404(a), forum non conveniens, contractual forum selection.',
  },
  {
    id: 'standing',
    category: 'procedural',
    label: 'Standing',
    description: 'Article III: injury, causation, redressability (Lujan). Prudential limits.',
  },
  {
    id: 'class_certification',
    category: 'procedural',
    label: 'Class certification',
    description: 'Rule 23(a) prerequisites + 23(b) type. Wal-Mart commonality + Comcast damages.',
  },
  {
    id: 'preliminary_injunction',
    category: 'procedural',
    label: 'Preliminary injunction / TRO',
    description: 'Winter four-factor test: likelihood of success, irreparable harm, balance, public interest.',
  },
  // Claim elements (the deconstruction tree typically branches here)
  {
    id: 'negligence',
    category: 'common_law',
    label: 'Negligence',
    description: 'Duty, breach, cause-in-fact, proximate cause, damages. Restatement (Third) of Torts.',
  },
  {
    id: 'breach_of_contract',
    category: 'common_law',
    label: 'Breach of contract',
    description: 'Formation, performance, breach, excuse, damages.',
  },
  {
    id: 'fraud',
    category: 'common_law',
    label: 'Fraud / misrepresentation',
    description: 'Misrepresentation, materiality, scienter, intent to induce, justifiable reliance, damages.',
  },
  {
    id: 'unjust_enrichment',
    category: 'common_law',
    label: 'Unjust enrichment',
    description: 'Benefit conferred + appreciation + inequitable retention.',
  },
  {
    id: 'civil_conspiracy',
    category: 'common_law',
    label: 'Civil conspiracy',
    description: 'Agreement + underlying tort + overt act + damages. Most jurisdictions require predicate tort.',
  },
  {
    id: 'section_1983',
    category: 'federal_statutes',
    label: '§ 1983 constitutional claim',
    description: 'Action under color of state law + deprivation of federal right. Monell theory for entities.',
  },
  // Defenses
  {
    id: 'statute_of_limitations',
    category: 'remedies_defenses',
    label: 'Statute of limitations / repose',
    description: 'Accrual, discovery, tolling. Repose is absolute.',
  },
  {
    id: 'qualified_immunity',
    category: 'remedies_defenses',
    label: 'Qualified immunity',
    description: 'Clearly established law at time of conduct (Saucier / Pearson).',
  },
  {
    id: 'comparative_fault',
    category: 'remedies_defenses',
    label: 'Comparative / contributory fault',
    description: 'Pure comparative vs. modified vs. contributory (DC, MD, NC, VA, AL).',
  },
  {
    id: 'assumption_of_risk',
    category: 'remedies_defenses',
    label: 'Assumption of risk',
    description: 'Express vs. implied. Primary (no-duty) vs. secondary.',
  },
  {
    id: 'preemption',
    category: 'remedies_defenses',
    label: 'Preemption',
    description: 'Express, field, conflict, obstacle preemption. Save-clause analysis.',
  },
  {
    id: 'res_judicata_collateral_estoppel',
    category: 'remedies_defenses',
    label: 'Res judicata / collateral estoppel',
    description: 'Claim vs. issue preclusion; same parties or privity; final judgment.',
  },
  // Remedies
  {
    id: 'damages_compensatory',
    category: 'remedies_defenses',
    label: 'Compensatory damages',
    description: 'Economic + noneconomic. Avoidable consequences / mitigation duty.',
  },
  {
    id: 'damages_punitive',
    category: 'remedies_defenses',
    label: 'Punitive damages',
    description: 'State Farm / BMW v. Gore single-digit ratio guidepost; gross-negligence / malice predicate.',
  },
  {
    id: 'equitable_relief',
    category: 'remedies_defenses',
    label: 'Equitable relief',
    description: 'Injunction (permanent), specific performance, rescission, restitution, constructive trust.',
  },
  {
    id: 'attorneys_fees',
    category: 'remedies_defenses',
    label: 'Attorneys\' fees',
    description: 'American rule default; statutory fee-shifting (1988, civil rights, consumer protection); contractual fee-shifting; bad-faith exception.',
  },
];
