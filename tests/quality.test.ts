import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTotals } from '../src/modules/quality/totals.ts';

test('totals sum only the values that were recorded', () => {
  const totals = computeTotals([
    { quantityAffected: 10, costCents: 2550 },
    { quantityAffected: null, costCents: 1000 },
    { quantityAffected: 5, costCents: null },
    { quantityAffected: null, costCents: null },
  ]);
  assert.equal(totals.recordCount, 4);
  assert.deepEqual(totals.quantityAffected, { sum: 15, recorded: 2, missing: 2 });
  assert.deepEqual(totals.costCents, { sum: 3550, recorded: 2, missing: 2 });
});

test('a recorded zero is a value, not a missing one', () => {
  const totals = computeTotals([{ quantityAffected: 0, costCents: 0 }]);
  assert.deepEqual(totals.quantityAffected, { sum: 0, recorded: 1, missing: 0 });
  assert.deepEqual(totals.costCents, { sum: 0, recorded: 1, missing: 0 });
});

test('cost totals are exact because they are summed in hundredths', () => {
  // 0.10 + 0.20 is not 0.30 in floating point; 10 + 20 hundredths is exactly 30.
  const totals = computeTotals([
    { quantityAffected: null, costCents: 10 },
    { quantityAffected: null, costCents: 20 },
  ]);
  assert.equal(totals.costCents.sum, 30);
});

test('no records gives zero counts and nothing recorded', () => {
  const totals = computeTotals([]);
  assert.equal(totals.recordCount, 0);
  assert.deepEqual(totals.costCents, { sum: 0, recorded: 0, missing: 0 });
});
