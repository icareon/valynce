// One bounded request for a summary: a single call, checked against the
// evidence, with at most one repair call when the first reply fails a check.
// There is no loop, no tool use and no agent.
import type { EvidenceBundle } from '../modules/quality/evidence.ts';
import { planGuided, validateGuided } from '../modules/quality/guidedSummary.ts';
import { validateSummary } from '../modules/quality/summaryRules.ts';
import type { AiSummary } from '../modules/quality/summaryRules.ts';
import { GUIDED_SYSTEM_PROMPT, guidedSchema, guidedUserMessage, repairMessage, SUMMARY_SCHEMA, SUMMARY_SYSTEM_PROMPT, summaryUserMessage } from './prompt.ts';
import { ProviderError } from './provider.ts';
import type { ModelMessage, ModelProvider } from './provider.ts';

/** Thinking counts toward this, so it is well above the size of a valid reply. */
export const SUMMARY_MAX_OUTPUT_TOKENS = 4096;
/** A reply longer than this is discarded unread. */
export const SUMMARY_MAX_REPLY_CHARS = 12_000;
export const SUMMARY_MAX_CALLS = 2;

export interface SummaryRun {
  summary: AiSummary;
  /** Model calls made: 1, or 2 when a repair was needed. */
  attempts: number;
}

/** The reply failed its checks twice. `problems` are those of the last reply. */
export class InvalidSummaryError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super('The model did not return a summary that passes Valynce\'s checks.');
    this.name = 'InvalidSummaryError';
    this.problems = problems;
  }
}

function parse(text: string): unknown {
  if (text.length > SUMMARY_MAX_REPLY_CHARS) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Output limit for the shorter offline reply: an overview and two sentences. */
export const GUIDED_MAX_OUTPUT_TOKENS = 500;

export async function generateSummary(
  provider: ModelProvider,
  bundle: EvidenceBundle,
  facts: readonly string[],
  signal: AbortSignal,
): Promise<SummaryRun> {
  // The small offline model gets the shorter task; see guidedSummary.ts for why.
  const plan = provider.location === 'offline' ? planGuided(bundle) : null;
  const messages: ModelMessage[] = [{ role: 'user', content: plan === null ? summaryUserMessage(bundle) : guidedUserMessage(bundle, plan) }];
  let problems: string[] = [];
  for (let attempt = 1; attempt <= SUMMARY_MAX_CALLS; attempt += 1) {
    const reply = await provider.complete({
      system: plan === null ? SUMMARY_SYSTEM_PROMPT : GUIDED_SYSTEM_PROMPT,
      messages,
      schema: plan === null ? SUMMARY_SCHEMA : guidedSchema(plan),
      maxOutputTokens: plan === null ? SUMMARY_MAX_OUTPUT_TOKENS : GUIDED_MAX_OUTPUT_TOKENS,
      signal,
    });
    const parsed = parse(reply.text);
    const check =
      parsed === undefined
        ? { ok: false as const, problems: ['The reply was not one valid JSON object within the size limit.'] }
        : plan === null
          ? validateSummary(parsed, bundle, facts)
          : validateGuided(parsed, bundle, facts, plan);
    if (check.ok) return { summary: check.summary, attempts: attempt };
    problems = check.problems;
    // The model's own reply goes back to it only when it is small enough to be worth correcting.
    messages.push({ role: 'assistant', content: reply.text.slice(0, SUMMARY_MAX_REPLY_CHARS) || '{}' }, { role: 'user', content: repairMessage(problems) });
  }
  throw new InvalidSummaryError(problems);
}

export { ProviderError };
