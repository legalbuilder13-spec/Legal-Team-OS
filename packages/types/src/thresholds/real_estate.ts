import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 — real estate pre-merits checklist. Title, recording,
// zoning, landlord-tenant frameworks, and financing-related thresholds.

export const REAL_ESTATE_THRESHOLDS_VERSION = '1.0.0';

export const REAL_ESTATE_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'title_marketability',
    prompt:
      'Title marketability. Encumbrances of record (mortgages, liens, easements, restrictive covenants, mechanic\'s liens). Marketable-title acts that extinguish stale claims.',
    severityIfRaised: 'high',
  },
  {
    id: 'recording_priority',
    prompt:
      'Recording statute and priority. Pure-race, notice, race-notice — varies by state. Shelter rule. BFP-without-notice protection.',
    severityIfRaised: 'high',
  },
  {
    id: 'statute_of_frauds',
    prompt:
      'Statute of Frauds. Real-property transfers + leases > 1 year typically require a signed writing. Part-performance + equitable-estoppel exceptions.',
    severityIfRaised: 'high',
  },
  {
    id: 'zoning_use',
    prompt:
      'Zoning + permitted use. Permitted by right, conditional use, variance required, nonconforming use grandfathered. Setbacks, height, FAR limits.',
    severityIfRaised: 'high',
  },
  {
    id: 'environmental_disclosure',
    prompt:
      'Environmental: CERCLA innocent-landowner defense, Phase I ESA, state-specific disclosure (NY, CA), known asbestos / lead / mold.',
    severityIfRaised: 'high',
  },
  {
    id: 'landlord_tenant',
    prompt:
      'Landlord-tenant statutory framework. Rent stabilization / control (NYC, CA, OR), security-deposit caps, eviction notice + grounds, retaliatory-eviction prohibitions.',
    severityIfRaised: 'medium',
  },
  {
    id: 'commercial_lease_clauses',
    prompt:
      'Commercial lease provisions — assignment + subletting, exclusive-use, co-tenancy, operating-expense / CAM reconciliation, holdover, surrender.',
    severityIfRaised: 'medium',
  },
  {
    id: 'foreclosure_anti_deficiency',
    prompt:
      'Foreclosure type (judicial vs. nonjudicial). Anti-deficiency statutes (CA Code Civ. Proc. §§ 580b/580d, AZ, NV, OR). Right of redemption.',
    severityIfRaised: 'high',
  },
  {
    id: 'easements_servitudes',
    prompt:
      'Easements / servitudes. Easement-by-necessity, by prescription, in gross vs. appurtenant. Recorded vs. unrecorded. Restrictive covenants — touch + concern, intent, notice.',
    severityIfRaised: 'medium',
  },
  {
    id: 'fair_housing',
    prompt:
      'Fair Housing Act / state equivalents — disparate impact + disparate treatment. Reasonable accommodation for disability. Familial status, source-of-income (state).',
    severityIfRaised: 'high',
  },
  {
    id: 'transfer_tax_doc_stamps',
    prompt:
      'Transfer tax / documentary stamps (CT, FL, NY, etc.). Mortgage tax (NY). Mansion tax thresholds. Withholding for foreign sellers (FIRPTA).',
    severityIfRaised: 'medium',
  },
  {
    id: 'condo_coop_specifics',
    prompt:
      'Condo / co-op specifics. Sponsor obligations, right-of-first-refusal, board-approval requirements, common-charge arrears, sublet policies.',
    severityIfRaised: 'medium',
  },
];
