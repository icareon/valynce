import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseCsv } from '../src/core/csv.ts';
import type { NcrFields } from '../src/core/ncr.ts';
import { fieldOptions, filterRecords, NO_FILTER } from '../src/modules/quality/filter.ts';
import { planImport, suggestMapping } from '../src/modules/quality/importRules.ts';
import { computePareto, paretoCsv, PARETO_METRICS } from '../src/modules/quality/pareto.ts';
import { computeTotals, costInCurrency, REPORTING_CURRENCY } from '../src/modules/quality/totals.ts';
import { loadSampleRecords } from '../src/server/sample.ts';

const root = resolve(import.meta.dirname, '..');
const sample = loadSampleRecords(join(root, 'fixtures', 'ncr-sample.json'));

/** The ten hand-checkable reports in fixtures/pareto-check.csv, read through the real import rules. */
function paretoCheck(): NcrFields[] {
  const parsed = parseCsv(readFileSync(join(root, 'fixtures', 'pareto-check.csv'), 'utf8'));
  assert.ok(parsed.ok);
  const plan = planImport(
    parsed.table,
    suggestMapping(parsed.table.headers),
    { dateFormat: 'YMD', numberFormat: 'point', defaultCurrency: null, defaultQuantityUnit: null },
    new Map(),
  );
  assert.deepEqual(plan.summary, { total: 10, ready: 10, errors: 0, duplicatesInFile: 0, duplicatesStored: 0, blank: 0 });
  return plan.rows.map((row) => row.fields!);
}

const check = paretoCheck();
const q = (quantityAffected: number | null, quantityUnit: string | null = null) => ({ quantityAffected, quantityUnit });
const c = (costCents: number | null, currency: string | null = null) => ({ costCents, currency });

// ---------- totals ----------

test('totals sum only the values that were recorded', () => {
  const totals = computeTotals([
    { ...q(10), ...c(2550, 'USD') },
    { ...q(null), ...c(1000, 'USD') },
    { ...q(5), ...c(null) },
    { ...q(null), ...c(null) },
  ]);
  assert.equal(totals.recordCount, 4);
  assert.deepEqual(totals.quantity, { groups: [{ unit: null, sum: 15, recorded: 2 }], recorded: 2, missing: 2 });
  assert.deepEqual(totals.cost, { groups: [{ currency: 'USD', sumCents: 3550, recorded: 2 }], recorded: 2, missing: 2 });
});

test('a recorded zero is a value, not a missing one', () => {
  const totals = computeTotals([{ ...q(0), ...c(0, 'USD') }]);
  assert.deepEqual(totals.quantity, { groups: [{ unit: null, sum: 0, recorded: 1 }], recorded: 1, missing: 0 });
  assert.deepEqual(totals.cost, { groups: [{ currency: 'USD', sumCents: 0, recorded: 1 }], recorded: 1, missing: 0 });
});

test('sums are exact: cost in hundredths and quantity in thousandths', () => {
  // 0.1 + 0.2 is not 0.3 in floating point.
  const totals = computeTotals([
    { ...q(0.1, 'kg'), ...c(10, 'EUR') },
    { ...q(0.2, 'kg'), ...c(20, 'EUR') },
  ]);
  assert.equal(totals.cost.groups[0]?.sumCents, 30);
  assert.equal(totals.quantity.groups[0]?.sum, 0.3);
});

test('costs in different or unstated currencies are never added together', () => {
  const totals = computeTotals([
    { ...q(null), ...c(100, 'USD') },
    { ...q(null), ...c(200, 'EUR') },
    { ...q(null), ...c(400) },
    { ...q(null), ...c(800, 'USD') },
    { ...q(null), ...c(1600) },
    { ...q(null), ...c(null, 'USD') },
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

test('the USD cost total holds only costs stated in USD and counts what it leaves out', () => {
  const totals = computeTotals([
    { ...q(null), ...c(100, 'USD') },
    { ...q(null), ...c(200, 'EUR') },
    { ...q(null), ...c(400) },
    { ...q(null), ...c(800, 'USD') },
    { ...q(null), ...c(null) },
  ]);
  assert.equal(REPORTING_CURRENCY, 'USD');
  // 1.00 + 8.00. The euro and the unstated amounts are not converted, relabelled or added.
  assert.deepEqual(costInCurrency(totals.cost, 'USD'), { currency: 'USD', sumCents: 900, recorded: 2, otherCurrency: 2, missing: 1 });
  // They are still in the totals, untouched.
  assert.deepEqual(totals.cost.groups.filter((g) => g.currency !== 'USD'), [
    { currency: 'EUR', sumCents: 200, recorded: 1 },
    { currency: null, sumCents: 400, recorded: 1 },
  ]);
});

test('no USD cost is reported as none, not as zero', () => {
  const none = computeTotals([{ ...q(null), ...c(200, 'EUR') }, { ...q(null), ...c(400) }, { ...q(null), ...c(null) }]);
  assert.deepEqual(costInCurrency(none.cost, 'USD'), { currency: 'USD', sumCents: null, recorded: 0, otherCurrency: 2, missing: 1 });
  // A recorded zero in USD is a real total of zero.
  const zero = computeTotals([{ ...q(null), ...c(0, 'USD') }]);
  assert.equal(costInCurrency(zero.cost, 'USD').sumCents, 0);
});

test('quantities in different units are never added together', () => {
  const totals = computeTotals(check);
  assert.deepEqual(totals.quantity, {
    groups: [
      { unit: null, sum: 200, recorded: 8 },
      { unit: 'kg', sum: 2.5, recorded: 1 },
    ],
    recorded: 9,
    missing: 1,
  });
});

test('no records gives zero counts and no groups', () => {
  const totals = computeTotals([]);
  assert.equal(totals.recordCount, 0);
  assert.deepEqual(totals.quantity, { groups: [], recorded: 0, missing: 0 });
  assert.deepEqual(totals.cost, { groups: [], recorded: 0, missing: 0 });
});

// ---------- Pareto, against figures worked out by hand from fixtures/pareto-check.csv ----------

const ranking = (rows: { category: string | null; value: number; share: number | null; cumulativeShare: number | null }[]) =>
  rows.map((row) => [row.category, row.value, row.share, row.cumulativeShare]);

test('by NCR count, Labeling leads: 4, 3, 2 and 1 of 10 reports', () => {
  const result = computePareto(check, 'count');
  assert.deepEqual([result.population, result.recorded, result.missing], [10, 10, 0]);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0]?.total, 10);
  assert.deepEqual(ranking(result.series[0]!.rows), [
    ['Labeling', 4, 0.4, 0.4],
    ['Dimensional', 3, 0.3, 0.7],
    ['Material', 2, 0.2, 0.9],
    [null, 1, 0.1, 1],
  ]);
});

test('by affected quantity, Dimensional leads, and kilograms are ranked apart from pieces', () => {
  const result = computePareto(check, 'quantity');
  // PC-010 states no quantity. It is missing, not zero.
  assert.deepEqual([result.population, result.recorded, result.missing], [10, 9, 1]);
  const [pieces, kilograms] = result.series;
  // Values are thousandths: 100 + 80 + 20 = 200 pieces.
  assert.deepEqual([pieces?.unit, pieces?.total, pieces?.recorded], [null, 200_000, 8]);
  assert.deepEqual(ranking(pieces!.rows), [
    ['Dimensional', 100_000, 0.5, 0.5],
    ['Material', 80_000, 0.4, 0.9],
    ['Labeling', 20_000, 0.1, 1],
  ]);
  assert.deepEqual([kilograms?.unit, kilograms?.total, kilograms?.recorded], ['kg', 2_500, 1]);
  assert.deepEqual(ranking(kilograms!.rows), [['Material', 2_500, 1, 1]]);
});

test('by recorded cost, Material leads, and euros are ranked apart from dollars', () => {
  const result = computePareto(check, 'cost');
  // PC-004 and PC-010 state no cost.
  assert.deepEqual([result.population, result.recorded, result.missing], [10, 8, 2]);
  const [eur, usd] = result.series;
  assert.deepEqual([eur?.unit, eur?.total, eur?.recorded], ['EUR', 30_000, 1]);
  // Values are hundredths: 850.00 + 100.00 + 50.00 = 1,000.00 USD.
  assert.deepEqual([usd?.unit, usd?.total, usd?.recorded], ['USD', 100_000, 7]);
  assert.deepEqual(ranking(usd!.rows), [
    ['Material', 85_000, 0.85, 0.85],
    ['Labeling', 10_000, 0.1, 0.95],
    ['Dimensional', 5_000, 0.05, 1],
  ]);
  // Labeling has 4 reports but only 3 state a cost, so only 3 contribute to its bar.
  assert.equal(usd?.rows.find((row) => row.category === 'Labeling')?.records, 3);
});

test('the three metrics put a different category first', () => {
  const leader = (metric: 'count' | 'quantity' | 'cost', unit: string | null) =>
    computePareto(check, metric).series.find((s) => s.unit === unit)?.rows[0]?.category;
  assert.deepEqual([leader('count', null), leader('quantity', null), leader('cost', 'USD')], ['Labeling', 'Dimensional', 'Material']);
});

test('every report is either in exactly one ranking or counted as missing', () => {
  for (const records of [check, sample, []]) {
    for (const metric of PARETO_METRICS) {
      const result = computePareto(records, metric);
      const ranked = result.series.reduce((sum, series) => sum + series.recorded, 0);
      assert.equal(ranked + result.missing, records.length);
      assert.equal(ranked, result.recorded);
      for (const series of result.series) {
        assert.equal(series.rows.reduce((sum, row) => sum + row.value, 0), series.total);
        assert.equal(series.rows.at(-1)?.cumulativeShare, series.total === 0 ? null : 1);
        const values = series.rows.map((row) => row.value);
        assert.deepEqual(values, [...values].sort((a, b) => b - a));
      }
    }
  }
});

test('Pareto totals agree with the overview totals for the same records', () => {
  const totals = computeTotals(sample);
  assert.equal(computePareto(sample, 'count').series[0]?.total, totals.recordCount);
  assert.equal(computePareto(sample, 'quantity').series[0]!.total / 1000, totals.quantity.groups[0]?.sum);
  assert.equal(computePareto(sample, 'cost').series[0]?.total, totals.cost.groups[0]?.sumCents);
  assert.equal(computePareto(sample, 'cost').missing, totals.cost.missing);
});

test('an empty set, a set with no values and a zero total are each reported as what they are', () => {
  assert.deepEqual(computePareto([], 'cost'), { metric: 'cost', population: 0, recorded: 0, missing: 0, excluded: 0, series: [] });

  const noCosts = computePareto([{ defectCategory: 'A', ...q(1), ...c(null) }], 'cost');
  assert.deepEqual([noCosts.population, noCosts.recorded, noCosts.missing, noCosts.series.length], [1, 0, 1, 0]);

  // Costs recorded as zero are values. The total is zero, so there is no share to state.
  const zero = computePareto(
    [
      { defectCategory: 'B', ...q(null), ...c(0, 'USD') },
      { defectCategory: 'A', ...q(null), ...c(0, 'USD') },
    ],
    'cost',
  );
  assert.equal(zero.series[0]?.total, 0);
  assert.deepEqual(ranking(zero.series[0]!.rows), [
    ['A', 0, null, null],
    ['B', 0, null, null],
  ]);
});

test('ties are ordered by name, with uncategorized last among equals', () => {
  const rows = computePareto(
    [{ defectCategory: null }, { defectCategory: 'B' }, { defectCategory: 'A' }].map((r) => ({ ...r, ...q(null), ...c(null) })),
    'count',
  ).series[0]!.rows;
  assert.deepEqual(rows.map((row) => row.category), ['A', 'B', null]);
  // But a larger uncategorized bucket ranks where its size puts it.
  const bigger = computePareto(
    [{ defectCategory: null }, { defectCategory: null }, { defectCategory: 'A' }].map((r) => ({ ...r, ...q(null), ...c(null) })),
    'count',
  ).series[0]!.rows;
  assert.deepEqual(bigger.map((row) => row.category), [null, 'A']);
});

test('the chart, the table and the export describe the same population under a filter', () => {
  for (const base of [NO_FILTER, { ...NO_FILTER, status: 'Open' }, { ...NO_FILTER, search: 'label' }]) {
    const population = filterRecords(check, { ...base, category: undefined });
    for (const metric of PARETO_METRICS) {
      const result = computePareto(population, metric);
      assert.equal(result.population, population.length);
      for (const series of result.series) {
        for (const row of series.rows) {
          // Selecting the bar lists that category's reports; those with a value in this unit are the contributors.
          const listed = filterRecords(check, { ...base, category: row.category });
          const contributing = computePareto(listed, metric).series.find((s) => s.unit === series.unit);
          assert.equal(contributing?.total, row.value);
          assert.equal(contributing?.recorded, row.records);
        }
        const exported = paretoCsv(result, series).trimEnd().split('\r\n').slice(1);
        assert.equal(exported.length, series.rows.length);
        assert.ok(exported.every((line) => line.endsWith(`,${population.length},${result.recorded},${result.excluded}`)));
      }
    }
  }
  // Open reports only: PC-004, PC-007, PC-009 and PC-010.
  const open = computePareto(filterRecords(check, { ...NO_FILTER, status: 'Open' }), 'count');
  assert.deepEqual([open.population, open.series[0]?.rows.length], [4, 4]);
});

test('a cost ranking limited to USD leaves other costs out without converting them or ranking them as zero', () => {
  const result = computePareto(check, 'cost', { costCurrency: 'USD' });
  // Ten reports: 7 state a cost in USD, PC-009 states 300.00 EUR, PC-004 and PC-010 state no cost.
  assert.deepEqual([result.population, result.recorded, result.excluded, result.missing], [10, 7, 1, 2]);
  assert.equal(result.series.length, 1);
  const [usd] = result.series;
  // 850.00 + 100.00 + 50.00 = 1,000.00 USD, the same as the dollar series of the unrestricted ranking.
  assert.deepEqual(usd, computePareto(check, 'cost').series.find((s) => s.unit === 'USD'));
  assert.equal(usd?.total, 100_000);
  // Each bar is the sum of the USD costs on the reports of that category, and of nothing else.
  for (const row of usd!.rows) {
    const contributing = check.filter((r) => r.defectCategory === row.category && r.costCents !== null && r.currency === 'USD');
    assert.equal(row.records, contributing.length);
    assert.equal(row.value, contributing.reduce((sum, r) => sum + r.costCents!, 0));
  }
  // Material's bar is the 850.00 USD report alone; the 300.00 EUR report in the same category adds nothing.
  assert.deepEqual([usd?.rows[0]?.category, usd?.rows[0]?.value, usd?.rows[0]?.records], ['Material', 85_000, 1]);
  // The ranking matches the summary figure for the same reports.
  const cost = costInCurrency(computeTotals(check).cost, 'USD');
  assert.deepEqual([cost.sumCents, cost.recorded, cost.otherCurrency, cost.missing], [usd?.total, result.recorded, result.excluded, result.missing]);

  // Unstated currencies are excluded too, never taken to be USD.
  const mixed = computePareto(
    [
      { defectCategory: 'A', ...q(1), ...c(500) },
      { defectCategory: 'A', ...q(1), ...c(700, 'EUR') },
    ],
    'cost',
    { costCurrency: 'USD' },
  );
  assert.deepEqual([mixed.recorded, mixed.excluded, mixed.missing, mixed.series.length], [0, 2, 0, 0]);

  // The option changes nothing for the other metrics.
  assert.deepEqual(computePareto(check, 'count', { costCurrency: 'USD' }), computePareto(check, 'count'));
  assert.deepEqual(computePareto(check, 'quantity', { costCurrency: 'USD' }), computePareto(check, 'quantity'));
});

test('the export states rank, value, unit, share and cumulative share for each category', () => {
  // As the app exports it: USD only, with the euro report counted in the last column rather than dropped silently.
  const result = computePareto(check, 'cost', { costCurrency: 'USD' });
  const usd = result.series.find((s) => s.unit === 'USD')!;
  assert.equal(
    paretoCsv(result, usd),
    [
      'rank,defect_category,value,unit,share_percent,cumulative_percent,contributing_reports,metric,reports_analysed,reports_with_a_value_for_metric,reports_with_a_cost_in_another_or_no_currency',
      '1,Material,850.00,USD,85.00,85.00,1,Recorded cost,10,7,1',
      '2,Labeling,100.00,USD,10.00,95.00,3,Recorded cost,10,7,1',
      '3,Dimensional,50.00,USD,5.00,100.00,3,Recorded cost,10,7,1',
      '',
    ].join('\r\n'),
  );
  const pieces = computePareto(check, 'quantity');
  assert.match(paretoCsv(pieces, pieces.series[1]!), /\r\n1,Material,2\.5,kg,100\.00,100\.00,1,Affected quantity,10,9,0\r\n$/);
  const counts = computePareto(check, 'count');
  assert.match(paretoCsv(counts, counts.series[0]!), /\r\n4,Uncategorized,1,reports,10\.00,100\.00,1,NCR count,10,10,0\r\n$/);
});

test('exported category names cannot run as spreadsheet formulas or break the columns', () => {
  const result = computePareto(
    [{ defectCategory: '=HYPERLINK("x")' }, { defectCategory: 'Bent, cracked' }].map((r) => ({ ...r, ...q(null), ...c(null) })),
    'count',
  );
  const lines = paretoCsv(result, result.series[0]!).split('\r\n');
  assert.ok(lines[1]?.startsWith('1,"\'=HYPERLINK(""x"")",1,'));
  assert.ok(lines[2]?.startsWith('2,"Bent, cracked",1,'));
});

// ---------- filters ----------

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
