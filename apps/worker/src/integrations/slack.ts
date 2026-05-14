// Minimal Slack REST client for the worker. Uses SLACK_USER_TOKEN because
// search.messages is a user-token-only API method — bot tokens can't
// search regardless of scopes (Slack API design choice).
//
// Operator steps for the existing Legal Team OS Slack app:
// 1. OAuth & Permissions → User Token Scopes (NOT Bot Token Scopes!) →
//    add 'search:read'
// 2. Reinstall to Workspace
// 3. Copy the 'User OAuth Token' (xoxp-...) — different from the bot
//    token (xoxb-...)
// 4. Set as SLACK_USER_TOKEN on the worker service
//
// ACL note: search runs under the installer's identity (Marco). Returns
// only messages Marco has access to — public channels + private channels
// he's a member of + DMs he's in. Behaves like Marco running a search
// in the Slack UI.
//
// API docs: https://api.slack.com/methods/search.messages

const SLACK_API = 'https://slack.com/api';

export interface SlackSearchMatch {
  ts: string;
  channel: { id: string; name: string };
  user: string;
  text: string;
  permalink: string;
  iid?: string;
}

interface SlackSearchResponse {
  ok: boolean;
  error?: string;
  messages?: {
    total: number;
    matches: SlackSearchMatch[];
  };
}

export interface SlackSearchResult {
  total: number;
  matches: SlackSearchMatch[];
}

export async function searchSlackMessages(
  botToken: string,
  query: string,
  limit = 10,
): Promise<SlackSearchResult> {
  const params = new URLSearchParams({
    query,
    count: String(limit),
    sort: 'timestamp',
    sort_dir: 'desc',
  });

  const res = await fetch(`${SLACK_API}/search.messages?${params}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${botToken}` },
  });

  if (!res.ok) {
    throw new Error(`Slack search HTTP ${res.status}`);
  }
  const data = (await res.json()) as SlackSearchResponse;
  if (!data.ok) {
    // missing_scope is the expected error when search:read hasn't been
    // added to the user scopes yet — surface that clearly. Note: this is
    // a USER scope, not a bot scope. Bots cannot call search.messages.
    if (data.error === 'missing_scope') {
      throw new Error(
        'Slack search returned missing_scope — add search:read to User Token Scopes (not Bot Token Scopes), reinstall, and use the resulting xoxp- user token',
      );
    }
    // not_allowed_token_type fires if you pass a bot token (xoxb-) instead
    // of a user token (xoxp-) to search.messages.
    if (data.error === 'not_allowed_token_type') {
      throw new Error(
        'Slack search returned not_allowed_token_type — pass a user token (xoxp-) not a bot token (xoxb-)',
      );
    }
    throw new Error(`Slack search error: ${data.error ?? 'unknown'}`);
  }

  return {
    total: data.messages?.total ?? 0,
    matches: data.messages?.matches ?? [],
  };
}
