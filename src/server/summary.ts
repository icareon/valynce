import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { OfflineAi } from '../ai/local/offline.ts';
import { guidedUserMessage } from '../ai/prompt.ts';
import type { AiLocation, ModelProvider, OfflineStatus } from '../ai/provider.ts';
import { ProviderError } from '../ai/provider.ts';
import { generateSummary, InvalidSummaryError } from '../ai/summarize.ts';
import type { NcrStorage, StoredSummary } from '../core/storage.ts';
import { buildEvidence, MAX_EVIDENCE_CATEGORIES, MAX_EVIDENCE_RECORDS, MAX_EVIDENCE_TEXT, parseScope } from '../modules/quality/evidence.ts';
import type { AnalysisScope, EvidenceBundle, EvidenceResult } from '../modules/quality/evidence.ts';
import { LOCAL_MAX_PROMPT_CHARS, LOCAL_MAX_RECORDS, planGuided } from '../modules/quality/guidedSummary.ts';
import type { AiSummary } from '../modules/quality/summaryRules.ts';
import type { OfflineStatusResponse, RemoveSummaryResponse, SummaryCheckResponse, SummaryGenerateResponse, SummaryRecord } from './contract.ts';

export const DEFAULT_AI_TIMEOUT_MS = 60_000;
/** Longer than online: the first offline request also loads the model into memory. */
export const DEFAULT_OFFLINE_TIMEOUT_MS = 180_000;

/** What the offline model reads for each report. It is given no figures, statuses, dispositions or reported causes. */
export const OFFLINE_FIELDS = ['NCR ID', 'defect category', 'description'] as const;

export interface SummaryProviders {
  /** Null when no API key is configured. */
  online: ModelProvider | null;
  /** Null only in tests that do not involve it. */
  offline: OfflineAi | null;
  onlineTimeoutMs?: number;
  offlineTimeoutMs?: number;
}

/** Identifies one exact evidence bundle. Any change to what would be sent changes it. */
export function fingerprintOf(bundle: EvidenceBundle): string {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
}

const asRecord = (stored: StoredSummary): SummaryRecord => ({
  ...stored,
  scope: stored.scope as AnalysisScope,
  summary: stored.summary as AiSummary,
});

const NO_OFFLINE: OfflineStatus = {
  state: 'unsupported',
  model: { label: '', id: '', bytes: 0, source: '' },
  runtime: null,
  totalBytes: 0,
  step: null,
  receivedBytes: 0,
  message: 'Offline AI is not available in this build.',
  folder: '',
};

/** The evidence for one provider. The offline model takes fewer reports and less text; a larger selection is refused, never cut. */
function evidenceFor(storage: NcrStorage, scope: AnalysisScope, location: AiLocation): EvidenceResult {
  if (location === 'online') return buildEvidence(storage.list(), scope);
  const evidence = buildEvidence(storage.list(), scope, LOCAL_MAX_RECORDS);
  if (evidence.ok && guidedUserMessage(evidence.bundle, planGuided(evidence.bundle)).length > LOCAL_MAX_PROMPT_CHARS) {
    return {
      ok: false,
      reason: 'too_long',
      message: 'The descriptions in this selection are too long for the offline model to read in one request, and Valynce does not use a partial selection. Narrow it with the search or the status filter, or select one category in the chart.',
    };
  }
  return evidence;
}

export function registerSummaryRoutes(app: Hono, storage: NcrStorage, providers: SummaryProviders): void {
  const { online, offline } = providers;
  const timeouts = { online: providers.onlineTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS, offline: providers.offlineTimeoutMs ?? DEFAULT_OFFLINE_TIMEOUT_MS };
  const limit = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'The request is too large.' }, 413) });
  // One request at a time, whichever provider: a second click, or a second tab, cannot start another.
  let inFlight = false;

  const read = async (request: { json: () => Promise<unknown> }): Promise<{ scope: AnalysisScope; location: AiLocation; body: Record<string, unknown> } | string> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return 'The request is not valid JSON.';
    }
    if (typeof body !== 'object' || body === null) return 'The request is not an object.';
    const fields = body as Record<string, unknown>;
    const scope = parseScope(fields.scope);
    if (typeof scope === 'string') return scope;
    if (fields.location !== undefined && fields.location !== 'offline' && fields.location !== 'online') return 'The provider is not valid.';
    return { scope, location: fields.location === 'offline' ? 'offline' : 'online', body: fields };
  };

  // Says what a summary of this analysis would use and whether the stored one still matches.
  // It contacts nothing: not the provider, not the model, not a download server.
  app.post('/api/summary/check', limit, async (c) => {
    const request = await read(c.req);
    if (typeof request === 'string') return c.json({ error: request }, 400);
    const evidence = evidenceFor(storage, request.scope, request.location);
    // Whether the stored summary is outdated depends on the analysis, not on the provider selected now.
    const current = buildEvidence(storage.list(), request.scope);
    const fingerprint = current.ok ? fingerprintOf(current.bundle) : null;
    const latest = storage.latestSummary();
    const body: SummaryCheckResponse = {
      location: request.location,
      provider: online === null ? null : { name: online.name, model: online.model, host: online.host },
      offline: offline?.status() ?? NO_OFFLINE,
      offlineFields: [...OFFLINE_FIELDS],
      request: evidence.ok
        ? { ok: true, fingerprint: fingerprintOf(evidence.bundle), disclosure: evidence.disclosure, facts: evidence.facts }
        : { ok: false, reason: evidence.reason, message: evidence.message },
      limits: {
        records: request.location === 'offline' ? LOCAL_MAX_RECORDS : MAX_EVIDENCE_RECORDS,
        categories: MAX_EVIDENCE_CATEGORIES,
        textChars: MAX_EVIDENCE_TEXT,
        timeoutSeconds: Math.round(timeouts[request.location] / 1000),
      },
      latest: latest === null ? null : asRecord(latest),
      latestOutdated: latest !== null && latest.fingerprint !== fingerprint,
    };
    return c.json(body);
  });

  // Generates with the provider the user selected and confirmed, and with no other.
  // The online branch is the only code in Valynce that sends records outside this computer.
  app.post('/api/summary', limit, async (c) => {
    const request = await read(c.req);
    if (typeof request === 'string') return c.json({ error: request, code: 'bad_request' }, 400);
    const { location } = request;
    if (request.body.confirmed !== true) {
      return c.json({ error: location === 'online' ? 'Sending data to the AI provider was not confirmed.' : 'The summary was not confirmed.', code: 'not_confirmed' }, 400);
    }
    let provider: ModelProvider;
    if (location === 'online') {
      if (online === null) {
        return c.json({ error: 'No online AI provider is configured. Add ANTHROPIC_API_KEY to your .env file and restart Valynce.', code: 'no_key' }, 503);
      }
      provider = online;
    } else {
      const state = offline?.status().state;
      if (offline === null || state !== 'ready') {
        return c.json({ error: state === 'unsupported' ? (offline?.status().message ?? NO_OFFLINE.message) : 'Offline AI is not installed. Choose "Enable offline AI" first.', code: 'not_installed' }, 503);
      }
      provider = offline.provider();
    }
    const evidence = evidenceFor(storage, request.scope, location);
    if (!evidence.ok) return c.json({ error: evidence.message, code: evidence.reason }, 422);
    const fingerprint = fingerprintOf(evidence.bundle);
    if (request.body.fingerprint !== fingerprint) {
      return c.json({ error: 'The reports or the analysis changed after you reviewed this request. Review it again.', code: 'changed' }, 409);
    }
    if (inFlight) return c.json({ error: 'A summary is already being generated.', code: 'busy' }, 409);

    inFlight = true;
    const started = Date.now();
    // Stops at the time limit, or when the browser gives up or the user cancels.
    const signal = AbortSignal.any([AbortSignal.timeout(timeouts[location]), c.req.raw.signal]);
    try {
      const run = await generateSummary(provider, evidence.bundle, evidence.facts, signal);
      const stored = storage.saveSummary({
        location,
        provider: provider.name,
        model: provider.model,
        fingerprint,
        scope: request.scope,
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
        return c.json({ error: cause.message, code: cause.kind }, cause.kind === 'timeout' ? 504 : cause.kind === 'not_installed' ? 503 : 502);
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

  // ---------- offline AI set-up: each step happens only when the user asks ----------

  app.get('/api/ai/offline', (c) => c.json((offline?.status() ?? NO_OFFLINE) satisfies OfflineStatusResponse));

  // Starts the one download. The sizes were shown to the user before this is called.
  app.post('/api/ai/offline/install', (c) => c.json((offline?.install() ?? NO_OFFLINE) satisfies OfflineStatusResponse));

  app.post('/api/ai/offline/cancel', async (c) => c.json(((await offline?.cancel()) ?? NO_OFFLINE) satisfies OfflineStatusResponse));

  app.delete('/api/ai/offline', async (c) => {
    if (inFlight) return c.json({ error: 'A summary is being generated. Remove the files when it has finished.', code: 'busy' }, 409);
    return c.json(((await offline?.remove()) ?? NO_OFFLINE) satisfies OfflineStatusResponse);
  });
}
