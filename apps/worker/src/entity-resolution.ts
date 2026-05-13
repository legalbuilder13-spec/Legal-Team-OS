import { eq, sql } from 'drizzle-orm';
import { counterparties, entityAliases, type Db } from '@legal/db';

// Cross-system entity resolution. Tries to link a newly-extracted
// counterparty mention (name + optional domain) to an existing canonical
// counterparty row before creating a new one. Match strategies, in order:
//
//   1. Exact name match (case-insensitive)
//   2. Exact domain match
//   3. Exact alias match in entity_aliases
//   4. Trigram fuzzy match on canonical name (threshold 0.5)
//   5. Trigram fuzzy match on alias_text (threshold 0.5)
//
// Returns the matched counterparty + the strategy that matched, or null.

export type MatchStrategy =
  | 'exact_name'
  | 'exact_domain'
  | 'alias_exact'
  | 'name_trigram'
  | 'alias_trigram';

export interface ResolveResult {
  counterpartyId: string;
  matchedBy: MatchStrategy;
  similarity: number; // 1.0 for exact matches, [0, 1) for trigram
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

const TRIGRAM_THRESHOLD = 0.5;

export async function resolveCounterparty(
  db: Db,
  name: string | null,
  domain: string | null,
): Promise<ResolveResult | null> {
  if (!name && !domain) return null;

  if (name) {
    const normalized = normalize(name);

    // 1. Exact name match.
    const exact = await db.query.counterparties.findFirst({
      where: sql`lower(${counterparties.name}) = ${normalized}`,
    });
    if (exact) {
      return { counterpartyId: exact.id, matchedBy: 'exact_name', similarity: 1.0 };
    }

    // 3. Exact alias match.
    const aliasRow = await db
      .select({ counterpartyId: entityAliases.counterpartyId })
      .from(entityAliases)
      .where(sql`lower(${entityAliases.aliasText}) = ${normalized}`)
      .limit(1);
    if (aliasRow[0]) {
      return {
        counterpartyId: aliasRow[0].counterpartyId,
        matchedBy: 'alias_exact',
        similarity: 1.0,
      };
    }
  }

  // 2. Exact domain match (counterparties.domain).
  if (domain) {
    const normalizedDomain = normalize(domain);
    const byDomain = await db.query.counterparties.findFirst({
      where: sql`lower(${counterparties.domain}) = ${normalizedDomain}`,
    });
    if (byDomain) {
      return { counterpartyId: byDomain.id, matchedBy: 'exact_domain', similarity: 1.0 };
    }
  }

  // 4. Trigram fuzzy match on canonical name. similarity() is provided by
  //    pg_trgm (enabled in migration 0012).
  if (name) {
    const normalized = normalize(name);
    const fuzzyByName = await db.execute(sql`
      SELECT id, similarity(lower(name), ${normalized}) AS sim
      FROM counterparties
      WHERE similarity(lower(name), ${normalized}) > ${TRIGRAM_THRESHOLD}
      ORDER BY sim DESC
      LIMIT 1
    `);
    const top = (fuzzyByName as unknown as Array<{ id: string; sim: number }>)[0];
    if (top) {
      return {
        counterpartyId: top.id,
        matchedBy: 'name_trigram',
        similarity: Number(top.sim),
      };
    }

    // 5. Trigram fuzzy match on aliases.
    const fuzzyByAlias = await db.execute(sql`
      SELECT counterparty_id, similarity(lower(alias_text), ${normalized}) AS sim
      FROM entity_aliases
      WHERE similarity(lower(alias_text), ${normalized}) > ${TRIGRAM_THRESHOLD}
      ORDER BY sim DESC
      LIMIT 1
    `);
    const topAlias = (fuzzyByAlias as unknown as Array<{ counterparty_id: string; sim: number }>)[0];
    if (topAlias) {
      return {
        counterpartyId: topAlias.counterparty_id,
        matchedBy: 'alias_trigram',
        similarity: Number(topAlias.sim),
      };
    }
  }

  return null;
}

// Helper: record a new alias for an existing counterparty. Idempotent via
// the unique index on (counterparty_id, alias_text).
export async function recordAlias(
  db: Db,
  counterpartyId: string,
  aliasText: string,
  aliasSource: string,
  confidence?: number,
): Promise<void> {
  await db
    .insert(entityAliases)
    .values({
      counterpartyId,
      aliasText: aliasText.trim(),
      aliasSource,
      confidence: confidence?.toFixed(3),
    })
    .onConflictDoNothing();
}
