import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 — regulatory / agency pre-merits checklist. Jurisdiction,
// exhaustion, ripeness for review, and post-Loper Bright deference
// questions that dispose of regulatory matters before merits.

export const REGULATORY_THRESHOLDS_VERSION = '1.0.0';

export const REGULATORY_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'agency_jurisdiction',
    prompt:
      'Agency jurisdiction over the regulated activity. Authorizing statute scope, recent major-questions doctrine analysis (West Virginia v. EPA, Biden v. Nebraska) on novel agency assertions.',
    severityIfRaised: 'high',
  },
  {
    id: 'administrative_exhaustion',
    prompt:
      'Administrative exhaustion. Mandatory pre-suit agency procedures (notice + comment, internal appeal, ALJ hearing). Final agency action under APA § 704 before judicial review.',
    severityIfRaised: 'high',
  },
  {
    id: 'apa_review_window',
    prompt:
      'APA judicial-review window. 6-year default under 28 U.S.C. § 2401(a); shorter agency-specific windows. Corner Post (2024) reset the accrual rule for facial challenges.',
    severityIfRaised: 'medium',
  },
  {
    id: 'deference_status',
    prompt:
      'Deference doctrine. Post-Loper Bright: courts interpret statutes de novo; Skidmore respect for persuasive agency reasoning. Auer / Kisor deference still applies to genuinely ambiguous regulations.',
    severityIfRaised: 'medium',
  },
  {
    id: 'cure_period_compliance',
    prompt:
      'Cure period before penalty. Many regulatory schemes (CCPA, FERPA, OFAC, etc.) provide cure windows or right-to-respond before fines attach.',
    severityIfRaised: 'high',
  },
  {
    id: 'recordkeeping_compliance',
    prompt:
      'Recordkeeping / retention compliance. Agency-specific record requirements (FDA 21 CFR Part 11, SEC books-and-records, HIPAA security log retention).',
    severityIfRaised: 'medium',
  },
  {
    id: 'penalty_calculation',
    prompt:
      'Penalty-calculation framework. Per-violation vs. per-day vs. per-affected-person. Aggregation rules. Continuing-violation doctrine. Bipartisan Budget Act inflation adjustments.',
    severityIfRaised: 'medium',
  },
  {
    id: 'licensing_status',
    prompt:
      'Licensing / registration status. Active license, conditional license, or revoked? Renewal cycle, fitness-to-practice requirements, mandatory disclosures to renewal authority.',
    severityIfRaised: 'high',
  },
  {
    id: 'parallel_proceedings',
    prompt:
      'Parallel proceedings — civil + criminal + administrative concurrently. Fifth Amendment issues for individual respondents. Coordination of discovery + settlement.',
    severityIfRaised: 'high',
  },
  {
    id: 'attorney_client_privilege',
    prompt:
      'Privilege issues in agency proceedings. Upjohn warnings, joint-defense privilege, work-product. Some agencies (SEC, FTC) require privilege-log discipline.',
    severityIfRaised: 'medium',
  },
];
