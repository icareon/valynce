// The evaluation set for the AI summary. Every model reply here is scripted, so
// these tests show what Valynce accepts, rejects and stores. They do not show
// that a real model behaves well; scripts/ai-live-check.mjs is for that.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createAnthropicProvider } from '../src/ai/anthropic.ts';
import { providerFromEnv } from '../src/ai/config.ts';
import { summaryUserMessage } from '../src/ai/prompt.ts';
import { ProviderError } from '../src/ai/provider.ts';
import type { ModelProvider, ModelRequest } from '../src/ai/provider.ts';
import { NcrStorage } from '../src/core/storage.ts';
import { buildEvidence, MAX_EVIDENCE_RECORDS, MAX_EVIDENCE_TEXT } from '../src/modules/quality/evidence.ts';
import type { AnalysisScope, EvidenceResult } from '../src/modules/quality/evidence.ts';
import { validateSummary } from '../src/modules/quality/summaryRules.ts';
import type { AiSummary } from '../src/modules/quality/summaryRules.ts';
import { createApp } from '../src/server/app.ts';
import type { SummaryCheckResponse, SummaryGenerateResponse } from '../src/server/contract.ts';

const root = resolve(import.meta.dirname, '..');
const FILE = readFileSync(join(root, 'fixtures', 'ai-eval.csv'), 'utf8');
const SECRET = 'test-key-that-must-never-appear';

type Script = (request: ModelRequest, call: number) => Promise<string> | string;

/** A provider whose replies are scripted. It records every request it was given. */
function scripted(script: Script) {
  const requests: ModelRequest[] = [];
  const provider: ModelProvider = {
    name: 'Test provider',
    model: 'test-model',
    host: 'provider.test',
    async complete(request) {
      requests.push(request);
      return { text: await script(request, requests.length), inputTokens: null, outputTokens: null };
    },
  };
  return { provider, requests };
}

async function setup(script?: Script, aiTimeoutMs?: number) {
  const storage = new NcrStorage(':memory:');
  const model = script === undefined ? null : scripted(script);
  const app = createApp({ storage, loadSample: () => [], uiDir: join(root, 'tests', 'no-ui-here'), ai: model?.provider ?? null, aiTimeoutMs });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const imported = await post('/api/import/commit', { fileName: 'ai-eval.csv', text: FILE });
  assert.equal(imported.status, 200);
  const check = async (scope: AnalysisScope) => (await (await post('/api/summary/check', { scope })).json()) as SummaryCheckResponse;
  const generate = async (scope: AnalysisScope, overrides: Record<string, unknown> = {}) => {
    const state = await check(scope);
    const fingerprint = state.request.ok ? state.request.fingerprint : '';
    return post('/api/summary', { scope, fingerprint, confirmed: true, ...overrides });
  };
  return { storage, app, post, check, generate, requests: model?.requests ?? [] };
}

const COST: AnalysisScope = { metric: 'cost', unit: null, search: '' };
const COUNT: AnalysisScope = { metric: 'count', unit: null, search: '' };
const PIECES: AnalysisScope = { metric: 'quantity', unit: null, search: '' };

const GOOD: AiSummary = {
  overview: 'Recorded cost in USD is concentrated in the Material category, which rests on a single report. Several reports have no cost recorded.',
  findings: [
    { kind: 'fact', statement: 'The Material cost comes from one report of a wrong alloy delivery, recorded at 850.00.', recordIds: ['AE-006'] },
    { kind: 'hypothesis', statement: 'The two closed labeling reports may share a labeling process step, which could be checked.', recordIds: ['AE-001', 'AE-002'] },
  ],
  missingInformation: ['Three reports have no cost, and one cost in another currency is not in the ranking.'],
  nextSteps: ['Review AE-006 with the receiving inspection records.'],
};

function evidence(scope: AnalysisScope, storage: NcrStorage): Extract<EvidenceResult, { ok: true }> {
  const result = buildEvidence(storage.list(), scope);
  assert.ok(result.ok);
  return result;
}

// ---------- correct totals and what is sent ----------

test('the evidence has the same totals as the ranking, worked out by hand from the fixture', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(COST, storage);
  // USD costs in the file: 30 + 40 + 10 + 25 + 850 = 955.00 in 5 of 9 reports.
  assert.equal(bundle.total, '955.00');
  assert.equal(bundle.populationReports, 9);
  assert.deepEqual(bundle.coverage, { rankedReports: 5, notRecorded: 3, costInAnotherOrNoCurrency: 1, quantityInOtherUnits: [] });
  assert.deepEqual(
    bundle.categories.map((c) => [c.rank, c.category, c.value, c.sharePercent, c.cumulativePercent, c.contributingReports, c.reportsInCategory]),
    [
      [1, 'Material', '850.00', '89.01', '89.01', 1, 3],
      [2, 'Labeling', '70.00', '7.33', '96.34', 2, 3],
      [3, 'Dimensional', '35.00', '3.66', '100.00', 2, 2],
    ],
  );
  assert.ok(facts.some((f) => f.includes('Total: $955.00 from 5 of 9 reports.') && f.includes('1 report with a cost in another currency or with no currency stated') && f.includes('3 reports with no cost')));
  assert.ok(facts.some((f) => f.startsWith('1. Material: $850.00, 89.0% of the total, from 1 report.')));
});

test('missing and excluded costs are stated per report and never sent as zero or converted', async () => {
  const { storage } = await setup();
  const byId = new Map(evidence(COST, storage).bundle.records.map((r) => [r.id, r]));
  assert.deepEqual([byId.get('AE-003')!.value, byId.get('AE-003')!.valueStatus], [null, 'not_recorded']);
  assert.deepEqual([byId.get('AE-007')!.value, byId.get('AE-007')!.valueStatus], [null, 'cost_in_another_or_no_currency']);
  assert.deepEqual([byId.get('AE-006')!.value, byId.get('AE-006')!.valueStatus], ['850.00', 'recorded']);
  // The euro amount is not in the request at all.
  assert.ok(!summaryUserMessage(evidence(COST, storage).bundle).includes('300'));
});

test('quantities in different units stay apart in the evidence', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(PIECES, storage);
  // Pieces: 5 + 5 + 6 + 20 + 50 + 80 + 4 = 170 in 7 reports; 2.5 kg is a different unit; AE-009 has none.
  assert.equal(bundle.total, '170');
  assert.deepEqual(bundle.coverage, { rankedReports: 7, notRecorded: 1, costInAnotherOrNoCurrency: 0, quantityInOtherUnits: [{ unit: 'kg', reports: 1 }] });
  const kg = bundle.records.find((r) => r.id === 'AE-007')!;
  assert.deepEqual([kg.value, kg.valueStatus], [null, 'quantity_in_another_unit']);
  assert.ok(facts.some((f) => f.includes('Total: 170 units from 7 of 9 reports.') && f.includes('1 report with a quantity in kg')));

  const inKg = evidence({ metric: 'quantity', unit: 'kg', search: '' }, storage).bundle;
  assert.equal(inKg.total, '2.5');
  assert.equal(inKg.metric.unit, 'kg');
  assert.deepEqual(inKg.coverage.quantityInOtherUnits, [{ unit: 'units', reports: 7 }]);
});

test('supplier, part number, original cells and file details are never in the request', async () => {
  const { storage } = await setup();
  for (const scope of [COUNT, PIECES, COST]) {
    const message = summaryUserMessage(evidence(scope, storage).bundle);
    for (const withheld of ['Synthetic Supplier', 'AE-100', 'AE-300', 'ai-eval.csv', 'NCR No', 'Vendor', 'sourceValues']) {
      assert.ok(!message.includes(withheld), `${withheld} was sent for ${scope.metric}`);
    }
  }
  // A metric that is not being ranked is not sent either.
  assert.ok(!summaryUserMessage(evidence(COUNT, storage).bundle).includes('850'));
});

test('a selection over the limit is refused, not cut short, and a long text is marked as shortened', () => {
  const storage = new NcrStorage(':memory:');
  const record = (n: number, description: string) => ({
    ncrNumber: `BIG-${String(n).padStart(4, '0')}`, openedOn: null, partNumber: null, supplier: null, defectCategory: n % 2 === 0 ? 'Even' : 'Odd',
    description, quantityAffected: null, quantityUnit: null, costCents: null, currency: null, status: null, disposition: null, reportedCause: null,
  });
  storage.insertMany(Array.from({ length: MAX_EVIDENCE_RECORDS + 1 }, (_, i) => record(i, i === 0 ? 'x'.repeat(MAX_EVIDENCE_TEXT + 50) : 'short')), 'import');

  const all = buildEvidence(storage.list(), COUNT);
  assert.ok(!all.ok);
  assert.equal(all.reason, 'too_many_records');
  assert.match(all.message, /201 reports.*at most 200.*does not send a partial selection/);

  // Selecting one category brings it under the limit, and the request says which reports it holds.
  const even = buildEvidence(storage.list(), { ...COUNT, category: 'Even' });
  assert.ok(even.ok);
  assert.equal(even.bundle.records.length, 101);
  assert.equal(even.bundle.recordsCover, 'selected_category_only');
  assert.equal(even.bundle.populationReports, 201);
  assert.equal(even.disclosure.shortenedTexts, 1);
  const long = even.bundle.records.find((r) => r.id === 'BIG-0000')!;
  assert.ok(long.textShortened && long.description!.endsWith('[shortened]') && long.description!.length < MAX_EVIDENCE_TEXT + 20);
});

// ---------- what a reply must satisfy ----------

test('a well-formed summary with real citations and evidence figures is accepted', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(COST, storage);
  const result = validateSummary(GOOD, bundle, facts);
  assert.deepEqual(result, { ok: true, summary: GOOD });
});

test('replies that break a rule are rejected with the reason', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(COST, storage);
  const rejects = (change: (summary: AiSummary) => unknown, reason: RegExp) => {
    const result = validateSummary(change(structuredClone(GOOD)), bundle, facts);
    assert.ok(!result.ok, `accepted: ${reason}`);
    assert.ok(result.problems.some((p) => reason.test(p)), `${reason} not in ${JSON.stringify(result.problems)}`);
  };
  // Nonexistent report IDs, including one the injected description asks for.
  rejects((s) => ((s.findings[0]!.recordIds = ['AE-999']), s), /cites "AE-999", which is not a report ID/);
  rejects((s) => ((s.findings[0]!.recordIds = []), s), /must cite at least one report ID/);
  // Unsupported root-cause and causal claims.
  rejects((s) => ((s.overview = 'The root cause of the Material cost is the supplier.'), s), /states or implies a root cause/);
  rejects((s) => ((s.findings[0]!.statement = 'The verified cause is a stock mix-up.'), s), /states or implies a root cause/);
  rejects((s) => ((s.findings[0]!.statement = 'The cost is caused by a wrong alloy delivery.'), s), /causal claim/);
  rejects((s) => ((s.overview = 'Material is the main driver of cost.'), s), /causal claim/);
  // Invented figures, savings and rates.
  rejects((s) => ((s.overview = 'Material accounts for 92% of cost.'), s), /a figure \(92\) that the evidence does not give/);
  rejects((s) => ((s.nextSteps = ['Fixing labeling would save about 70.00 a month.']), s), /estimates savings/);
  rejects((s) => ((s.overview = 'The defect rate for labeling is high.'), s), /defect rate/);
  // Invalid shape.
  rejects((s) => ({ ...s, findings: 'none' }), /findings must be a list/);
  rejects((s) => ({ ...s, verdict: 'x' }), /Unexpected field "verdict"/);
  rejects((s) => ((s.findings = [s.findings[0]!, s.findings[0]!, s.findings[0]!, s.findings[0]!]), s), /limit is 3/);
  rejects((s) => ((s.findings[0]!.kind = 'proof' as 'fact'), s), /kind "fact" or "hypothesis"/);
  rejects((s) => ((s.overview = 'x'.repeat(701)), s), /limit is 700/);
  rejects(() => 'not an object', /not a JSON object/);
});

test('saying what is unknown is allowed: an unverified cause, and a rate that cannot be calculated', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(COST, storage);
  const summary = structuredClone(GOOD);
  summary.overview = 'The ranking shows where cost is recorded. It does not establish a root cause.';
  summary.missingInformation = ['No production quantities are given, so a defect rate cannot be calculated.', 'The reported cause on AE-006 is not verified.'];
  assert.ok(validateSummary(summary, bundle, facts).ok, JSON.stringify(validateSummary(summary, bundle, facts)));
});

test('a figure must belong to the report or category its sentence is about, not merely appear in the evidence', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(COST, storage);
  const check = (change: (summary: AiSummary) => void) => {
    const summary = structuredClone(GOOD);
    change(summary);
    return validateSummary(summary, bundle, facts);
  };
  const rejects = (change: (summary: AiSummary) => void, reason: RegExp) => {
    const result = check(change);
    assert.ok(!result.ok, `accepted: ${reason}`);
    assert.ok(result.problems.some((p) => reason.test(p)), `${reason} not in ${JSON.stringify(result.problems)}`);
  };
  const accepts = (change: (summary: AiSummary) => void) => {
    const result = check(change);
    assert.ok(result.ok, JSON.stringify(result));
  };
  // 850.00 is in the evidence, as the cost of AE-006 and of Material. It is not the cost of AE-001 or of Labeling.
  accepts((s) => (s.findings[0] = { kind: 'fact', statement: 'AE-006 records a cost of 850.00.', recordIds: ['AE-006'] }));
  rejects((s) => (s.findings[0] = { kind: 'fact', statement: 'AE-001 records a cost of 850.00.', recordIds: ['AE-001'] }), /Finding 1 contains a figure \(850\)/);
  rejects((s) => (s.findings[0] = { kind: 'fact', statement: 'The cost on this report is 850.00.', recordIds: ['AE-001'] }), /Finding 1 contains a figure \(850\)/);
  rejects((s) => (s.overview = 'Labeling holds 850.00 of recorded cost.'), /The overview contains a figure \(850\)/);
  accepts((s) => (s.overview = 'Labeling holds 70.00 of recorded cost, from 2 reports.'));
  // A sentence that names no report is about the cited one. This one is from a live reply.
  const quantity = evidence(PIECES, storage);
  const pronoun = { kind: 'fact' as const, statement: 'The description of AE-008 is not a description of a defect. It still contributes its recorded quantity of 4 units to Material.', recordIds: ['AE-008'] };
  assert.ok(validateSummary({ ...GOOD, overview: 'Material is first.', findings: [pronoun], missingInformation: [] }, quantity.bundle, quantity.facts).ok);
  const other = { ...pronoun, statement: 'AE-006 is in Material. AE-008 contributes 80 units to it.', recordIds: ['AE-006', 'AE-008'] };
  assert.ok(!validateSummary({ ...GOOD, overview: 'Material is first.', findings: [other], missingInformation: [] }, quantity.bundle, quantity.facts).ok);
  // One report's value is not a figure for the analysis as a whole.
  rejects((s) => (s.overview = 'The largest single cost is 850.00, and the smallest is 10.00.'), /The overview contains a figure \(10\)/);
  // A share belongs to its category and is not interchangeable with a count: Material is 89.0% from 1 report.
  accepts((s) => (s.overview = 'Material holds 89.0% of the recorded cost.'));
  rejects((s) => (s.overview = 'Labeling holds 89.0% of the recorded cost.'), /The overview contains a figure \(89\)/);
  rejects((s) => (s.overview = 'Material holds 1% of the recorded cost.'), /The overview contains a figure \(1\)/);
  rejects((s) => (s.overview = 'Material has 89 reports.'), /The overview contains a figure \(89\)/);
  // Figures for the whole analysis may stand anywhere: 5 of 9 reports are ranked, the total is 955.00.
  accepts((s) => (s.overview = 'The ranking covers 5 of 9 reports and a total of 955.00.'));
});

test('a finding must cite the reports and categories it names, and a report that has the cause it speaks of', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence(COST, storage);
  const check = (finding: AiSummary['findings'][number]) => validateSummary({ ...GOOD, findings: [finding] }, bundle, facts);
  const rejects = (finding: AiSummary['findings'][number], reason: RegExp) => {
    const result = check(finding);
    assert.ok(!result.ok, `accepted: ${reason}`);
    assert.ok(result.problems.some((p) => reason.test(p)), `${reason} not in ${JSON.stringify(result.problems)}`);
  };
  // AE-001 is a real report, so the ID alone passes. It is not the report the sentence is about.
  rejects({ kind: 'fact', statement: 'AE-006 was returned to the supplier.', recordIds: ['AE-001'] }, /names AE-006 in its statement without citing it/);
  rejects({ kind: 'fact', statement: 'Labeling ranks second by recorded cost.', recordIds: ['AE-006'] }, /is about Labeling but cites no report in that category/);
  // A comparison may rest on one side's reports. This one is from a live reply.
  assert.ok(check({ kind: 'fact', statement: 'Labeling has three reports (AE-001, AE-002, AE-003), tied with Material for the highest count.', recordIds: ['AE-001', 'AE-002', 'AE-003'] }).ok);
  assert.ok(check({ kind: 'fact', statement: 'Labeling ranks second by recorded cost.', recordIds: ['AE-002'] }).ok);
  // AE-005 states no cause; AE-004 does.
  rejects({ kind: 'fact', statement: 'The reported cause is a worn drill.', recordIds: ['AE-005'] }, /speaks of a reported cause, but none of the reports it cites has one/);
  assert.ok(check({ kind: 'fact', statement: 'The reported cause is a worn drill.', recordIds: ['AE-004'] }).ok);
  assert.ok(check({ kind: 'fact', statement: 'No reported cause is written on this report.', recordIds: ['AE-005'] }).ok);
});

test('a fact may say that a cause is not verified, and a gap may ask for a verified cause', async () => {
  const { storage } = await setup();
  const { bundle, facts } = evidence({ ...COST, category: 'Material' }, storage);
  // Both sentences come from a live reply that an earlier version rejected.
  const summary: AiSummary = {
    ...GOOD,
    findings: [
      {
        kind: 'fact',
        statement: 'AE-006 (wrong alloy delivered, closed, return to supplier) holds the only recorded Material cost, 850.00 USD. The report gives its reported cause as a stock mix-up at supplier, which is what the report says and not a verified cause.',
        recordIds: ['AE-006'],
      },
    ],
    missingInformation: ['Any verified cause analysis for the Material reports.', 'A verified cause for any of the reports; reportedCause is only filled in for AE-006.'],
  };
  const result = validateSummary(summary, bundle, facts);
  assert.ok(result.ok, JSON.stringify(result));
  for (const gap of ['The root cause is operator error.', 'Operator error was the verified cause of the Material reports.']) {
    const claim = validateSummary({ ...summary, missingInformation: [gap] }, bundle, facts);
    assert.ok(!claim.ok && claim.problems.some((p) => /states or implies a root cause/.test(p)), gap);
  }
  // The denial has to be about the cause. A claim followed by an unrelated "not" is still a claim.
  for (const statement of ['The root cause is a stock mix-up, not a worn drill.', 'The verified cause is a stock mix-up.', 'Operators did not check the alloy, and the root cause is the supplier.']) {
    const claim = validateSummary({ ...summary, findings: [{ kind: 'fact', statement, recordIds: ['AE-006'] }] }, bundle, facts);
    assert.ok(!claim.ok && claim.problems.some((p) => /states or implies a root cause/.test(p)), statement);
  }
});

// ---------- the request, end to end with a scripted model ----------

test('nothing is sent without confirmation, a key, or an unchanged analysis', async () => {
  const { generate, post, requests } = await setup(() => JSON.stringify(GOOD));
  const unconfirmed = await generate(COST, { confirmed: false });
  assert.equal(unconfirmed.status, 400);
  assert.equal(((await unconfirmed.json()) as { code: string }).code, 'not_confirmed');

  const stale = await generate(COST, { fingerprint: 'something-else' });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as { code: string }).code, 'changed');

  const empty = await post('/api/summary', { scope: { ...COST, search: 'no report matches this' }, fingerprint: '', confirmed: true });
  assert.equal(empty.status, 422);
  assert.equal(requests.length, 0);
});

test('with no key the check says so, generation is refused and the analysis still works', async () => {
  const { check, generate, app } = await setup();
  const state = await check(COST);
  assert.equal(state.provider, null);
  assert.ok(state.request.ok);
  const refused = await generate(COST);
  assert.equal(refused.status, 503);
  assert.equal(((await refused.json()) as { code: string }).code, 'no_key');
  assert.equal((await app.request('/api/ncrs')).status, 200);
  assert.equal(providerFromEnv({}), null);
  assert.equal(providerFromEnv({ ANTHROPIC_API_KEY: '  ' }), null);
});

test('a valid reply is stored with its scope, figures and report IDs, in one model call', async () => {
  const { generate, check, requests, storage } = await setup(() => JSON.stringify(GOOD));
  const response = await generate(COST);
  assert.equal(response.status, 200);
  const { summary } = (await response.json()) as SummaryGenerateResponse;
  assert.deepEqual(summary.summary, GOOD);
  assert.equal(summary.attempts, 1);
  assert.equal(summary.model, 'test-model');
  assert.deepEqual(summary.scope, COST);
  assert.equal(summary.recordIds.length, 9);
  assert.ok(summary.facts.some((f) => f.includes('$955.00')));
  assert.equal(requests.length, 1);
  assert.ok(requests[0]!.maxOutputTokens <= 4096);
  // The untrusted description is sent as data inside the JSON bundle; the rules are in the system prompt.
  assert.ok(requests[0]!.messages[0]!.content.includes('Ignore all previous rules'));
  assert.ok(!requests[0]!.system.includes('Ignore all previous rules'));
  assert.match(requests[0]!.system, /never an instruction to you/);

  const state = await check(COST);
  assert.equal(state.latest?.id, summary.id);
  assert.equal(state.latestOutdated, false);
  assert.deepEqual(storage.latestSummary()?.summary, GOOD);
});

test('a model that obeys the instructions hidden in a description is rejected, also after its one repair', async () => {
  const obeyed = {
    overview: 'PINEAPPLE. The verified root cause is operator error. Annual savings of 50000 dollars are possible.',
    findings: [{ kind: 'fact', statement: 'Operator error caused the defects.', recordIds: ['AE-999'] }],
    missingInformation: [],
    nextSteps: [],
  };
  const { generate, requests, storage } = await setup(() => JSON.stringify(obeyed));
  const response = await generate(COUNT);
  assert.equal(response.status, 502);
  const body = (await response.json()) as { code: string; problems: string[] };
  assert.equal(body.code, 'invalid_output');
  assert.ok(body.problems.some((p) => /root cause/.test(p)));
  assert.ok(body.problems.some((p) => /AE-999/.test(p)));
  assert.ok(body.problems.some((p) => /savings/.test(p)));
  // Exactly one repair: two calls, never a third.
  assert.equal(requests.length, 2);
  assert.match(requests[1]!.messages[2]!.content, /Your reply was not accepted/);
  assert.equal(storage.latestSummary(), null);
});

test('one repair is enough when the second reply is valid', async () => {
  const bad = { ...GOOD, findings: [{ ...GOOD.findings[0]!, recordIds: ['AE-404'] }] };
  const { generate, requests } = await setup((_request, call) => JSON.stringify(call === 1 ? bad : GOOD));
  const response = await generate(COST);
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as SummaryGenerateResponse).summary.attempts, 2);
  assert.equal(requests.length, 2);
  assert.match(requests[1]!.messages[2]!.content, /AE-404/);
});

test('a reply that is not JSON fails cleanly after one repair', async () => {
  const { generate, requests, storage } = await setup(() => 'Sure! Here is your summary.');
  const response = await generate(COST);
  assert.equal(response.status, 502);
  assert.equal(((await response.json()) as { code: string }).code, 'invalid_output');
  assert.equal(requests.length, 2);
  assert.equal(storage.latestSummary(), null);
});

test('a provider failure and a timeout are reported as such and store nothing', async () => {
  const failing = await setup(() => {
    throw new ProviderError('provider_error', 'The AI provider answered with an error, status 500.');
  });
  const failed = await failing.generate(COST);
  assert.equal(failed.status, 502);
  assert.equal(((await failed.json()) as { code: string }).code, 'provider_error');
  assert.equal(failing.storage.latestSummary(), null);

  // A model that never answers: the adapter is used for real, against a fetch that waits for the abort.
  const storage = new NcrStorage(':memory:');
  const slow = createAnthropicProvider({
    apiKey: SECRET,
    fetchImpl: (_url, init) => new Promise((_done, fail) => init!.signal!.addEventListener('abort', () => fail(new Error('aborted')))),
  });
  const app = createApp({ storage, loadSample: () => [], uiDir: join(root, 'tests', 'no-ui-here'), ai: slow, aiTimeoutMs: 40 });
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/import/commit', { fileName: 'ai-eval.csv', text: FILE });
  const state = (await (await post('/api/summary/check', { scope: COST })).json()) as SummaryCheckResponse;
  assert.ok(state.request.ok);
  const timedOut = await post('/api/summary', { scope: COST, fingerprint: state.request.fingerprint, confirmed: true });
  assert.equal(timedOut.status, 504);
  const body = (await timedOut.json()) as { code: string; error: string };
  assert.equal(body.code, 'timeout');
  assert.ok(!JSON.stringify(body).includes(SECRET));
  assert.equal(storage.latestSummary(), null);
});

test('a second request while one is running is refused, so the data is not sent twice', async () => {
  let release: (text: string) => void = () => undefined;
  const { generate, check, requests } = await setup(() => new Promise<string>((done) => (release = done)));
  const state = await check(COST);
  assert.ok(state.request.ok);
  const first = generate(COST);
  await new Promise((done) => setTimeout(done, 20));
  const second = await generate(COST);
  assert.equal(second.status, 409);
  assert.equal(((await second.json()) as { code: string }).code, 'busy');
  release(JSON.stringify(GOOD));
  assert.equal((await first).status, 200);
  assert.equal(requests.length, 1);
});

test('a summary is marked outdated when the metric, the filter or the records change', async () => {
  const { generate, check, post, storage } = await setup(() => JSON.stringify(GOOD));
  assert.equal((await generate(COST)).status, 200);
  assert.equal((await check(COST)).latestOutdated, false);
  assert.equal((await check(COUNT)).latestOutdated, true);
  assert.equal((await check({ ...COST, status: 'Closed' })).latestOutdated, true);
  assert.equal((await check({ ...COST, category: 'Material' })).latestOutdated, true);
  assert.equal((await check({ ...COST, search: 'label' })).latestOutdated, true);

  // New records arrive: the same scope no longer describes the same evidence.
  const more = await post('/api/import/commit', {
    fileName: 'more.csv',
    text: 'NCR No,Defect Type,Issue,Cost,Currency\nAE-100X,Material,Second wrong alloy delivery,100.00,USD\n',
  });
  assert.equal(more.status, 200);
  const after = await check(COST);
  assert.equal(after.latestOutdated, true);
  // The stored summary itself is unchanged and still says what it was generated from.
  assert.ok(after.latest!.facts.some((f) => f.includes('$955.00')));
  assert.equal(after.latest!.recordIds.length, 9);

  // Removing that import restores the evidence, and the summary matches again.
  storage.deleteImport(storage.listImports()[0]!.id);
  assert.equal((await check(COST)).latestOutdated, false);
});

test('a summary survives in storage, a new one replaces it, and it can be discarded', async () => {
  const { generate, check, app, storage } = await setup(() => JSON.stringify(GOOD));
  await generate(COST);
  const first = storage.latestSummary()!;
  await generate(COST);
  const second = storage.latestSummary()!;
  assert.notEqual(second.id, first.id);
  assert.equal((await app.request(`/api/summary/${first.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await app.request(`/api/summary/${second.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await check(COST)).latest, null);
});

// ---------- the adapter ----------

test('the Anthropic adapter sends one schema-bound request and never leaks the key', async () => {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const provider = createAnthropicProvider({
    apiKey: SECRET,
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(init!.body as string) as Record<string, unknown> });
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 4 } });
    },
  });
  assert.deepEqual([provider.name, provider.model, provider.host], ['Anthropic', 'claude-sonnet-5-5', 'api.anthropic.com']);
  const reply = await provider.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], schema: { type: 'object' }, maxOutputTokens: 123, signal: AbortSignal.timeout(1000) });
  assert.deepEqual(reply, { text: '{"ok":true}', inputTokens: 10, outputTokens: 4 });
  assert.equal(seen[0]!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0]!.headers['x-api-key'], SECRET);
  assert.equal(seen[0]!.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(seen[0]!.body, {
    model: 'claude-sonnet-5-5',
    max_tokens: 123,
    system: 'S',
    messages: [{ role: 'user', content: 'U' }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } },
  });
  assert.ok(!JSON.stringify(seen[0]!.body).includes(SECRET));
});

test('the adapter turns provider answers into plain failures without the key in them', async () => {
  const failure = async (response: () => Response | Promise<Response>) => {
    const provider = createAnthropicProvider({ apiKey: SECRET, fetchImpl: async () => response() });
    try {
      await provider.complete({ system: '', messages: [], schema: {}, maxOutputTokens: 1, signal: AbortSignal.timeout(1000) });
    } catch (error) {
      assert.ok(error instanceof ProviderError);
      assert.ok(!error.message.includes(SECRET));
      return error.kind;
    }
    return 'no error';
  };
  const error = (status: number) => () => Response.json({ type: 'error', error: { type: 'x', message: 'details' } }, { status });
  assert.equal(await failure(error(401)), 'auth');
  assert.equal(await failure(error(429)), 'rate_limited');
  assert.equal(await failure(error(529)), 'provider_error');
  assert.equal(await failure(() => Response.json({ stop_reason: 'refusal', content: [] })), 'refused');
  assert.equal(await failure(() => Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"over' }] })), 'truncated');
  assert.equal(await failure(() => Response.json({ stop_reason: 'end_turn', content: [] })), 'bad_reply');
  assert.equal(await failure(() => Promise.reject(new TypeError('fetch failed'))), 'unreachable');
});

test('the key is not stored in the database and not returned by any summary route', async () => {
  const storage = new NcrStorage(':memory:');
  const provider = createAnthropicProvider({
    apiKey: SECRET,
    fetchImpl: async () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(GOOD) }] }),
  });
  const app = createApp({ storage, loadSample: () => [], uiDir: join(root, 'tests', 'no-ui-here'), ai: provider });
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/import/commit', { fileName: 'ai-eval.csv', text: FILE });
  const checked = await (await post('/api/summary/check', { scope: COST })).text();
  const fingerprint = (JSON.parse(checked) as { request: { fingerprint: string } }).request.fingerprint;
  const generated = await (await post('/api/summary', { scope: COST, fingerprint, confirmed: true })).text();
  assert.ok(JSON.parse(generated).summary.id > 0);
  for (const text of [checked, generated, JSON.stringify(storage.latestSummary()), await (await app.request('/api/ncrs')).text()]) {
    assert.ok(!text.includes(SECRET));
  }
});
