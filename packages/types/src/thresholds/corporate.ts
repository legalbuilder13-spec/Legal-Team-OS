import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 — corporate / governance pre-merits checklist. Authority,
// approvals, securities exemptions, and fiduciary-duty thresholds.

export const CORPORATE_THRESHOLDS_VERSION = '1.0.0';

export const CORPORATE_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'entity_authority',
    prompt:
      'Entity authority. Does the proposed action require board approval, shareholder approval (DGCL § 251/271/220), or special class vote? Limited-liability shielding intact (no veil-piercing facts).',
    severityIfRaised: 'high',
  },
  {
    id: 'fiduciary_duty_standard',
    prompt:
      'Fiduciary-duty standard. Business judgment rule, enhanced scrutiny (Revlon, Unocal), or entire fairness (Weinberger). Controlling-stockholder / MFW cleansing.',
    severityIfRaised: 'high',
  },
  {
    id: 'securities_exemption',
    prompt:
      'Securities-law applicability. Public offering or exemption (Reg D 506(b)/(c), Reg S, Rule 144A, intrastate)? Section 5 violation is strict liability — exemption analysis is threshold.',
    severityIfRaised: 'high',
  },
  {
    id: 'reporting_obligations',
    prompt:
      'Public-company reporting obligations. 10-K/10-Q/8-K triggers, Section 16 filings, Schedule 13D/G, Form D for private placements.',
    severityIfRaised: 'medium',
  },
  {
    id: 'change_of_control',
    prompt:
      'Change-of-control provisions in debt, equity, and contracts. Definition variations (% threshold, board composition, asset sale). Acceleration triggers, consent requirements.',
    severityIfRaised: 'high',
  },
  {
    id: 'antitrust_filings',
    prompt:
      'HSR filing thresholds, foreign-investment filings (CFIUS, FDI regimes), antitrust-clearance gating before closing.',
    severityIfRaised: 'high',
  },
  {
    id: 'preemptive_rights',
    prompt:
      'Preemptive / right-of-first-refusal provisions in charter / stockholder agreements / financing docs. Triggered by new issuances or transfers.',
    severityIfRaised: 'medium',
  },
  {
    id: 'employee_equity',
    prompt:
      'Employee-equity / 409A valuation, ISO holding periods, 83(b) elections, 280G golden-parachute analysis on change of control.',
    severityIfRaised: 'medium',
  },
  {
    id: 'foreign_subsidiaries',
    prompt:
      'Foreign-subsidiary or cross-border structure. Tax (Subpart F, GILTI, BEAT), transfer pricing, foreign-currency translation, local-law board / director requirements.',
    severityIfRaised: 'low',
  },
  {
    id: 'derivative_demand',
    prompt:
      'Demand requirement / demand futility for derivative suits (Aronson / Rales / Zuckerberg). Special litigation committee independence.',
    severityIfRaised: 'medium',
  },
];
