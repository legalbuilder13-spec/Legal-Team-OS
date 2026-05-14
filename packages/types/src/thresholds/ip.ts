import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 — IP pre-merits checklist. Registration prerequisites,
// statutory damages eligibility, preemption, and ownership/standing
// issues that dispose of IP matters before merits.

export const IP_THRESHOLDS_VERSION = '1.0.0';

export const IP_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'registration_prerequisite',
    prompt:
      'Registration prerequisite. Copyright infringement suit requires registration (Fourth Estate v. Wall-Street.com). Patent infringement requires issued patent. Trademark federal suit needs registration for some remedies.',
    severityIfRaised: 'high',
  },
  {
    id: 'standing_ownership',
    prompt:
      'Ownership / standing. Patent: assignee must own the patent at filing (not nunc pro tunc). Copyright: legal/beneficial owner. Trademark: prior + continuous use, or registration owner. Work-for-hire vs. assignment.',
    severityIfRaised: 'high',
  },
  {
    id: 'preemption_301',
    prompt:
      'Copyright Act § 301 preemption of state-law claims (right of publicity, misappropriation, conversion of intangibles) where state right is equivalent to exclusive rights under § 106.',
    severityIfRaised: 'medium',
  },
  {
    id: 'patent_eligibility',
    prompt:
      'Patent subject-matter eligibility under 35 U.S.C. § 101 + Alice / Mayo two-step. Abstract ideas, laws of nature, natural phenomena threshold before merits.',
    severityIfRaised: 'high',
  },
  {
    id: 'inter_partes_review',
    prompt:
      'Concurrent or prior IPR / PGR at the PTAB. Estoppel under § 315(e), stay motions, NHK-Fintiv parallel-proceeding analysis.',
    severityIfRaised: 'medium',
  },
  {
    id: 'first_sale',
    prompt:
      'First-sale doctrine (Kirtsaeng for copyright, Quanta for patents). Does the matter involve resale or downstream use of an authorized first sale?',
    severityIfRaised: 'medium',
  },
  {
    id: 'fair_use',
    prompt:
      'Fair use threshold inquiry — § 107 four-factor analysis is a threshold defense in copyright cases (Warhol, Google v. Oracle). Transformative use, market effect.',
    severityIfRaised: 'medium',
  },
  {
    id: 'limitations_dmca',
    prompt:
      'Statute of limitations (3-year copyright, 6-year patent damages cap, 4-year Lanham Act). DMCA safe-harbor compliance (§ 512) — registered agent, repeat-infringer policy.',
    severityIfRaised: 'high',
  },
  {
    id: 'trade_secret_misappropriation',
    prompt:
      'Trade secret threshold: reasonable secrecy measures + actual secret + misappropriation. DTSA (federal) requires interstate commerce; state UTSA equivalent for state.',
    severityIfRaised: 'medium',
  },
  {
    id: 'trademark_use_in_commerce',
    prompt:
      'Trademark use in commerce (Lanham Act § 45). Bona fide use, not token use. Specimen-of-use requirements. Recent Tam / Brunetti developments on registration.',
    severityIfRaised: 'medium',
  },
  {
    id: 'first_amendment',
    prompt:
      'First Amendment defense for IP claims involving expressive content (Rogers test for titles + commercial use; Vidal v. Elster for trademark refusals).',
    severityIfRaised: 'medium',
  },
];
