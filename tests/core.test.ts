import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseNcrFields } from '../src/core/ncr.ts';
import type { NcrFields } from '../src/core/ncr.ts';
import { resolveDataDir } from '../src/core/paths.ts';
import { NcrStorage } from '../src/core/storage.ts';

function ncr(ncrNumber: string, overrides: Partial<NcrFields> = {}): NcrFields {
  return {
    ncrNumber,
    openedOn: '2026-03-01',
    partNumber: 'SYN-1',
    supplier: null,
    defectCategory: 'Dimensional',
    description: null,
    quantityAffected: 4,
    costCents: 1250,
    status: 'Open',
    disposition: null,
    reportedCause: null,
    ...overrides,
  };
}

test('parsing keeps missing values as null and never fills them in', () => {
  const result = parseNcrFields({ ncrNumber: ' N-1 ', supplier: '', quantityAffected: null });
  assert.ok(result.ok);
  assert.equal(result.value.ncrNumber, 'N-1');
  assert.equal(result.value.supplier, null);
  assert.equal(result.value.quantityAffected, null);
  assert.equal(result.value.costCents, null);
  assert.equal(result.value.reportedCause, null);
});

test('parsing reports every problem in a bad record', () => {
  const result = parseNcrFields({
    ncrNumber: '',
    openedOn: '2026-02-30',
    quantityAffected: -1,
    costCents: 12.5,
    supplier: 7,
  });
  assert.ok(!result.ok);
  assert.equal(result.errors.length, 5);
});

test('storage returns what was stored, with nulls intact', () => {
  const storage = new NcrStorage(':memory:');
  storage.insertMany([ncr('N-1', { quantityAffected: null, costCents: 0 })], 'import');
  const [record] = storage.list();
  assert.ok(record);
  assert.equal(record.ncrNumber, 'N-1');
  assert.equal(record.quantityAffected, null);
  assert.equal(record.costCents, 0);
  assert.equal(record.origin, 'import');
  storage.close();
});

test('a duplicate NCR number is skipped and reported, and the stored record is unchanged', () => {
  const storage = new NcrStorage(':memory:');
  storage.insertMany([ncr('N-1', { costCents: 100 })], 'import');
  const result = storage.insertMany([ncr('N-1', { costCents: 999 }), ncr('N-2'), ncr('N-2')], 'import');
  assert.deepEqual(result, { inserted: 1, skippedDuplicates: ['N-1', 'N-2'] });
  assert.equal(storage.count(), 2);
  assert.equal(storage.list().find((r) => r.ncrNumber === 'N-1')?.costCents, 100);
  storage.close();
});

test('removing sample records leaves other records alone', () => {
  const storage = new NcrStorage(':memory:');
  storage.insertMany([ncr('S-1'), ncr('S-2')], 'sample');
  storage.insertMany([ncr('N-1')], 'import');
  assert.equal(storage.deleteByOrigin('sample'), 2);
  assert.deepEqual(storage.list().map((r) => r.ncrNumber), ['N-1']);
  storage.close();
});

test('records and settings are still there after closing and reopening the database file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'valynce-test-'));
  try {
    const path = join(dir, 'valynce.db');
    const first = new NcrStorage(path);
    first.insertMany([ncr('N-1'), ncr('N-2', { costCents: null })], 'import');
    first.setMeta('sample_seeded', 'yes');
    first.close();

    const second = new NcrStorage(path);
    assert.equal(second.count(), 2);
    assert.equal(second.list().find((r) => r.ncrNumber === 'N-2')?.costCents, null);
    assert.equal(second.getMeta('sample_seeded'), 'yes');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the data folder is a per-user location, not the package folder', () => {
  assert.equal(resolveDataDir({}, 'darwin', '/Users/a'), '/Users/a/Library/Application Support/Valynce');
  assert.equal(resolveDataDir({}, 'linux', '/home/a'), '/home/a/.local/share/valynce');
  assert.equal(resolveDataDir({ XDG_DATA_HOME: '/x' }, 'linux', '/home/a'), '/x/valynce');
  assert.equal(resolveDataDir({ VALYNCE_DATA_DIR: '/custom/place' }, 'darwin', '/Users/a'), '/custom/place');
});
