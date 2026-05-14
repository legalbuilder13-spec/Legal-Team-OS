import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 + §8 (statute anatomy: anti-retroactivity, preemption, exhaustion).
// Per-practice-area pre-merits checklist. The threshold-spotter skill is
// shown this list + the matter request and returns a status per item.
// "Raised" findings with confidence >= 0.7 surface to the lawyer immediately.

export const EMPLOYMENT_THRESHOLDS_VERSION = '1.0.0';

export const EMPLOYMENT_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'sol',
    prompt:
      'Statute of limitations. Does the request indicate the underlying conduct occurred long enough ago to risk barring the claim (e.g., over 180 days for EEOC, over a year for many state FEPAs, over 2-3 years for most state common-law)? Look for dates, "last year," "a while back."',
    severityIfRaised: 'high',
    docAnchor: 'how-lawyers-think.md Part VI §D2',
  },
  {
    id: 'arbitration_clause',
    prompt:
      'Mandatory arbitration. Does the matter reference an arbitration agreement, employment contract with dispute-resolution language, or onboarding documents the requester signed? Arbitration may divert the dispute from court.',
    severityIfRaised: 'high',
  },
  {
    id: 'eeoc_exhaustion',
    prompt:
      'Administrative exhaustion. For Title VII / ADA / ADEA claims, the employee typically must file with the EEOC (or state equivalent) before suing. Has exhaustion happened, or is this a pre-exhaustion question?',
    severityIfRaised: 'medium',
  },
  {
    id: 'federal_preemption',
    prompt:
      'Federal preemption. Could the claim be preempted by federal law — ERISA preemption swallowing a state-law benefits claim, LMRA §301 preempting CBA-interpretation claims, FAA preempting state arbitration rules?',
    severityIfRaised: 'high',
  },
  {
    id: 'classification_question',
    prompt:
      'Worker classification. Is the worker an employee vs. independent contractor vs. joint employee at issue? Classification can be dispositive of which statutes apply.',
    severityIfRaised: 'high',
  },
  {
    id: 'retaliation_window',
    prompt:
      'Retaliation timing. Did adverse action occur within a suspicious window (typically <90 days) after protected activity (leave, complaint, FMLA, whistleblower report)? Tight timing is itself evidence and may shorten the analysis.',
    severityIfRaised: 'medium',
  },
  {
    id: 'release_or_waiver',
    prompt:
      'Existing release or waiver. Did the employee sign a separation agreement, release, or waiver of claims? OWBPA requirements for ADEA waivers (21/45-day consideration, 7-day revocation) may be implicated.',
    severityIfRaised: 'high',
  },
  {
    id: 'union_or_cba',
    prompt:
      'Collective bargaining agreement / union setting. Is the employee covered by a CBA? Grievance procedures may be the required forum; LMRA preemption may apply.',
    severityIfRaised: 'medium',
  },
];
