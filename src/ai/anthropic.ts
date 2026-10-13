// Adapter for the Anthropic Messages API, written against the official
// documentation as of October 2026: structured outputs through
// output_config.format (generally available, no beta header) and
// output_config.effort. It uses fetch directly, so no SDK is installed.
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import { ProviderError } from './provider.ts';
import type { ModelProvider, ModelReply, ModelRequest } from './provider.ts';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Replaced in tests. */
  fetchImpl?: typeof fetch;
}

function detail(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' ? ` (${message.slice(0, 200)})` : '';
}

export function createAnthropicProvider(options: AnthropicOptions): ModelProvider {
  const model = options.model || ANTHROPIC_DEFAULT_MODEL;
  const base = new URL(options.baseUrl || ANTHROPIC_DEFAULT_BASE_URL);
  const send = options.fetchImpl ?? fetch;

  return {
    location: 'online',
    name: 'Anthropic',
    model,
    host: base.host,
    async complete(request: ModelRequest): Promise<ModelReply> {
      let response: Response;
      try {
        response = await send(new URL('/v1/messages', base), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: request.messages,
            output_config: {
              // A short, tightly specified reply: moderate effort is enough and keeps it quick.
              effort: 'medium',
              format: { type: 'json_schema', schema: request.schema },
            },
          }),
          signal: request.signal,
        });
      } catch (cause) {
        if (request.signal.aborted) throw new ProviderError('timeout', 'The AI provider did not answer in time.');
        throw new ProviderError('unreachable', `Could not reach ${base.host}. Check the internet connection.`);
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        if (request.signal.aborted) throw new ProviderError('timeout', 'The AI provider did not answer in time.');
        if (response.ok) throw new ProviderError('bad_reply', 'The AI provider sent a reply that could not be read.');
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError('auth', `The AI provider refused the API key${detail(body)}. Check ANTHROPIC_API_KEY in your .env file.`);
        }
        if (response.status === 429) throw new ProviderError('rate_limited', `The AI provider is rate-limiting this key${detail(body)}. Try again shortly.`);
        throw new ProviderError('provider_error', `The AI provider answered with an error, status ${response.status}${detail(body)}.`);
      }

      const reply = body as {
        stop_reason?: unknown;
        content?: unknown;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      if (reply.stop_reason === 'refusal') throw new ProviderError('refused', 'The model declined to answer this request.');
      if (reply.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'The reply was cut off at the output limit, so it was discarded.');
      const blocks = Array.isArray(reply.content) ? (reply.content as { type?: unknown; text?: unknown }[]) : [];
      const text = blocks.find((block) => block.type === 'text' && typeof block.text === 'string')?.text;
      if (typeof text !== 'string') throw new ProviderError('bad_reply', 'The AI provider sent a reply with no text in it.');
      const tokens = (value: unknown) => (typeof value === 'number' ? value : null);
      return { text, inputTokens: tokens(reply.usage?.input_tokens), outputTokens: tokens(reply.usage?.output_tokens) };
    },
  };
}
