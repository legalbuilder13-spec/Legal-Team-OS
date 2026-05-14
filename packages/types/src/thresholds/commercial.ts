import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 + §8. Commercial / contracts pre-merits checklist.

export const COMMERCIAL_THRESHOLDS_VERSION = '1.0.0';

export const COMMERCIAL_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'choice_of_law',
    prompt:
      'Choice-of-law clause. Does the contract (or the matter) reference a governing-law provision? The named jurisdiction may differ from where the parties are located and can change every downstream answer.',
    severityIfRaised: 'high',
  },
  {
    id: 'forum_selection',
    prompt:
      'Forum-selection / exclusive-venue clause. Litigation may need to happen in a specific court; arbitration may be mandated.',
    severityIfRaised: 'high',
  },
  {
    id: 'arbitration',
    prompt:
      'Mandatory arbitration / dispute-resolution clause. Is there a binding arbitration provision, including class-action waiver?',
    severityIfRaised: 'high',
  },
  {
    id: 'limitations',
    prompt:
      'Statute of limitations or contractual shortened-limitations clause. UCC actions, breach-of-contract claims, and many service agreements have explicit time bars.',
    severityIfRaised: 'high',
  },
  {
    id: 'indemnity_carve_outs',
    prompt:
      'Indemnification scope / carve-outs. Does the contract limit the available remedy through indemnity exclusions, caps, or liability waivers that could be dispositive?',
    severityIfRaised: 'medium',
  },
  {
    id: 'no_oral_modification',
    prompt:
      'No-oral-modification clause / Statute of Frauds. Was any alleged modification or side-deal in writing? Many commercial agreements require written amendments.',
    severityIfRaised: 'medium',
  },
  {
    id: 'condition_precedent',
    prompt:
      'Condition precedent unmet. Does the request to enforce or rescind depend on a notice requirement, cure period, or contractual prerequisite that may not have been satisfied?',
    severityIfRaised: 'medium',
  },
  {
    id: 'force_majeure',
    prompt:
      'Force-majeure / impossibility / frustration. Does the matter involve an event that may excuse performance under contractual or common-law doctrines?',
    severityIfRaised: 'low',
  },
];
