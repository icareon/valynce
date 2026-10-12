import { createAnthropicProvider } from './anthropic.ts';
import type { ModelProvider } from './provider.ts';

/**
 * The provider configured for this process, or null when no key is set.
 * The key is read from the environment and stays in this process: it is never
 * stored in the database, logged, or sent to the browser.
 */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): ModelProvider | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return createAnthropicProvider({
    apiKey,
    model: env.VALYNCE_AI_MODEL?.trim() || undefined,
    baseUrl: env.VALYNCE_AI_BASE_URL?.trim() || undefined,
  });
}
