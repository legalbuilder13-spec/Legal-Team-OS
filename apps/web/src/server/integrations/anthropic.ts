import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/env';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (_client) return _client;
  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export function getAnthropicModel(): string {
  return env.ANTHROPIC_MODEL;
}
