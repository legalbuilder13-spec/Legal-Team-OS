import { and, eq } from 'drizzle-orm';
import { userIntegrations, type Db } from '@legal/db';

// Encrypted storage helpers for per-user integration tokens. Uses pgcrypto
// (extension created in migration 0011) with a symmetric key from
// USER_INTEGRATIONS_KEY env var. If the key isn't set, encryption is a
// no-op and tokens are stored plaintext — operator should always set the
// key in production.
//
// Future per-user OAuth flows (Slack, Notion, Drive) will write to this
// table; context-fetch handlers prefer user-scoped tokens over workspace
// tokens when available.

export type IntegrationProvider = 'slack' | 'notion' | 'drive' | 'salesforce';

interface UserIntegrationToken {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  externalUserId: string | null;
  externalUserEmail: string | null;
  expiresAt: Date | null;
}

import { sql } from 'drizzle-orm';

function encryptionKey(): string | null {
  return process.env.USER_INTEGRATIONS_KEY ?? null;
}

export async function getUserToken(
  db: Db,
  userId: string,
  provider: IntegrationProvider,
): Promise<UserIntegrationToken | null> {
  const key = encryptionKey();
  const rows = await db
    .select({
      accessToken: key
        ? sql<string>`pgp_sym_decrypt(${userIntegrations.accessTokenEncrypted}, ${key})`
        : sql<string>`convert_from(${userIntegrations.accessTokenEncrypted}, 'UTF8')`,
      refreshToken: key
        ? sql<string | null>`CASE WHEN ${userIntegrations.refreshTokenEncrypted} IS NULL THEN NULL ELSE pgp_sym_decrypt(${userIntegrations.refreshTokenEncrypted}, ${key}) END`
        : sql<string | null>`CASE WHEN ${userIntegrations.refreshTokenEncrypted} IS NULL THEN NULL ELSE convert_from(${userIntegrations.refreshTokenEncrypted}, 'UTF8') END`,
      scope: userIntegrations.scope,
      externalUserId: userIntegrations.externalUserId,
      externalUserEmail: userIntegrations.externalUserEmail,
      expiresAt: userIntegrations.expiresAt,
    })
    .from(userIntegrations)
    .where(
      and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, provider)),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    // Token expired — caller is responsible for refresh, which isn't
    // implemented yet (depends on per-provider OAuth flows).
    return null;
  }
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    scope: row.scope,
    externalUserId: row.externalUserId,
    externalUserEmail: row.externalUserEmail,
    expiresAt: row.expiresAt,
  };
}

export async function setUserToken(
  db: Db,
  userId: string,
  provider: IntegrationProvider,
  token: {
    accessToken: string;
    refreshToken?: string | null;
    scope?: string | null;
    externalUserId?: string | null;
    externalUserEmail?: string | null;
    expiresAt?: Date | null;
  },
): Promise<void> {
  const key = encryptionKey();
  const encAccess = key
    ? sql<Buffer>`pgp_sym_encrypt(${token.accessToken}, ${key})`
    : sql<Buffer>`convert_to(${token.accessToken}, 'UTF8')`;
  const encRefresh = token.refreshToken
    ? key
      ? sql<Buffer>`pgp_sym_encrypt(${token.refreshToken}, ${key})`
      : sql<Buffer>`convert_to(${token.refreshToken}, 'UTF8')`
    : null;

  await db.execute(sql`
    INSERT INTO user_integrations (
      user_id, provider, access_token_encrypted, refresh_token_encrypted,
      scope, expires_at, external_user_id, external_user_email
    )
    VALUES (
      ${userId}, ${provider}, ${encAccess}, ${encRefresh},
      ${token.scope ?? null}, ${token.expiresAt ?? null},
      ${token.externalUserId ?? null}, ${token.externalUserEmail ?? null}
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      scope = EXCLUDED.scope,
      expires_at = EXCLUDED.expires_at,
      external_user_id = EXCLUDED.external_user_id,
      external_user_email = EXCLUDED.external_user_email,
      updated_at = now()
  `);
}

export async function deleteUserToken(
  db: Db,
  userId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await db
    .delete(userIntegrations)
    .where(
      and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, provider)),
    );
}
