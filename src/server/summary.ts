import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ModelProvider } from '../ai/provider.ts';
import { ProviderError } from '../ai/provider.ts';
import { generateSummary, InvalidSummaryError } from '../ai/summarize.ts';
import type { NcrStorage, StoredSummary } from '../core/storage.ts';
import { buildEvidence, MAX_EVIDENCE_CATEGORIES, MAX_EVIDENCE_RECORDS, MAX_EVIDENCE_TEXT, parseScope } from '../modules/quality/evidence.ts';
import type { AnalysisScope, EvidenceBundle } from '../modules/quality/evidence.ts';
import type { AiSummary } from '../modules/quality/summaryRules.ts';
import type { RemoveSummaryResponse, SummaryCheckResponse, SummaryGenerateResponse, SummaryRecord } from './contract.ts';

export const DEFAULT_AI_TIMEOUT_MS = 60_000;

/** Identifies one exact evidence bundle. Any change to what would be sent changes it. */
export function fingerprintOf(bundle: EvidenceBundle): string {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
}

const asRecord = (stored: StoredSummary): SummaryRecord => ({
  ...stored,
  scope: stored.scope as AnalysisScope,
  summary: stored.summary as AiSummary,
});

export function registerSummaryRoutes(app: Hono, storage: NcrStorage, provider: ModelProvider | null, timeoutMs = DEFAULT_AI_TIMEOUT_MS): void {
  const limit = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'The request is too large.' }, 413) });
  // One request at a time: a second click, or a second tab, cannot send the data twice.
  let inFlight = false;

  const readScope = async (request: { json: () => Promise<unknown> }): Promise<{ scope: AnalysisScope; body: Record<string, unknown> } | string> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return 'The request is not valid JSON.';
    }
    if (typeof body !== 'object' || body === null) return 'The request is not an object.';
    const scope = parseScope((body as Record<string, unknown>).scope);
    return typeof scope === 'string' ? scope : { scope, body: body as Record<string, unknown> };
  };

  // Says what a summary of this analysis would send and whether the stored one still matches. Sends nothing.
  app.post('/api/summary/check', limit, async (c) => {
    const read = await readScope(c.req);
    if (typeof read === 'string') return c.json({ error: read }, 400);
    const evidence = buildEvidence(storage.list(), read.scope);
    const fingerprint = evidence.ok ? fingerprintOf(evidence.bundle) : null;
    const latest = storage.latestSummary();
    const body: SummaryCheckResponse = {
      provider: provider === null ? null : { name: provider.name, model: provider.model, host: provider.host },
      request: evidence.ok
        ? { ok: true, fingerprint: fingerprint!, disclosure: evidence.disclosure, facts: evidence.facts }
        : { ok: false, reason: evidence.reason, message: evidence.message },
      limits: { records: MAX_EVIDENCE_RECORDS, categories: MAX_EVIDENCE_CATEGORIES, textChars: MAX_EVIDENCE_TEXT, timeoutSeconds: Math.round(timeoutMs / 1000) },
      latest: latest === null ? null : asRecord(latest),
      latestOutdated: latest !== null && latest.fingerprint !== fingerprint,
    };
    return c.json(body);
  });

  // The only route that sends anything outside this computer, and only after the user confirmed it.
  app.post('/api/summary', limit, async (c) => {
    const read = await readScope(c.req);
    if (typeof read === 'string') return c.json({ error: read, code: 'bad_request' }, 400);
    if (read.body.confirmed !== true) {
      return c.json({ error: 'Sending data to the AI provider was not confirmed.', code: 'not_confirmed' }, 400);
    }
    if (provider === null) {
      return c.json({ error: 'No AI provider is configured. Add ANTHROPIC_API_KEY to your .env file and restart Valynce.', code: 'no_key' }, 503);
    }
    const evidence = buildEvidence(storage.list(), read.scope);
    if (!evidence.ok) return c.json({ error: evidence.message, code: evidence.reason }, 422);
    const fingerprint = fingerprintOf(evidence.bundle);
    if (read.body.fingerprint !== fingerprint) {
      return c.json({ error: 'The reports or the analysis changed after you reviewed what would be sent. Review it again before sending.', code: 'changed' }, 409);
    }
    if (inFlight) return c.json({ error: 'A summary is already being generated.', code: 'busy' }, 409);

    inFlight = true;
    const started = Date.now();
    try {
      const run = await generateSummary(provider, evidence.bundle, evidence.facts, AbortSignal.timeout(timeoutMs));
      const stored = storage.saveSummary({
        provider: provider.name,
        model: provider.model,
        fingerprint,
        scope: read.scope,
        facts: evidence.facts,
        recordIds: evidence.bundle.records.map((r) => r.id),
        summary: run.summary,
        durationMs: Date.now() - started,
        attempts: run.attempts,
      });
      const body: SummaryGenerateResponse = { summary: asRecord(stored) };
      return c.json(body);
    } catch (cause) {
      if (cause instanceof InvalidSummaryError) {
        return c.json(
          {
            error: 'The model did not return a summary that passes Valynce\'s checks, also after one correction. Nothing was saved.',
            code: 'invalid_output',
            problems: cause.problems.slice(0, 8),
          },
          502,
        );
      }
      if (cause instanceof ProviderError) {
        return c.json({ error: cause.message, code: cause.kind }, cause.kind === 'timeout' ? 504 : 502);
      }
      return c.json({ error: 'The summary could not be generated.', code: 'failed' }, 500);
    } finally {
      inFlight = false;
    }
  });

  app.delete('/api/summary/:id', (c) => {
    const id = Number(c.req.param('id'));
    const body: RemoveSummaryResponse = { deleted: Number.isInteger(id) && storage.deleteSummary(id) };
    return c.json(body, body.deleted ? 200 : 404);
  });
}
