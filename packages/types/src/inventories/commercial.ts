import type { InventoryItem } from './types.js';

// PRD §12.1 — commercial / contract inventory. Covers the most common
// disputes + clause issues that arise in vendor + customer agreements.

export const COMMERCIAL_INVENTORY_VERSION = '1.0.0';

export const COMMERCIAL_INVENTORY: InventoryItem[] = [
  // Contract clauses (the deconstruction tree typically branches here)
  {
    id: 'choice_of_law',
    category: 'contract_clauses',
    label: 'Choice of law',
    description: 'Governing-law provision. Restatement (Second) §§ 187/188 + state-specific limits.',
  },
  {
    id: 'forum_selection',
    category: 'contract_clauses',
    label: 'Forum selection',
    description: 'Exclusive vs. permissive venue. Enforceability under Carnival Cruise / Atlantic Marine.',
  },
  {
    id: 'arbitration',
    category: 'contract_clauses',
    label: 'Arbitration',
    description:
      'Binding arbitration clause, class-action waiver, delegation clause. FAA enforcement vs. state unconscionability rules.',
  },
  {
    id: 'limitation_of_liability',
    category: 'contract_clauses',
    label: 'Limitation of liability',
    description: 'Liability caps, consequential damages waivers, carve-outs (gross negligence, IP indemnity).',
  },
  {
    id: 'indemnity',
    category: 'contract_clauses',
    label: 'Indemnity',
    description: 'Scope (defense + indemnify + hold harmless), carve-outs, notice/control of defense procedures.',
  },
  {
    id: 'warranty',
    category: 'contract_clauses',
    label: 'Warranty + disclaimer',
    description: 'Express + implied warranties; UCC §§ 2-313/314/315; conspicuous disclaimers.',
  },
  {
    id: 'force_majeure',
    category: 'contract_clauses',
    label: 'Force majeure',
    description: 'Specific listed events vs. catch-all; notice + mitigation obligations.',
  },
  {
    id: 'termination',
    category: 'contract_clauses',
    label: 'Termination',
    description: 'For cause + for convenience; cure periods; survival of obligations.',
  },
  {
    id: 'ip_assignment',
    category: 'contract_clauses',
    label: 'IP assignment + license',
    description: 'Work-for-hire vs. assignment; scope of license; pre-existing-IP carve-outs.',
  },
  // Remedies + defenses
  {
    id: 'rescission',
    category: 'remedies_defenses',
    label: 'Rescission',
    description: 'Fraud, mutual mistake, duress. Restoration of status quo.',
  },
  {
    id: 'specific_performance',
    category: 'remedies_defenses',
    label: 'Specific performance',
    description: 'Equitable remedy where damages are inadequate (unique goods, real property).',
  },
  {
    id: 'reformation',
    category: 'remedies_defenses',
    label: 'Reformation',
    description: 'Correction of writing to reflect actual agreement; clear-and-convincing standard.',
  },
  {
    id: 'unjust_enrichment',
    category: 'remedies_defenses',
    label: 'Unjust enrichment / quantum meruit',
    description: 'Quasi-contract recovery where formal contract fails or is voided.',
  },
  {
    id: 'statute_of_frauds',
    category: 'remedies_defenses',
    label: 'Statute of frauds',
    description: 'Writing requirements (real property, goods > $500 UCC, > 1-year, suretyship). Partial-performance exception.',
  },
  {
    id: 'parol_evidence',
    category: 'remedies_defenses',
    label: 'Parol evidence rule',
    description: 'Integration + merger clauses; exceptions for fraud, condition precedent, ambiguity.',
  },
  {
    id: 'frustration_of_purpose',
    category: 'remedies_defenses',
    label: 'Impracticability / frustration',
    description: 'Common-law + UCC §§ 2-615/2-616 doctrines.',
  },
  // Procedural
  {
    id: 'jurisdiction',
    category: 'procedural',
    label: 'Personal + subject-matter jurisdiction',
    description: 'Minimum contacts; diversity vs. federal-question.',
  },
  {
    id: 'limitations',
    category: 'procedural',
    label: 'Statute of limitations',
    description: 'UCC §§ 2-725 (4-year sale of goods), state breach-of-contract periods (3-6 years typically).',
  },
  {
    id: 'pre_suit_notice',
    category: 'procedural',
    label: 'Pre-suit notice + cure',
    description: 'Contract-mandated notice + cure periods before suit.',
  },
];
