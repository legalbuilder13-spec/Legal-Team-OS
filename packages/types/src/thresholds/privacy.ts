import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 + §8 (sectoral preemption, applicability thresholds, exemption
// types). Privacy / data-protection pre-merits checklist.

export const PRIVACY_THRESHOLDS_VERSION = '1.0.0';

export const PRIVACY_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'sectoral_preemption',
    prompt:
      'Federal sectoral preemption. Could the data at issue be governed by HIPAA (health), GLBA (financial), FCRA (consumer reporting), FERPA (education), COPPA (children under 13), or other sector-specific federal regimes? If so, general consumer-privacy statutes may not apply or may apply only to non-covered data.',
    severityIfRaised: 'high',
  },
  {
    id: 'entity_exemption',
    prompt:
      'Entity-level exemption. Is the organization exempt from the privacy statute because of size thresholds (revenue / volume / activity-revenue) or entity category (nonprofit, government, financial institution)?',
    severityIfRaised: 'high',
  },
  {
    id: 'data_exemption',
    prompt:
      'Data-level exemption. Are the categories of data at issue (de-identified, publicly available, employment, B2B contact info, research) exempted from the applicable statute even when the entity is covered?',
    severityIfRaised: 'high',
  },
  {
    id: 'jurisdiction_extraterritorial',
    prompt:
      'Extraterritorial reach. Does the statute reach this organization based on residents-of-jurisdiction data even if the org has no physical presence there?',
    severityIfRaised: 'medium',
  },
  {
    id: 'private_right_of_action',
    prompt:
      'Private right of action. Does the applicable statute include a private right of action (and does it have a cure period)? Many privacy statutes are AG-enforcement-only; the enforcement posture changes priority.',
    severityIfRaised: 'medium',
  },
  {
    id: 'breach_notification_window',
    prompt:
      'Active breach notification timeline. Is there an ongoing or recent incident with a notification clock (commonly 72 hours under GDPR, 30/45/60 days under various US state breach laws)?',
    severityIfRaised: 'high',
  },
  {
    id: 'cross_border_transfer',
    prompt:
      'Cross-border data transfer. Does the matter involve transfers out of the EU / UK / specific jurisdictions with transfer-mechanism requirements (SCCs, adequacy, transfer impact assessment)?',
    severityIfRaised: 'medium',
  },
  {
    id: 'dsr_window',
    prompt:
      'Data subject request response window. Is there a pending DSR with a regulatory response deadline (commonly 30-45 days, extensible)?',
    severityIfRaised: 'high',
  },
];
