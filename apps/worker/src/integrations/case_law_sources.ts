// PRD §11 — case-law retrieval + citator verification.
// v1 ships against CourtListener (free.law) — federal + state opinion
// coverage with a real citation-lookup endpoint that returns canonical
// case identity + treatment. Anonymous access works; an API token
// raises the rate limit. Commercial providers (Westlaw, Lexis,
// Fastcase, vLex) integrate by adding a sibling fetcher under the same
// contracts; the skill and worker are provider-blind beyond this file.
//
// PRD Part V #19 (Mata v. Avianca rule): verification MUST hit a
// separate source from the one that produced the citation. The skill
// never verifies its own output — the worker calls citationLookup()
// here, against CourtListener's database, after the skill returns.

import { env } from '../env.js';

const CL_API = 'https://www.courtlistener.com/api/rest/v4';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (env.COURTLISTENER_API_KEY) {
    h['authorization'] = `Token ${env.COURTLISTENER_API_KEY}`;
  }
  return h;
}

async function clFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${CL_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CourtListener ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ----- Search -----

export interface CaseSearchHit {
  caseName: string;
  citation: string;
  court: string;
  dateFiled: string | null;
  absoluteUrl: string;
  snippet: string;
  opinionId: string | null;
  clusterId: string | null;
  status?: string; // 'Published' | 'Unpublished' | ...
}

interface CLSearchResponse {
  results?: Array<{
    caseName?: string;
    citation?: string[];
    court?: string;
    dateFiled?: string | null;
    absolute_url?: string;
    snippet?: string;
    id?: number;
    cluster_id?: number;
    status?: string;
  }>;
}

interface SearchOptions {
  query: string;
  jurisdiction?: string;
  court?: string;
  // Number of results (CourtListener caps at 20 for the free tier).
  limit?: number;
  // CourtListener's search API supports 'o' (opinions), 'r' (RECAP), etc.
  type?: 'o';
}

export async function searchCases(opts: SearchOptions): Promise<CaseSearchHit[]> {
  const params = new URLSearchParams({
    q: opts.query,
    type: opts.type ?? 'o',
    order_by: 'score desc',
  });
  if (opts.court) params.set('court', opts.court);
  if (opts.jurisdiction) {
    // CourtListener's `court` param accepts specific court ids; for
    // jurisdiction-style filtering we use the `stat_` flags or rely on
    // text-level match. v1 keeps it simple: append jurisdiction as a
    // query token. (A future improvement is mapping common jurisdiction
    // strings to court ids.)
    params.set('q', `${params.get('q')} ${opts.jurisdiction}`);
  }
  const data = (await clFetch(`/search/?${params.toString()}`)) as CLSearchResponse;
  const results = data.results ?? [];
  return results.slice(0, opts.limit ?? 20).map((r) => ({
    caseName: r.caseName ?? '(unknown)',
    citation: (r.citation ?? [])[0] ?? '',
    court: r.court ?? '',
    dateFiled: r.dateFiled ?? null,
    absoluteUrl: r.absolute_url
      ? `https://www.courtlistener.com${r.absolute_url}`
      : '',
    snippet: r.snippet ?? '',
    opinionId: r.id != null ? String(r.id) : null,
    clusterId: r.cluster_id != null ? String(r.cluster_id) : null,
    status: r.status,
  }));
}

// ----- Citator lookup (the verification gate) -----

export type TreatmentStatus =
  | 'good_law'
  | 'negative_history'
  | 'overruled'
  | 'distinguished'
  | 'unverified'
  | 'unfindable';

export interface CitationLookupResult {
  citation: string;
  status: TreatmentStatus;
  caseName: string | null;
  court: string | null;
  dateFiled: string | null;
  absoluteUrl: string | null;
  // Number of citing references found by the citator. Used as a
  // weak heuristic for "is this case widely relied upon."
  citedByCount: number | null;
  // Negative-treatment signals collected from the citator graph.
  negativeTreatmentCount: number;
  errorMessage?: string;
}

interface CLLookupResponse {
  citation?: string;
  status?: number; // 200 success, 404 not found, etc.
  normalized_citations?: string[];
  clusters?: Array<{
    case_name?: string;
    court?: string;
    date_filed?: string;
    absolute_url?: string;
    sub_opinions?: Array<{ id?: number }>;
    citation_count?: number;
    // CourtListener returns 'overruled' or similar treatment fields in
    // some responses; coverage is uneven across the corpus.
    negative_treatment?: number;
  }>;
}

// PRD §11.2 — every cite MUST hit this gate before surfacing in the
// stage output. Calls CourtListener's citation-lookup endpoint with
// the cite as plain text; the API parses, normalizes, and returns the
// canonical case + treatment indicators.
//
// Reasoning: the skill produced the citation; this call goes to a
// DIFFERENT source (CourtListener's authoritative database, not the
// model's training data). That satisfies the "second independent
// source" requirement from Mata v. Avianca / PRD Part V #19.
export async function lookupCitation(citation: string): Promise<CitationLookupResult> {
  try {
    const body = new URLSearchParams({ text: citation });
    const data = (await clFetch(`/citation-lookup/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })) as CLLookupResponse[];

    // The endpoint returns an array (one entry per citation found in
    // the supplied text). We submitted a single citation, so pick the
    // first result.
    const result = Array.isArray(data) ? data[0] : (data as unknown as CLLookupResponse);
    if (!result || result.status === 404 || !result.clusters || result.clusters.length === 0) {
      return {
        citation,
        status: 'unfindable',
        caseName: null,
        court: null,
        dateFiled: null,
        absoluteUrl: null,
        citedByCount: null,
        negativeTreatmentCount: 0,
        errorMessage: 'Citation not found in CourtListener corpus',
      };
    }
    const cluster = result.clusters[0]!;
    const negative = cluster.negative_treatment ?? 0;
    // Treatment classification — simple v1 heuristic. The citator can
    // produce more fine-grained signals; we'll lean on CourtListener's
    // own fields once their schema settles.
    let status: TreatmentStatus = 'good_law';
    if (negative > 5) status = 'negative_history';
    if (negative > 20) status = 'overruled';

    return {
      citation,
      status,
      caseName: cluster.case_name ?? null,
      court: cluster.court ?? null,
      dateFiled: cluster.date_filed ?? null,
      absoluteUrl: cluster.absolute_url
        ? `https://www.courtlistener.com${cluster.absolute_url}`
        : null,
      citedByCount: cluster.citation_count ?? null,
      negativeTreatmentCount: negative,
    };
  } catch (err) {
    return {
      citation,
      status: 'unverified',
      caseName: null,
      court: null,
      dateFiled: null,
      absoluteUrl: null,
      citedByCount: null,
      negativeTreatmentCount: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ----- Citator traversal (3rd retrieval strategy) -----

interface CLCitedByResponse {
  results?: Array<{
    citing_opinion?: number;
    depth?: number;
  }>;
}

// PRD Part V #18 — 3rd retrieval strategy. Given an anchor opinion id,
// returns opinion ids that cite it. Used by run-case-law to expand
// from a known good anchor case into siblings. Cheap signal: the
// citation graph already pre-filters to cases discussing the same
// legal proposition.
export async function findCitingOpinions(opinionId: string, limit = 20): Promise<string[]> {
  const params = new URLSearchParams({ cited_opinion: opinionId });
  const data = (await clFetch(`/opinions-cited/?${params.toString()}`)) as CLCitedByResponse;
  const results = data.results ?? [];
  return results
    .slice(0, limit)
    .map((r) => (r.citing_opinion != null ? String(r.citing_opinion) : null))
    .filter((id): id is string => id !== null);
}

// ----- Opinion fetch (for verbatim quotes) -----

interface CLOpinionResponse {
  id?: number;
  plain_text?: string;
  html?: string;
  html_with_citations?: string;
  cluster?: string | { case_name?: string; absolute_url?: string };
}

export interface OpinionText {
  opinionId: string;
  caseName: string;
  url: string;
  plainText: string;
  hash: string;
}

import { createHash } from 'node:crypto';

export async function fetchOpinionText(opinionId: string): Promise<OpinionText | null> {
  const data = (await clFetch(`/opinions/${opinionId}/`)) as CLOpinionResponse;
  if (!data || !data.id) return null;
  const text = data.plain_text ?? stripHtml(data.html_with_citations ?? data.html ?? '');
  if (!text) return null;
  let caseName = 'Unknown';
  let url = `https://www.courtlistener.com/opinion/${data.id}/`;
  if (typeof data.cluster === 'object' && data.cluster) {
    caseName = data.cluster.case_name ?? caseName;
    if (data.cluster.absolute_url) {
      url = `https://www.courtlistener.com${data.cluster.absolute_url}`;
    }
  }
  return {
    opinionId: String(data.id),
    caseName,
    url,
    plainText: text,
    hash: createHash('sha256').update(text).digest('hex'),
  };
}

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
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}
