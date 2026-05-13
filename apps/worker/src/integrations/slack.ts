// Minimal Slack REST client for the worker. Reuses the SLACK_BOT_TOKEN
// already provisioned for the /legal intake bot — only requirement is
// adding the search:read bot scope to the existing Slack app.
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
    // added to the bot's scopes yet — surface that clearly.
    if (data.error === 'missing_scope') {
      throw new Error(
        'Slack search returned missing_scope — add search:read to the bot scopes and reinstall the app',
      );
    }
    throw new Error(`Slack search error: ${data.error ?? 'unknown'}`);
  }

  return {
    total: data.messages?.total ?? 0,
    matches: data.messages?.matches ?? [],
  };
}
