import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { NcrStorage } from '../src/core/storage.ts';
import { computeTotals } from '../src/modules/quality/totals.ts';
import { createApp } from '../src/server/app.ts';
import type { NcrListResponse } from '../src/server/contract.ts';
import { loadSampleRecords } from '../src/server/sample.ts';

const root = resolve(import.meta.dirname, '..');
const loadSample = () => loadSampleRecords(join(root, 'fixtures', 'ncr-sample.json'));

function setup() {
  const storage = new NcrStorage(':memory:');
  const app = createApp({ storage, loadSample, uiDir: join(root, 'tests', 'no-ui-here') });
  return { storage, app };
}

test('the sample fixture is valid, has unique NCR numbers and includes missing values', () => {
  const records = loadSample();
  assert.equal(records.length, 24);
  assert.equal(new Set(records.map((r) => r.ncrNumber)).size, 24);
  assert.ok(records.every((r) => r.ncrNumber.startsWith('SYN-')));
  // Expected values were summed from the fixture file separately, not with computeTotals.
  assert.deepEqual(computeTotals(records), {
    recordCount: 24,
    quantityAffected: { sum: 1722, recorded: 21, missing: 3 },
    costCents: { sum: 2015250, recorded: 20, missing: 4 },
  });
});

test('the sample can be loaded, listed and removed through the API', async () => {
  const { app, storage } = setup();

  const loaded = await app.request('/api/sample', { method: 'POST' });
  assert.deepEqual(await loaded.json(), { inserted: 24, skippedDuplicates: [] });

  const again = await app.request('/api/sample', { method: 'POST' });
  const second = (await again.json()) as { inserted: number; skippedDuplicates: string[] };
  assert.equal(second.inserted, 0);
  assert.equal(second.skippedDuplicates.length, 24);

  const listed = (await (await app.request('/api/ncrs')).json()) as NcrListResponse;
  assert.equal(listed.records.length, 24);
  assert.equal(listed.sampleCount, 24);
  assert.equal(listed.totals.costCents.missing, 4);

  const removed = await app.request('/api/sample', { method: 'DELETE' });
  assert.deepEqual(await removed.json(), { deleted: 24 });
  assert.equal(storage.count(), 0);
});

test('requests under a non-local host name are refused', async () => {
  const { app } = setup();
  const response = await app.request('/api/ncrs', { headers: { host: 'evil.example:4310' } });
  assert.equal(response.status, 403);
});

test('a write started by another website is refused and changes nothing', async () => {
  const { app, storage } = setup();
  const crossOrigin = await app.request('/api/sample', {
    method: 'POST',
    headers: { host: '127.0.0.1:4310', origin: 'https://evil.example' },
  });
  assert.equal(crossOrigin.status, 403);
  const crossSite = await app.request('/api/sample', {
    method: 'POST',
    headers: { host: '127.0.0.1:4310', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.status, 403);
  assert.equal(storage.count(), 0);

  const sameOrigin = await app.request('/api/sample', {
    method: 'POST',
    headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(sameOrigin.status, 200);
});

test('the dev server origin can write only when it is explicitly trusted', async () => {
  const storage = new NcrStorage(':memory:');
  const app = createApp({
    storage,
    loadSample,
    uiDir: join(root, 'tests', 'no-ui-here'),
    trustedOrigins: ['http://127.0.0.1:5310'],
  });
  const headers = { host: '127.0.0.1:4310', 'sec-fetch-site': 'same-origin' };
  const trusted = await app.request('/api/sample', {
    method: 'POST',
    headers: { ...headers, origin: 'http://127.0.0.1:5310' },
  });
  assert.equal(trusted.status, 200);
  const otherLocalApp = await app.request('/api/sample', {
    method: 'DELETE',
    headers: { ...headers, origin: 'http://127.0.0.1:5173' },
  });
  assert.equal(otherLocalApp.status, 403);
  assert.equal(storage.count(), 24);
});

test('paths outside the interface folder are not served', async () => {
  const { app } = setup();
  const response = await app.request('/%2e%2e/%2e%2e/package.json');
  assert.notEqual(response.status, 200);
  assert.ok(!(await response.text()).includes('"dependencies"'));
});

test('unknown API paths return 404 rather than the interface', async () => {
  const { app } = setup();
  assert.equal((await app.request('/api/nope')).status, 404);
});
