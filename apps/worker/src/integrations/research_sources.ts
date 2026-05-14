// PRD §8.1 — primary-source statutory text retrieval.
// Phase 2 v1 ships against public sources: Cornell LII (USC), eCFR
// (federal regulations), Justia (state codes). Commercial providers
// (Westlaw, Lexis, Fastcase) plug in by adding a new fetcher under the
// same FetchResult contract. The skill consumes raw text and doesn't
// know which source produced it.
//
// What this module does NOT do (deliberately):
// - parse jurisdiction-specific HTML into structured operative
//   provisions. That's the skill's job (text → structured analysis).
// - cache aggressively. Caching layer can be added later via
//   context_cache; in v1 the worker re-fetches on each tool run.
// - cite-check. The verification protocol in the handler re-fetches
//   the source and compares hashes; that lives in run-statutory.ts.

export type FetchSource = 'cornell_lii' | 'ecfr' | 'justia' | 'generic';

export interface FetchResult {
  ok: boolean;
  citation: string;
  url: string;
  rawText: string;
  source: FetchSource;
  fetchedAt: string;
  hash: string;
  error?: string;
}

import { createHash } from 'node:crypto';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

// Very narrow HTML→text — strip tags, collapse whitespace. The
// statute-analysis skill is told the text is roughly the rendered
// page content; it does its own structural parsing from there.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&sect;/g, '§')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

async function rawFetch(url: string, source: FetchSource, citation: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'LegalTeamOS-Research/1.0 (+https://legalbuilder.app)',
        accept: 'text/html,application/xhtml+xml',
      },
      // GitHub's Node 18 fetch supports AbortSignal.timeout in current
      // versions; if unavailable the request hangs at the worker job
      // timeout rather than wedging the whole pipeline.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        citation,
        url,
        rawText: '',
        source,
        fetchedAt: nowIso(),
        hash: '',
        error: `${res.status} ${res.statusText}`,
      };
    }
    const html = await res.text();
    const text = stripHtml(html);
    return {
      ok: true,
      citation,
      url,
      rawText: text,
      source,
      fetchedAt: nowIso(),
      hash: sha256(text),
    };
  } catch (err) {
    return {
      ok: false,
      citation,
      url,
      rawText: '',
      source,
      fetchedAt: nowIso(),
      hash: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ----- Federal: USC via Cornell LII -----

// Parses "42 U.S.C. § 1395cc(a)(1)(A)" → { title: 42, section: '1395cc' }.
// LII URLs key on title + section; subsection navigation is done in-page.
function parseUSCRef(citation: string): { title: string; section: string } | null {
  const m = /(\d{1,2})\s*U\.?\s?S\.?\s?C\.?\s*§?\s*(\d+[A-Za-z0-9]*)/.exec(citation);
  if (!m) return null;
  return { title: m[1]!, section: m[2]! };
}

export async function fetchUSC(citation: string): Promise<FetchResult> {
  const parsed = parseUSCRef(citation);
  if (!parsed) {
    return {
      ok: false,
      citation,
      url: '',
      rawText: '',
      source: 'cornell_lii',
      fetchedAt: nowIso(),
      hash: '',
      error: 'Could not parse USC citation',
    };
  }
  const url = `https://www.law.cornell.edu/uscode/text/${parsed.title}/${parsed.section}`;
  return rawFetch(url, 'cornell_lii', citation);
}

// ----- Federal: CFR via eCFR -----

// Parses "45 C.F.R. § 164.502" → { title: 45, section: '164.502' }.
// eCFR's HTML pages live at /current/title-N/chapter-X/part-Y/section-Z.
// Without the full part/chapter we use the search-redirect endpoint
// that resolves section numbers directly.
function parseCFRRef(citation: string): { title: string; section: string } | null {
  const m = /(\d{1,3})\s*C\.?\s?F\.?\s?R\.?\s*§?\s*(\d+\.\d+[A-Za-z0-9-]*)/.exec(citation);
  if (!m) return null;
  return { title: m[1]!, section: m[2]! };
}

export async function fetchCFR(citation: string): Promise<FetchResult> {
  const parsed = parseCFRRef(citation);
  if (!parsed) {
    return {
      ok: false,
      citation,
      url: '',
      rawText: '',
      source: 'ecfr',
      fetchedAt: nowIso(),
      hash: '',
      error: 'Could not parse CFR citation',
    };
  }
  // eCFR has a versioner API + a public web view. The web view
  // accepts /current/title-N/section-X.Y as a redirect target.
  const url = `https://www.ecfr.gov/current/title-${parsed.title}/section-${parsed.section}`;
  return rawFetch(url, 'ecfr', citation);
}

// ----- State: Justia -----

// State citations vary too much to parse generically. We accept a
// caller-provided URL when the citation is jurisdiction-specific enough
// that auto-construction would fail. The handler builds the URL from
// the lawyer's input where possible and falls back to a Justia search
// when it can't.
export async function fetchStateByUrl(url: string, citation: string): Promise<FetchResult> {
  return rawFetch(url, 'justia', citation);
}

// ----- Generic fallback -----

export async function fetchGeneric(url: string, citation: string): Promise<FetchResult> {
  return rawFetch(url, 'generic', citation);
}

// ----- Dispatcher -----

// Given a raw citation string + jurisdiction hint, pick the best
// fetcher. Returns ok=false if no fetcher can be matched.
export async function fetchByJurisdiction(
  citation: string,
  jurisdiction: string,
  urlHint?: string,
): Promise<FetchResult> {
  // Explicit URL hint always wins.
  if (urlHint) {
    return fetchGeneric(urlHint, citation);
  }
  const juris = jurisdiction.toLowerCase();
  if (/\bU\.?\s?S\.?\s?C\.?\b/.test(citation)) return fetchUSC(citation);
  if (/\bC\.?\s?F\.?\s?R\.?\b/.test(citation)) return fetchCFR(citation);
  if (juris === 'federal' || juris === 'us' || juris === 'usa') {
    // Federal jurisdiction without explicit USC/CFR — best guess Cornell.
    return fetchUSC(citation);
  }
  // Anything else: cannot auto-construct a URL. Caller should supply
  // urlHint or the source row will record this as unverifiable.
  return {
    ok: false,
    citation,
    url: '',
    rawText: '',
    source: 'generic',
    fetchedAt: nowIso(),
    hash: '',
    error: `No fetcher for jurisdiction='${jurisdiction}' without a urlHint`,
  };
}
