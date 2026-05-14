// PRD §7.6. These regexes drive the suggested-invocation hint on the
// matter detail page — they do NOT auto-trigger the statutory tool. They
// surface a "this looks like a statutory question — consider running the
// tool" badge so the lawyer notices the option.

export interface StatuteCitationMatch {
  raw: string;
  kind: 'us_code' | 'cfr' | 'state_code' | 'public_law' | 'session_law';
  jurisdictionHint?: string;
}

// Common federal patterns. State codes vary too much for a single regex
// per state, so we use a permissive umbrella that catches typical state
// citation forms (e.g. "Cal. Civ. Code § 1798.140", "210 Ill. Comp. Stat.
// 46/25"). The skill is shown the raw matches and decides which are real.

const US_CODE = /\b(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s+§?\s?(\d+[A-Za-z0-9.\-]*)/g;
const CFR = /\b(\d{1,3})\s+C\.?\s?F\.?\s?R\.?\s+§?\s?(\d+[A-Za-z0-9.\-]*)/g;
const PUBLIC_LAW = /\bPub(lic)?\.?\s*L(aw)?\.?\s*(No\.)?\s*\d{1,3}-\d+/g;

// Permissive state-code pattern. Captures the common shapes
// "<State> <Code> § <number>" and "<number> <state-abbr> <type> <number>".
const STATE_CODE_A =
  /\b(?:Ala|Alaska|Ariz|Ark|Cal|Colo|Conn|Del|D\.C|Fla|Ga|Haw|Idaho|Ill|Ind|Iowa|Kan|Ky|La|Me|Md|Mass|Mich|Minn|Miss|Mo|Mont|Neb|Nev|N\.H|N\.J|N\.M|N\.Y|N\.C|N\.D|Ohio|Okla|Or|Pa|R\.I|S\.C|S\.D|Tenn|Tex|Utah|Vt|Va|Wash|W\.\s?Va|Wis|Wyo)\.?\s+[A-Z][A-Za-z. ]+(Code|Stat|Laws|Rev\.?\s?Stat)\.?\s+§?\s*[\d-]+[A-Za-z0-9.\-/]*/g;

export function extractStatuteCitations(text: string): StatuteCitationMatch[] {
  const matches: StatuteCitationMatch[] = [];

  for (const m of text.matchAll(US_CODE)) {
    matches.push({ raw: m[0], kind: 'us_code', jurisdictionHint: 'federal' });
  }
  for (const m of text.matchAll(CFR)) {
    matches.push({ raw: m[0], kind: 'cfr', jurisdictionHint: 'federal' });
  }
  for (const m of text.matchAll(PUBLIC_LAW)) {
    matches.push({ raw: m[0], kind: 'public_law', jurisdictionHint: 'federal' });
  }
  for (const m of text.matchAll(STATE_CODE_A)) {
    matches.push({ raw: m[0], kind: 'state_code' });
  }

  return dedup(matches);
}

function dedup(matches: StatuteCitationMatch[]): StatuteCitationMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.kind}:${m.raw.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Keyword triggers — single-word or short-phrase tokens that suggest a
// statutory question is hiding in a fact-heavy request. Curated; small.
export const STATUTE_KEYWORD_TRIGGERS = [
  'Title VII',
  'ADA',
  'ADEA',
  'FMLA',
  'FLSA',
  'GINA',
  'NLRA',
  'USERRA',
  'ERISA',
  'COBRA',
  'WARN Act',
  'OSHA',
  'HIPAA',
  'GLBA',
  'FCRA',
  'FERPA',
  'COPPA',
  'CCPA',
  'CPRA',
  'GDPR',
  'CAN-SPAM',
  'TCPA',
  'DMCA',
  'Lanham Act',
  'Sherman Act',
  'Clayton Act',
  'FTC Act',
  'Sarbanes-Oxley',
  'Dodd-Frank',
  'SOX',
];

export function detectStatuteKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return STATUTE_KEYWORD_TRIGGERS.filter((kw) => lower.includes(kw.toLowerCase()));
}

// Case-citation regex for §7.7's case-law suggested-invocation hint.
const CASE_CITATION =
  /\b[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)*\s+v\.\s+[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)*(?:,\s*\d+\s+[A-Z][A-Za-z.0-9]+\s+\d+)?/g;

export function extractCaseCitations(text: string): string[] {
  const matches = Array.from(text.matchAll(CASE_CITATION), (m) => m[0]);
  return Array.from(new Set(matches));
}
