// Minimal Google Drive REST client for the worker. Uses service-account
// JWT auth via Node's built-in crypto — no googleapis SDK dependency.
//
// JWT bearer flow:
// 1. Build a JWT { iss=client_email, scope=drive, aud=token endpoint,
//    iat=now, exp=now+1h }
// 2. Sign with RS256 using the service account private key
// 3. POST to oauth2.googleapis.com/token with grant_type=jwt-bearer
// 4. Use the returned access_token for Drive API calls
//
// Tokens are cached in-process for ~50 minutes (the OAuth token lifetime
// is 1h; we refresh a bit before expiry).

import { createSign } from 'node:crypto';

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _cachedToken: CachedToken | null = null;
let _cachedSvcAccount: ServiceAccountJson | null = null;

function parseServiceAccount(json: string): ServiceAccountJson | null {
  if (_cachedSvcAccount) return _cachedSvcAccount;
  try {
    const parsed = JSON.parse(json) as ServiceAccountJson;
    if (!parsed.client_email || !parsed.private_key) return null;
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    _cachedSvcAccount = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(svcJson: string): Promise<string | null> {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) {
    return _cachedToken.accessToken;
  }

  const svc = parseServiceAccount(svcJson);
  if (!svc) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: svc.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const claimsB64 = base64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${claimsB64}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(svc.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return _cachedToken.accessToken;
}

export interface DriveSearchHit {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  owner: string | null;
}

interface DriveSearchResponse {
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    modifiedTime?: string;
    owners?: Array<{ displayName?: string }>;
  }>;
}

export async function searchDrive(
  svcAccountJson: string,
  query: string,
  options: { folderId?: string; limit?: number } = {},
): Promise<DriveSearchHit[]> {
  const token = await getAccessToken(svcAccountJson);
  if (!token) return [];

  // Drive search query: full-text match + optionally scope to a folder.
  // Single quotes inside the query are escaped per Drive query syntax.
  const escaped = query.replace(/'/g, "\\'");
  const conditions = [`fullText contains '${escaped}'`, `trashed = false`];
  if (options.folderId) {
    conditions.push(`'${options.folderId}' in parents`);
  }
  const params = new URLSearchParams({
    q: conditions.join(' and '),
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName))',
    pageSize: String(options.limit ?? 10),
    orderBy: 'modifiedTime desc',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive search failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as DriveSearchResponse;
  return data.files.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    webViewLink: f.webViewLink ?? null,
    modifiedTime: f.modifiedTime ?? null,
    owner: f.owners?.[0]?.displayName ?? null,
  }));
}
