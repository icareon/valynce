import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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
    currency: null,
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
  assert.equal(result.value.currency, null);
  assert.equal(result.value.reportedCause, null);
});

test('parsing reports every problem in a bad record', () => {
  const result = parseNcrFields({
    ncrNumber: '',
    openedOn: '2026-02-30',
    quantityAffected: -1,
    costCents: 12.5,
    supplier: 7,
    currency: 'dollars',
  });
  assert.ok(!result.ok);
  assert.equal(result.errors.length, 6);
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

test('a currency is kept only when it is a real code, and is never assumed', () => {
  const stated = parseNcrFields({ ncrNumber: 'N-1', costCents: 500, currency: ' eur ' });
  assert.ok(stated.ok);
  assert.equal(stated.value.currency, 'EUR');
  const unstated = parseNcrFields({ ncrNumber: 'N-2', costCents: 500 });
  assert.ok(unstated.ok);
  assert.equal(unstated.value.currency, null);
  assert.ok(!parseNcrFields({ ncrNumber: 'N-3', costCents: 500, currency: 'XYZ' }).ok);
});

test('opening an older database keeps every record, backs it up and does not invent a currency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'valynce-test-'));
  try {
    const path = join(dir, 'valynce.db');
    // A database exactly as the first schema version created it.
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE ncr (
        id INTEGER PRIMARY KEY, ncr_number TEXT NOT NULL UNIQUE, opened_on TEXT, part_number TEXT,
        supplier TEXT, defect_category TEXT, description TEXT, quantity_affected INTEGER, cost_cents INTEGER,
        status TEXT, disposition TEXT, reported_cause TEXT, origin TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO ncr (ncr_number, cost_cents, quantity_affected, origin, created_at) VALUES
        ('REAL-1', 12345, 7, 'import', '2026-01-01T00:00:00.000Z'),
        ('REAL-2', NULL, NULL, 'import', '2026-01-01T00:00:00.000Z'),
        ('SYN-NCR-0001', 182000, 40, 'sample', '2026-01-01T00:00:00.000Z'),
        ('SYN-NCR-0008', NULL, NULL, 'sample', '2026-01-01T00:00:00.000Z');
      INSERT INTO meta VALUES ('sample_seeded', 'yes');
      PRAGMA user_version = 1;
    `);
    old.close();

    const storage = new NcrStorage(path);
    const byNumber = new Map(storage.list().map((r) => [r.ncrNumber, r]));
    assert.equal(byNumber.size, 4);
    // A real record's cost is unchanged and its currency stays unspecified.
    assert.equal(byNumber.get('REAL-1')?.costCents, 12345);
    assert.equal(byNumber.get('REAL-1')?.quantityAffected, 7);
    assert.equal(byNumber.get('REAL-1')?.currency, null);
    assert.equal(byNumber.get('REAL-2')?.costCents, null);
    // Valynce's own synthetic records are defined as USD.
    assert.equal(byNumber.get('SYN-NCR-0001')?.currency, 'USD');
    assert.equal(byNumber.get('SYN-NCR-0008')?.currency, null);
    assert.equal(storage.getMeta('sample_seeded'), 'yes');
    storage.close();

    assert.ok(existsSync(`${path}.v1.bak`));
    const backup = new DatabaseSync(`${path}.v1.bak`);
    assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM ncr').get()?.n, 4);
    assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version, 1);
    backup.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from a newer Valynce is refused and left untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'valynce-test-'));
  try {
    const path = join(dir, 'valynce.db');
    const future = new DatabaseSync(path);
    future.exec('CREATE TABLE something (x); PRAGMA user_version = 999;');
    future.close();
    assert.throws(() => new NcrStorage(path), /newer Valynce/);
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 999);
    check.close();
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
