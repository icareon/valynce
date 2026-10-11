import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseCsv } from '../src/core/csv.ts';
import type { NcrFields } from '../src/core/ncr.ts';
import { NcrStorage } from '../src/core/storage.ts';
import { detectDateFormat, detectNumberFormat, numberExamples, planImport, suggestMapping } from '../src/modules/quality/importRules.ts';
import { computePareto } from '../src/modules/quality/pareto.ts';
import type { ImportMapping, ImportOptions } from '../src/modules/quality/importRules.ts';
import { computeTotals } from '../src/modules/quality/totals.ts';
import { createApp } from '../src/server/app.ts';
import type { ImportCommitResponse, ImportPreviewResponse, NcrListResponse } from '../src/server/contract.ts';
import { loadSampleRecords } from '../src/server/sample.ts';

const root = resolve(import.meta.dirname, '..');
const exampleText = readFileSync(join(root, 'fixtures', 'ncr-import-example.csv'), 'utf8');
const loadSample = () => loadSampleRecords(join(root, 'fixtures', 'ncr-sample.json'));
const ISO: ImportOptions = { dateFormat: 'YMD', numberFormat: 'point', defaultCurrency: null, defaultQuantityUnit: null };
const nothingStored = new Map<string, NcrFields>();

function table(text: string) {
  const parsed = parseCsv(text);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  return parsed.table;
}

/** Plans an import of a small CSV whose headers are recognised automatically. */
function plan(text: string, options: Partial<ImportOptions> = {}, stored = nothingStored) {
  const t = table(text);
  return planImport(t, suggestMapping(t.headers), { ...ISO, ...options }, stored);
}

function setup() {
  const storage = new NcrStorage(':memory:');
  const app = createApp({ storage, loadSample, uiDir: join(root, 'tests', 'no-ui-here') });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { storage, app, post };
}

// ---------- reading CSV ----------

test('CSV cells keep commas, quotes and line breaks that are inside quotes', () => {
  const t = table('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line one\nline two",\r\n');
  assert.deepEqual(t.headers, ['a', 'b', 'c']);
  assert.deepEqual(t.rows, [
    ['1', 'x, y', 'say "hi"'],
    ['2', 'line one\nline two', ''],
  ]);
});

test('CSV reading handles a byte-order mark, semicolons, tabs and a missing final line break', () => {
  assert.deepEqual(table('﻿NCR;Cost\n1;12,50').rows, [['1', '12,50']]);
  assert.equal(table('NCR;Cost\n1;2').delimiter, ';');
  assert.equal(table('NCR\tCost\n1\t2').delimiter, '\t');
  assert.equal(table('NCR,Note\n1,"a;b;c;d"').delimiter, ',');
});

test('CSV reading keeps blank rows so row numbers still match the file', () => {
  assert.deepEqual(table('a,b\n1,2\n\n3,4\n').rows, [['1', '2'], [''], ['3', '4']]);
});

test('CSV reading refuses a file it cannot read reliably', () => {
  const open = parseCsv('a,b\n1,"never closed\n2,3\n');
  assert.ok(!open.ok);
  assert.match(open.error, /row 2 is never closed/);
  assert.ok(!parseCsv('').ok);
  assert.ok(!parseCsv(',,\n1,2,3').ok);
});

// ---------- mapping and formats ----------

test('columns are matched to fields by header name, and unknown headers are left unmapped', () => {
  const t = table(exampleText);
  assert.deepEqual(suggestMapping(t.headers), {
    ncrNumber: 0,
    openedOn: 1,
    partNumber: 2,
    supplier: 3,
    defectCategory: 4,
    description: 5,
    quantityAffected: 6,
    quantityUnit: null,
    cost: 7,
    currency: 8,
    status: 9,
    disposition: 10,
    reportedCause: 11,
  });
  const partial = suggestMapping(['Reference', 'Qty', 'Notes']);
  assert.equal(partial.ncrNumber, null);
  assert.equal(partial.quantityAffected, 1);
  assert.equal(partial.description, null);
});

test('a date format is detected only when the values leave no doubt', () => {
  assert.equal(detectDateFormat(['2026-07-02', '', '2026-08-18 14:30']), 'YMD');
  assert.equal(detectDateFormat(['01/02/2026', '13/02/2026']), 'DMY');
  assert.equal(detectDateFormat(['02/13/2026', '01.02.2026']), 'MDY');
  assert.equal(detectDateFormat(['03/04/2026', '05/06/2026']), null);
  assert.equal(detectDateFormat(['13/02/2026', '02/13/2026']), null);
  assert.equal(detectDateFormat(['03/04/26']), null);
  assert.equal(detectDateFormat([]), null);
});

test('an ambiguous date blocks the import instead of being guessed', () => {
  const text = 'NCR No,Date Opened\nN-1,03/04/2026\n';
  const undecided = plan(text, { dateFormat: null });
  assert.equal(undecided.blocking.length, 1);
  assert.match(undecided.blocking[0]!, /Choose how they are written/);
  assert.equal(undecided.rows[0]?.fields?.openedOn, null);
  assert.equal(plan(text, { dateFormat: 'DMY' }).rows[0]?.fields?.openedOn, '2026-04-03');
  assert.equal(plan(text, { dateFormat: 'MDY' }).rows[0]?.fields?.openedOn, '2026-03-04');
  assert.equal(plan(text, { dateFormat: 'MDY' }).blocking.length, 0);
});

test('an import with no NCR ID column is blocked', () => {
  const blocked = plan('Reference,Qty\nA,1\n');
  assert.match(blocked.blocking.join(' '), /NCR ID/);
});

test('a number format is detected only from values that can be read one way', () => {
  assert.deepEqual(detectNumberFormat(['1,234.56']), { format: 'point', needed: true });
  assert.deepEqual(detectNumberFormat(['1.234,56']), { format: 'comma', needed: true });
  assert.deepEqual(detectNumberFormat(['12.5', '300']), { format: 'point', needed: true });
  assert.deepEqual(detectNumberFormat(['12,50']), { format: 'comma', needed: true });
  assert.deepEqual(detectNumberFormat(['1,234,567']), { format: 'point', needed: true });
  // Four digits before the separator cannot be a thousands group, so it is a decimal.
  assert.deepEqual(detectNumberFormat(['1234,567']), { format: 'comma', needed: true });
  // 1,234 is 1234 in one format and 1.234 in the other.
  assert.deepEqual(detectNumberFormat(['1,234', '5,000']), { format: null, needed: true });
  assert.deepEqual(detectNumberFormat(['1.234']), { format: null, needed: true });
  // A clear value settles it for the unclear ones beside it.
  assert.deepEqual(detectNumberFormat(['1,234', '99.50']), { format: 'point', needed: true });
  // Values that contradict each other settle nothing.
  assert.deepEqual(detectNumberFormat(['12.50', '12,50']), { format: null, needed: true });
  assert.deepEqual(detectNumberFormat(['12', '300', '']), { format: null, needed: false });
});

test('an ambiguous number format blocks the import, and the preview shows each reading', () => {
  const text = 'NCR No;Qty;Cost\nN-1;1,234;1,500\n';
  const undecided = plan(text, { numberFormat: null });
  assert.equal(undecided.blocking.length, 1);
  assert.match(undecided.blocking[0]!, /"1,234" could be read more than one way/);
  assert.equal(undecided.rows[0]?.status, 'error');

  const t = table(text);
  const mapping = suggestMapping(t.headers);
  const read = (numberFormat: 'point' | 'comma' | null) =>
    numberExamples(t, mapping, { ...ISO, numberFormat }).map((e) => `${e.field} ${e.raw} -> ${e.read}`);
  assert.deepEqual(read(null), ['quantityAffected 1,234 -> null', 'cost 1,500 -> null']);
  assert.deepEqual(read('point'), ['quantityAffected 1,234 -> 1234', 'cost 1,500 -> 1500.00']);
  // As a decimal comma, 1,500 is a cost with three decimals, which is not rounded, so it cannot be read.
  assert.deepEqual(read('comma'), ['quantityAffected 1,234 -> 1.234', 'cost 1,500 -> null']);

  // Under the comma reading 1,234 is a fraction, which a count of pieces cannot be.
  assert.equal(plan(text, { numberFormat: 'point' }).rows[0]?.fields?.quantityAffected, 1234);
  assert.equal(plan(text, { numberFormat: 'comma' }).rows[0]?.status, 'error');
  // A file with no separators needs no choice.
  assert.deepEqual(plan('NCR No,Qty,Cost\nN-1,12,300\n', { numberFormat: null }).blocking, []);
  assert.equal(plan('NCR No,Qty,Cost\nN-1,12,300\n', { numberFormat: null }).rows[0]?.fields?.costCents, 30000);
});

test('a fractional quantity is accepted only with a recognised unit of measure', () => {
  const quantity = (qty: string, unit: string, options: Partial<ImportOptions> = {}) =>
    plan(`NCR No;Qty;Unit\nN-1;${qty};${unit}\n`, options).rows[0]!;
  assert.deepEqual([quantity('2.5', 'kg').fields?.quantityAffected, quantity('2.5', 'kg').fields?.quantityUnit], [2.5, 'kg']);
  assert.deepEqual([quantity('2.5', 'KG').fields?.quantityUnit, quantity('0.125', 'L').fields?.quantityAffected], ['kg', 0.125]);
  assert.match(quantity('2.5', '').problems[0]!, /Pieces are counted whole/);
  assert.match(quantity('2.5', 'pcs').problems[0]!, /Pieces are counted whole/);
  assert.match(quantity('2.5', 'rolls').problems[0]!, /"rolls" is not a recognised unit of measure/);
  assert.match(quantity('2.5555', 'kg').problems[0]!, /more than three decimal places/);
  // Whole quantities are fine in any unit, and piece spellings all mean a count of pieces.
  assert.deepEqual([quantity('3', 'rolls').fields?.quantityAffected, quantity('3', 'rolls').fields?.quantityUnit], [3, 'rolls']);
  assert.equal(quantity('80', 'pcs').fields?.quantityUnit, null);
  assert.equal(quantity('80.0', 'ea').fields?.quantityAffected, 80);
  // A unit chosen for the whole file applies only to rows that state none.
  assert.equal(plan('NCR No,Qty\nN-1,2.5\n', { defaultQuantityUnit: 'kg' }).rows[0]?.fields?.quantityUnit, 'kg');
  assert.equal(quantity('4', 'm', { defaultQuantityUnit: 'kg' }).fields?.quantityUnit, 'm');
  // A unit with no quantity is not kept.
  assert.equal(quantity('', 'kg').fields?.quantityUnit, null);
});

// ---------- row-level validation ----------

test('costs are read exactly into hundredths, in either decimal convention', () => {
  const cost = (value: string, numberFormat: 'point' | 'comma' = 'point') =>
    plan(`NCR No;Cost\nN-1;${value}\n`, { numberFormat }).rows[0]!;
  assert.equal(cost('1,234.56').fields?.costCents, 123456);
  assert.equal(cost('0.1').fields?.costCents, 10);
  assert.equal(cost('5').fields?.costCents, 500);
  assert.equal(cost('0').fields?.costCents, 0);
  assert.equal(cost('1 234.5').fields?.costCents, 123450);
  assert.equal(cost('1.234,56', 'comma').fields?.costCents, 123456);
  assert.equal(cost('12,5', 'comma').fields?.costCents, 1250);
  // 1.234 is "one thousand two hundred thirty-four" only where the comma is the decimal separator.
  assert.equal(cost('1.234', 'comma').fields?.costCents, 123400);
  assert.equal(cost('1.234').status, 'error');
  assert.match(cost('1.234').problems[0]!, /more than two decimal places/);
  assert.equal(cost('-5').status, 'error');
  assert.equal(cost('12,34,56').status, 'error');
  assert.equal(cost('abc').status, 'error');
});

test('a currency symbol is rejected rather than turned into a currency', () => {
  const row = plan('NCR No,Cost\nN-1,$45.00\n').rows[0]!;
  assert.equal(row.status, 'error');
  assert.match(row.problems[0]!, /contains "\$"/);
  assert.equal(row.fields, null);
});

test('a currency comes from the file or an explicit setting, and is never assumed', () => {
  const text = 'NCR No,Cost,Currency\nN-1,10.00,eur\nN-2,20.00,\nN-3,,\nN-4,5.00,dollars\nN-5,,USD\n';
  const unspecified = plan(text);
  assert.deepEqual(
    unspecified.rows.map((r) => r.fields?.currency),
    ['EUR', null, null, undefined, null],
  );
  assert.equal(unspecified.costWithoutCurrency, 1);
  assert.equal(unspecified.rows[3]?.status, 'error');
  assert.match(unspecified.rows[3]!.problems[0]!, /not an ISO 4217 code/);

  // The setting fills in only rows that have a cost and state no currency.
  const withDefault = plan(text, { defaultCurrency: 'GBP' });
  assert.deepEqual(
    withDefault.rows.map((r) => r.fields?.currency),
    ['EUR', 'GBP', null, undefined, null],
  );
  assert.equal(withDefault.costWithoutCurrency, 0);
});

test('quantities must be whole numbers, and every problem in a row is reported', () => {
  const row = plan('NCR No,Date Opened,Qty,Cost\n,2026-02-30,12.5,1.999\n').rows[0]!;
  assert.equal(row.status, 'error');
  assert.equal(row.problems.length, 4);
  assert.equal(plan('NCR No,Qty\nN-1,1200\n').rows[0]?.fields?.quantityAffected, 1200);
  // With the format chosen, a thousands separator is read for what it is.
  assert.equal(plan('NCR No,Qty\nN-1,"1,200"\n', { numberFormat: 'point' }).rows[0]?.fields?.quantityAffected, 1200);
  assert.equal(plan('NCR No;Qty\nN-1;1.200\n', { numberFormat: 'comma' }).rows[0]?.fields?.quantityAffected, 1200);
});

test('empty cells become "not recorded", and text is kept as written', () => {
  const row = plan('NCR No,Vendor,Qty,Cost,State,Root Cause\n  N-1  ,,,,  n/a ,\n').rows[0]!;
  assert.equal(row.status, 'ready');
  assert.deepEqual(row.fields, {
    ncrNumber: 'N-1',
    openedOn: null,
    partNumber: null,
    supplier: null,
    defectCategory: null,
    description: null,
    quantityAffected: null,
    quantityUnit: null,
    costCents: null,
    currency: null,
    status: 'n/a',
    disposition: null,
    reportedCause: null,
  });
});

test('a row with more values than the header has columns is an error', () => {
  const row = plan('NCR No,Qty\nN-1,3,stray\n').rows[0]!;
  assert.equal(row.status, 'error');
  assert.match(row.problems[0]!, /3 values but the header names 2 columns/);
});

// ---------- the example file ----------

test('the example file is planned row by row exactly as documented', () => {
  const result = plan(exampleText);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.summary, { total: 18, ready: 11, errors: 4, duplicatesInFile: 2, duplicatesStored: 0, blank: 1 });
  assert.equal(result.costWithoutCurrency, 1);

  const byRow = new Map(result.rows.map((r) => [r.row, r]));
  assert.equal(byRow.get(2)?.ncrNumber, 'EX-NCR-0101');
  assert.equal(byRow.get(12)?.status, 'duplicate-in-file');
  assert.equal(byRow.get(12)?.problems[0], 'Repeats row 3 exactly. Skipped.');
  assert.equal(byRow.get(13)?.status, 'duplicate-in-file');
  assert.equal(
    byRow.get(13)?.problems[0],
    'Same NCR ID as row 4 but different values (opened date, description, recorded cost). Row 4 is kept.',
  );
  assert.deepEqual(byRow.get(14)?.problems, ['NCR ID is empty.']);
  assert.deepEqual(byRow.get(15)?.problems, ['Opened date "2026-02-30" is not a real calendar date.']);
  assert.match(byRow.get(16)!.problems[0]!, /Affected quantity "12.5" is not a whole number/);
  assert.match(byRow.get(17)!.problems[0]!, /Recorded cost "\$45.00" contains "\$"/);
  assert.equal(byRow.get(18)?.status, 'blank');
  assert.equal(byRow.get(19)?.status, 'ready');

  // Quoted text survives intact.
  assert.equal(byRow.get(4)?.fields?.description, 'Scratches on cover, visible after cleaning');
  assert.equal(byRow.get(6)?.fields?.description, 'Label reads "Grade B" but order was Grade A');
  assert.equal(byRow.get(10)?.fields?.description, 'Flatness out of tolerance\non two of five sampled parts');
  // A recorded zero is not a missing value, and a missing value is not zero.
  assert.equal(byRow.get(9)?.fields?.costCents, 0);
  assert.equal(byRow.get(9)?.fields?.quantityAffected, null);
  // The file's exact cells are kept for traceability.
  assert.equal(byRow.get(17)?.source.Cost, '$45.00');
  assert.equal(byRow.get(2)?.source['Root Cause'], 'Worn cutter');
});

test('totals over the importable example rows match figures added up by hand', () => {
  const ready = plan(exampleText)
    .rows.filter((r) => r.status === 'ready')
    .map((r) => r.fields!);
  // Added up from the CSV by hand: USD 1250.00+687.50+300.00+0+95.25+50.00, EUR 2400.00+1180.40.
  assert.deepEqual(computeTotals(ready), {
    recordCount: 11,
    quantity: { groups: [{ unit: null, sum: 896, recorded: 9 }], recorded: 9, missing: 2 },
    cost: {
      groups: [
        { currency: 'EUR', sumCents: 358040, recorded: 2 },
        { currency: 'USD', sumCents: 238275, recorded: 6 },
        { currency: null, sumCents: 21000, recorded: 1 },
      ],
      recorded: 9,
      missing: 2,
    },
  });
  assert.deepEqual(
    computePareto(ready, 'count').series[0]?.rows.map((row) => [row.category, row.value]),
    [
      ['Dimensional', 3],
      ['Material', 2],
      ['Surface finish', 2],
      ['Assembly', 1],
      ['Documentation', 1],
      ['Labeling', 1],
      [null, 1],
    ],
  );
});

// ---------- duplicates against stored records ----------

test('a row whose NCR ID is already stored is skipped, and the difference is named', () => {
  const first = plan(exampleText).rows.find((r) => r.row === 2)!.fields!;
  const same = plan(exampleText, {}, new Map([[first.ncrNumber, first]]));
  assert.equal(same.rows[0]?.status, 'duplicate-stored');
  assert.equal(same.rows[0]?.problems[0], 'Already stored with the same values. Skipped.');
  assert.equal(same.summary.ready, 10);

  const changed = plan(exampleText, {}, new Map([[first.ncrNumber, { ...first, costCents: 1, status: 'Open' }]]));
  assert.equal(
    changed.rows[0]?.problems[0],
    'Already stored with different values (recorded cost, status). The stored record is kept.',
  );
});

// ---------- through the API and storage ----------

test('a preview describes the import and stores nothing', async () => {
  const { post, storage } = setup();
  const response = await post('/api/import/preview', { fileName: 'example.csv', text: exampleText });
  assert.equal(response.status, 200);
  const preview = (await response.json()) as ImportPreviewResponse;
  assert.equal(preview.columns.length, 12);
  assert.equal(preview.examples[0], 'EX-NCR-0101');
  assert.equal(preview.mapping.reportedCause, 11);
  assert.deepEqual(preview.detected, { dateFormat: 'YMD', numberFormat: 'point', numberFormatNeeded: true });
  assert.ok(preview.numberExamples.some((e) => e.field === 'cost' && e.raw === '1250.00' && e.read === '1250.00'));
  assert.equal(preview.summary.ready, 11);
  assert.equal(preview.skippedRows.length, 6);
  assert.equal(preview.readyRows.length, 11);
  assert.equal(storage.count(), 0);
  assert.equal(storage.listImports().length, 0);
});

test('an import stores the ready rows with their source, and importing the file again adds nothing', async () => {
  const { post, app, storage } = setup();
  const committed = await post('/api/import/commit', { fileName: 'example.csv', text: exampleText });
  assert.equal(committed.status, 200);
  const { batch, summary, skippedRows } = (await committed.json()) as ImportCommitResponse;
  assert.equal(summary.ready, 11);
  assert.equal(skippedRows.length, 6);
  assert.equal(batch.fileName, 'example.csv');
  assert.equal(batch.fileSha256, createHash('sha256').update(exampleText).digest('hex'));
  assert.deepEqual(
    [batch.rowsTotal, batch.rowsImported, batch.rowsDuplicate, batch.rowsRejected, batch.rowsBlank],
    [18, 11, 2, 4, 1],
  );

  const listed = (await (await app.request('/api/ncrs')).json()) as NcrListResponse;
  assert.equal(listed.records.length, 11);
  assert.equal(listed.sampleCount, 0);
  assert.equal(listed.imports.length, 1);
  assert.equal(listed.totals.cost.groups.length, 3);
  const last = listed.records.find((r) => r.ncrNumber === 'EX-NCR-0114')!;
  assert.equal(last.origin, 'import');
  assert.equal(last.importBatchId, batch.id);
  assert.equal(last.sourceRow, 19);
  assert.equal(last.sourceValues?.['NCR No'], 'EX-NCR-0114');
  assert.equal(last.sourceValues?.Cost, '50.00');
  // The first of two conflicting rows was kept.
  assert.equal(listed.records.find((r) => r.ncrNumber === 'EX-NCR-0103')?.costCents, 30000);

  const again = (await (await post('/api/import/preview', { fileName: 'example.csv', text: exampleText })).json()) as ImportPreviewResponse;
  assert.equal(again.summary.ready, 0);
  // All 13 rows with a usable NCR ID now match a stored record, including the two repeats inside the file.
  assert.equal(again.summary.duplicatesStored, 13);
  assert.equal(again.summary.duplicatesInFile, 0);
  const secondCommit = await post('/api/import/commit', { fileName: 'example.csv', text: exampleText });
  assert.equal(secondCommit.status, 400);
  assert.equal(storage.count(), 11);
  assert.equal(storage.listImports().length, 1);
});

test('an import that is blocked, unreadable or cross-site stores nothing', async () => {
  const { post, app, storage } = setup();
  const noId = { ...suggestMapping(table(exampleText).headers), ncrNumber: null } satisfies ImportMapping;
  const blocked = await post('/api/import/commit', { fileName: 'x.csv', text: exampleText, mapping: noId, options: ISO });
  assert.equal(blocked.status, 400);
  assert.match(((await blocked.json()) as { error: string }).error, /NCR ID/);

  assert.equal((await post('/api/import/commit', { fileName: 'x.csv', text: 'a,b\n1,"open' })).status, 400);
  assert.equal((await post('/api/import/commit', { fileName: 'x.csv', text: 'NCR No\n' })).status, 400);
  const outOfRange = { ...noId, ncrNumber: 99 };
  assert.equal((await post('/api/import/preview', { fileName: 'x.csv', text: exampleText, mapping: outOfRange, options: ISO })).status, 400);
  const badCurrency = { ...ISO, defaultCurrency: 'dollars' };
  assert.equal((await post('/api/import/preview', { fileName: 'x.csv', text: exampleText, options: badCurrency })).status, 400);

  const crossSite = await app.request('/api/import/commit', {
    method: 'POST',
    headers: { host: '127.0.0.1:4310', origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: 'x.csv', text: exampleText }),
  });
  assert.equal(crossSite.status, 403);
  assert.equal(storage.count(), 0);
});

test('imported records, their source and the import entry survive closing and reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'valynce-test-'));
  try {
    const path = join(dir, 'valynce.db');
    const ready = plan(exampleText).rows.filter((r) => r.status === 'ready');
    const first = new NcrStorage(path);
    first.importBatch(
      { fileName: 'example.csv', fileSha256: 'abc', settings: { options: ISO }, rowsTotal: 18, rowsDuplicate: 2, rowsRejected: 4, rowsBlank: 1 },
      ready.map((r) => ({ fields: r.fields!, sourceRow: r.row, sourceValues: r.source })),
    );
    first.close();

    const second = new NcrStorage(path);
    assert.equal(second.count(), 11);
    const record = second.list().find((r) => r.ncrNumber === 'EX-NCR-0105')!;
    assert.equal(record.costCents, 240000);
    assert.equal(record.currency, 'EUR');
    assert.equal(record.sourceRow, 6);
    assert.equal(record.sourceValues?.Issue, 'Label reads "Grade B" but order was Grade A');
    const [batch] = second.listImports();
    assert.equal(batch?.fileName, 'example.csv');
    assert.equal(batch?.rowsImported, 11);
    assert.equal(record.importBatchId, batch?.id);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an import is all or nothing: a clash part-way through leaves the database unchanged', () => {
  const storage = new NcrStorage(':memory:');
  const ready = plan(exampleText).rows.filter((r) => r.status === 'ready');
  const rows = ready.map((r) => ({ fields: r.fields!, sourceRow: r.row, sourceValues: r.source }));
  const clashing = [...rows, rows[0]!];
  const input = { fileName: 'x.csv', fileSha256: 'abc', settings: {}, rowsTotal: 12, rowsDuplicate: 0, rowsRejected: 0, rowsBlank: 0 };
  assert.throws(() => storage.importBatch(input, clashing));
  assert.equal(storage.count(), 0);
  assert.equal(storage.listImports().length, 0);
  storage.close();
});

test('removing an import takes out only its records, and removing demo data leaves imports alone', async () => {
  const { post, app, storage } = setup();
  await app.request('/api/sample', { method: 'POST' });
  const { batch } = (await (await post('/api/import/commit', { fileName: 'example.csv', text: exampleText })).json()) as ImportCommitResponse;
  assert.equal(storage.count(), 35);

  await app.request('/api/sample', { method: 'DELETE' });
  assert.equal(storage.count(), 11);
  assert.equal(storage.count('import'), 11);

  await app.request('/api/sample', { method: 'POST' });
  const removed = await app.request(`/api/imports/${batch.id}`, { method: 'DELETE' });
  assert.deepEqual(await removed.json(), { deleted: 11 });
  assert.equal(storage.count(), 24);
  assert.equal(storage.count('sample'), 24);
  assert.equal(storage.listImports().length, 0);
  assert.equal((await app.request(`/api/imports/${batch.id}`, { method: 'DELETE' })).status, 404);
});
