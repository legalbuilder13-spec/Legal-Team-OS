# ACL passthrough pattern

PRD §14.1 requires that cross-system context queries respect each source's
access controls. This document describes how Legal Team OS handles ACLs
across the four integrated context sources, and the path from workspace-
scoped credentials (today) to per-user OAuth (future).

## Current state — workspace-scoped credentials

| Source | Credential | ACL boundary |
|---|---|---|
| Salesforce | OAuth password grant from a service account | Sees everything the service account can — typically org-wide read |
| Notion | Workspace integration token | Sees only pages explicitly shared with the integration in the Notion UI (`••• → Connections → Add`) |
| Slack | Bot token (existing intake bot, `search:read` scope) | Sees public channels + private channels where the bot is a member |
| Drive | Service-account JSON | Sees only files/folders shared with the service account's `client_email` |

This is good-enough for v2 first cut: Notion and Drive have natural ACL
boundaries via the share-with-integration flow; Slack via bot membership.
The service-account credential for Salesforce is the coarsest — any user
who sees a matter detail page sees whatever Salesforce returned, even if
the underlying account is normally restricted.

## InsightCard.permissionsContext

Every emitted `InsightCard` (`@legal/types`) carries a `permissionsContext`
field documenting which credentials were used:

```ts
{
  source: 'salesforce',
  fetchedAt: '...',
  staleAfter: '...',
  // ...
  permissionsContext: {
    scope: 'workspace:service-account', // | 'workspace:bot' | 'workspace:integration' | 'user:oauth'
    userId: '<uuid>',                    // populated when user-scoped
    acquiredAt: '<ISO8601>',
  }
}
```

The audit trail in `audit_log` carries the same metadata as the matter is
fetched. Future audit queries can answer: "show every matter where
counterparty X's data was fetched under user Y's credentials."

## Future — per-user OAuth flows

The `user_integrations` table (migration `0011_user_integrations.sql`)
provides encrypted-at-rest storage for per-user OAuth tokens. The
`apps/worker/src/integrations/tokens.ts` helper provides
`getUserToken / setUserToken / deleteUserToken` with `pgcrypto` encryption
gated on the `USER_INTEGRATIONS_KEY` env var.

When per-user OAuth lands, the handler change looks like this:

```ts
// Pseudocode for Slack handler after per-user OAuth is implemented
const matter = await db.query.matters.findFirst({ where: ... });
const requesterToken = matter.requesterId
  ? await getUserToken(db, matter.requesterId, 'slack')
  : null;

if (requesterToken) {
  // Use the requester's identity — Slack returns only what they can see
  result = await searchSlackMessages(requesterToken.accessToken, query);
  permissionsContext = {
    scope: 'user:oauth',
    userId: matter.requesterId,
    acquiredAt: new Date().toISOString(),
  };
} else {
  // Fall back to workspace bot token
  result = await searchSlackMessages(env.SLACK_BOT_TOKEN, query);
  permissionsContext = { scope: 'workspace:bot', acquiredAt: '...' };
}
```

The infrastructure (DB table, encrypted storage, audit field) ships in
C4. The per-source OAuth flows themselves are future PRs — one per
integration. They require:

1. Provider OAuth app registration (Slack/Notion/Drive workspace admin)
2. Web-side OAuth dance with redirect URI + token capture
3. UI for users to connect/disconnect each integration in their profile
4. Handler logic to prefer user tokens when available, fall back to
   workspace credentials

## Operator setup for encryption

To enable encryption-at-rest for user tokens:

```bash
# Generate a strong key (32 bytes, base64)
openssl rand -base64 32

# Set on web and worker services
railway variables -s web --set USER_INTEGRATIONS_KEY=<key>
railway variables -s worker --set USER_INTEGRATIONS_KEY=<key>
```

If the key isn't set, tokens are stored as raw bytes (UTF-8 encoded).
The `pgcrypto` extension is enabled regardless via the migration —
that's needed for `gen_random_uuid()` default values elsewhere too.

## Why no per-user OAuth in C4

Building four OAuth flows (Slack/Notion/Drive/Salesforce) plus the
profile-page UI is several days of work each, and the marginal benefit
over workspace-scoped credentials is modest at v2 scale. The scaffolding
(table + helper + audit trail) ships now so individual provider OAuth
PRs can land independently without re-litigating storage decisions.
