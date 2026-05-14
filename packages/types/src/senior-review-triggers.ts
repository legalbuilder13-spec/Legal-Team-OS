// PRD §14.2. Matters matching any of these patterns get a senior-review
// warning before any lawyer-invoked tool is enabled. The trigger doesn't
// short-circuit the auto pipeline — Stage 0 and Stage 1 still run — but the
// lawyer toolbar shows a banner and (depending on organization policy) may
// require senior sign-off before any tool fires.
//
// Patterns are case-insensitive substring/regex matches against the
// matter's request_text plus its title + summary after triage completes.

export interface SeniorReviewTrigger {
  id: string;
  label: string;
  patterns: RegExp[];
  severity: 'critical' | 'high' | 'medium';
}

export const SENIOR_REVIEW_TRIGGERS: SeniorReviewTrigger[] = [
  {
    id: 'criminal_exposure',
    label: 'Criminal exposure indicators',
    severity: 'critical',
    patterns: [
      /\bgrand\s+jury\b/i,
      /\bindict(ed|ment)\b/i,
      /\bsearch\s+warrant\b/i,
      /\bsubpoena\b/i,
      /\bcriminal\s+(investigation|charge|complaint|referral)\b/i,
      /\barrested?\b/i,
      /\bDOJ\b/,
      /\bFBI\b/,
    ],
  },
  {
    id: 'regulator_demand',
    label: 'Regulator demand letter / formal investigation',
    severity: 'high',
    patterns: [
      /\bcivil\s+investigative\s+demand\b/i,
      /\bCID\b/,
      /\bformal\s+investigation\b/i,
      /\bsubpoena\s+duces\s+tecum\b/i,
      /\bregulator(y)?\s+(demand|inquiry|enforcement)\b/i,
    ],
  },
  {
    id: 'bet_the_company',
    label: 'Bet-the-company exposure',
    severity: 'critical',
    patterns: [
      /\bbet[\s-]the[\s-]company\b/i,
      /\bexistential\b/i,
      /\bclass\s+action\b/i,
      /\bmass\s+(action|tort)\b/i,
    ],
  },
  {
    id: 'ethics_privilege',
    label: 'Ethics / privilege issue',
    severity: 'high',
    patterns: [
      /\battorney[\s-]client\s+privilege\b/i,
      /\bwork[\s-]product\b/i,
      /\bbar\s+(grievance|complaint)\b/i,
      /\bmalpractice\b/i,
      /\bconflict\s+of\s+interest\b/i,
      /\bdisqualification\b/i,
    ],
  },
];

export function detectSeniorReviewTriggers(text: string): SeniorReviewTrigger[] {
  return SENIOR_REVIEW_TRIGGERS.filter((trigger) =>
    trigger.patterns.some((pattern) => pattern.test(text)),
  );
}
