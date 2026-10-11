import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { countByCategory } from '../src/modules/quality/categories.ts';
import { fieldOptions, filterRecords, NO_FILTER } from '../src/modules/quality/filter.ts';
import { computeTotals } from '../src/modules/quality/totals.ts';
import { loadSampleRecords } from '../src/server/sample.ts';

const sample = loadSampleRecords(join(resolve(import.meta.dirname, '..'), 'fixtures', 'ncr-sample.json'));

test('totals sum only the values that were recorded', () => {
  const totals = computeTotals([
    { quantityAffected: 10, costCents: 2550, currency: 'USD' },
    { quantityAffected: null, costCents: 1000, currency: 'USD' },
    { quantityAffected: 5, costCents: null, currency: null },
    { quantityAffected: null, costCents: null, currency: null },
  ]);
  assert.equal(totals.recordCount, 4);
  assert.deepEqual(totals.quantityAffected, { sum: 15, recorded: 2, missing: 2 });
  assert.deepEqual(totals.cost, {
    groups: [{ currency: 'USD', sumCents: 3550, recorded: 2 }],
    recorded: 2,
    missing: 2,
  });
});

test('a recorded zero is a value, not a missing one', () => {
  const totals = computeTotals([{ quantityAffected: 0, costCents: 0, currency: 'USD' }]);
  assert.deepEqual(totals.quantityAffected, { sum: 0, recorded: 1, missing: 0 });
  assert.deepEqual(totals.cost, { groups: [{ currency: 'USD', sumCents: 0, recorded: 1 }], recorded: 1, missing: 0 });
});

test('cost totals are exact because they are summed in hundredths', () => {
  // 0.10 + 0.20 is not 0.30 in floating point; 10 + 20 hundredths is exactly 30.
  const totals = computeTotals([
    { quantityAffected: null, costCents: 10, currency: 'EUR' },
    { quantityAffected: null, costCents: 20, currency: 'EUR' },
  ]);
  assert.equal(totals.cost.groups[0]?.sumCents, 30);
});

test('costs in different or unstated currencies are never added together', () => {
  const totals = computeTotals([
    { quantityAffected: null, costCents: 100, currency: 'USD' },
    { quantityAffected: null, costCents: 200, currency: 'EUR' },
    { quantityAffected: null, costCents: 400, currency: null },
    { quantityAffected: null, costCents: 800, currency: 'USD' },
    { quantityAffected: null, costCents: 1600, currency: null },
    { quantityAffected: null, costCents: null, currency: 'USD' },
  ]);
  assert.deepEqual(totals.cost, {
    groups: [
      { currency: 'EUR', sumCents: 200, recorded: 1 },
      { currency: 'USD', sumCents: 900, recorded: 2 },
      { currency: null, sumCents: 2000, recorded: 2 },
    ],
    recorded: 5,
    missing: 1,
  });
});

test('no records gives zero counts and no cost groups', () => {
  const totals = computeTotals([]);
  assert.equal(totals.recordCount, 0);
  assert.deepEqual(totals.cost, { groups: [], recorded: 0, missing: 0 });
});

test('category counts rank by NCR count, keep uncategorized as its own last bucket and add up', () => {
  const counts = countByCategory(sample);
  // Counted from the fixture file separately, not with countByCategory.
  assert.deepEqual(counts, [
    { category: 'Dimensional', count: 8 },
    { category: 'Surface finish', count: 5 },
    { category: 'Assembly', count: 3 },
    { category: 'Material', count: 3 },
    { category: 'Documentation', count: 2 },
    { category: 'Labeling', count: 1 },
    { category: null, count: 2 },
  ]);
  assert.equal(
    counts.reduce((sum, c) => sum + c.count, 0),
    sample.length,
  );
});

test('categories are compared exactly as written and never merged', () => {
  const counts = countByCategory([
    { defectCategory: 'Dimensional' },
    { defectCategory: 'dimensional' },
    { defectCategory: 'Dimensional' },
  ]);
  assert.deepEqual(counts, [
    { category: 'Dimensional', count: 2 },
    { category: 'dimensional', count: 1 },
  ]);
});

test('each chart bar equals the number of records shown after filtering to it', () => {
  for (const base of [NO_FILTER, { ...NO_FILTER, status: 'Open' }, { ...NO_FILTER, search: 'supplier a' }]) {
    const chartRecords = filterRecords(sample, { ...base, category: undefined });
    const bars = countByCategory(chartRecords);
    assert.equal(
      bars.reduce((sum, bar) => sum + bar.count, 0),
      chartRecords.length,
    );
    for (const bar of bars) {
      assert.equal(filterRecords(sample, { ...base, category: bar.category }).length, bar.count);
    }
  }
});

test('filters match missing values only when asked for them', () => {
  assert.equal(filterRecords(sample, NO_FILTER).length, 24);
  assert.equal(filterRecords(sample, { ...NO_FILTER, category: null }).length, 2);
  assert.equal(filterRecords(sample, { ...NO_FILTER, status: 'Open' }).length, 6);
  assert.equal(filterRecords(sample, { ...NO_FILTER, status: 'Open', category: 'Surface finish' }).length, 1);
  assert.deepEqual(
    filterRecords(sample, { ...NO_FILTER, search: '  TOOL WEAR ' }).map((r) => r.ncrNumber),
    ['SYN-NCR-0001', 'SYN-NCR-0002', 'SYN-NCR-0018'],
  );
  assert.equal(filterRecords(sample, { ...NO_FILTER, search: 'no such text' }).length, 0);
});

test('filter choices list recorded values and flag that some records have none', () => {
  assert.deepEqual(fieldOptions(sample, 'status'), { values: ['Closed', 'Open'], hasMissing: false });
  const categories = fieldOptions(sample, 'defectCategory');
  assert.equal(categories.values.length, 6);
  assert.equal(categories.hasMissing, true);
});
