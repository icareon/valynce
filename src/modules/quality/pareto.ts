// Pareto analysis: defect categories ranked from largest to smallest by one
// metric, with each category's share of the total and the running share.
// A ranking shows where reports, quantity or cost are recorded. It does not
// say why, and the leading category is not a root cause.
import { toMilli } from '../../core/ncr.ts';
import type { NcrFields } from '../../core/ncr.ts';

export type ParetoMetric = 'count' | 'quantity' | 'cost';

export const PARETO_METRICS: readonly ParetoMetric[] = ['count', 'quantity', 'cost'];

export interface ParetoRow {
  /** The defect category as written. Null is the reports with no category. */
  category: string | null;
  /** Reports for count, thousandths of the unit for quantity, hundredths of the currency for cost. */
  value: number;
  /** How many reports contribute to `value`. */
  records: number;
  /** `value` as a fraction of the series total. Null when the total is zero. */
  share: number | null;
  /** The running sum of shares down the ranking. Null when the total is zero. */
  cumulativeShare: number | null;
}

/** One ranking. Quantity has a series per unit and cost a series per currency, because they cannot be added. */
export interface ParetoSeries {
  /** The quantity unit or currency code. Null is piece counts, an unstated currency, or the count metric. */
  unit: string | null;
  total: number;
  /** Reports that have a value in this unit. */
  recorded: number;
  rows: ParetoRow[];
}

export interface ParetoResult {
  metric: ParetoMetric;
  /** Number of reports analysed. */
  population: number;
  /** Reports with a value for the metric, across all series. */
  recorded: number;
  /** Reports with no value for the metric. They appear in no series. */
  missing: number;
  /**
   * Reports that have a cost, but not in the one currency the ranking was limited to.
   * They appear in no series and are not converted. Zero unless `costCurrency` was given.
   */
  excluded: number;
  series: ParetoSeries[];
}

type ParetoInput = Pick<NcrFields, 'defectCategory' | 'quantityAffected' | 'quantityUnit' | 'costCents' | 'currency'>;

/** The record's value for a metric and the unit it is in, or null when it has no value. */
function measure(record: ParetoInput, metric: ParetoMetric): { unit: string | null; value: number } | null {
  if (metric === 'count') return { unit: null, value: 1 };
  if (metric === 'quantity') {
    if (record.quantityAffected === null) return null;
    return { unit: record.quantityUnit, value: toMilli(record.quantityAffected) ?? 0 };
  }
  return record.costCents === null ? null : { unit: record.currency, value: record.costCents };
}

export interface ParetoOptions {
  /**
   * Rank cost in this currency only. A cost in another currency, or with none
   * stated, is counted as excluded: it is not converted and not treated as zero.
   */
  costCurrency?: string;
}

/**
 * Ranks defect categories by the chosen metric over exactly the records given.
 * Every record is accounted for: it is in one series, counted as missing, or
 * counted as excluded because its cost is not in the currency asked for.
 */
export function computePareto(records: readonly ParetoInput[], metric: ParetoMetric, options: ParetoOptions = {}): ParetoResult {
  const bySeries = new Map<string | null, Map<string | null, { value: number; records: number }>>();
  const onlyCurrency = metric === 'cost' ? options.costCurrency : undefined;
  let missing = 0;
  let excluded = 0;

  for (const record of records) {
    const measured = measure(record, metric);
    if (measured === null) {
      missing += 1;
      continue;
    }
    if (onlyCurrency !== undefined && measured.unit !== onlyCurrency) {
      excluded += 1;
      continue;
    }
    const categories = bySeries.get(measured.unit) ?? new Map<string | null, { value: number; records: number }>();
    const entry = categories.get(record.defectCategory) ?? { value: 0, records: 0 };
    entry.value += measured.value;
    entry.records += 1;
    categories.set(record.defectCategory, entry);
    bySeries.set(measured.unit, categories);
  }

  const series: ParetoSeries[] = [...bySeries.entries()].map(([unit, categories]) => {
    const ranked = [...categories.entries()]
      .map(([category, entry]) => ({ category, ...entry }))
      .sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        if (a.category === null) return 1;
        if (b.category === null) return -1;
        return a.category.localeCompare(b.category);
      });
    const total = ranked.reduce((sum, row) => sum + row.value, 0);
    let running = 0;
    const rows = ranked.map((row) => {
      running += row.value;
      return {
        ...row,
        share: total === 0 ? null : row.value / total,
        cumulativeShare: total === 0 ? null : running / total,
      };
    });
    return { unit, total, recorded: ranked.reduce((sum, row) => sum + row.records, 0), rows };
  });

  // Piece counts before named units; stated currencies before an unstated one.
  series.sort((a, b) => {
    if (a.unit === b.unit) return 0;
    if (a.unit === null) return metric === 'cost' ? 1 : -1;
    if (b.unit === null) return metric === 'cost' ? -1 : 1;
    return a.unit.localeCompare(b.unit);
  });

  return { metric, population: records.length, recorded: records.length - missing - excluded, missing, excluded, series };
}

/**
 * The series to show: the wanted unit when it is among the results, otherwise
 * the unit most of these reports use. Undefined when nothing can be ranked.
 */
export function pickSeries(result: ParetoResult, wantedUnit: string | null | undefined): ParetoSeries | undefined {
  return (
    result.series.find((s) => wantedUnit !== undefined && s.unit === wantedUnit) ??
    [...result.series].sort((a, b) => b.recorded - a.recorded)[0]
  );
}

/** A value in plain digits with a point as the decimal separator, for files rather than screens. */
export function plainValue(metric: ParetoMetric, value: number): string {
  if (metric === 'count') return String(value);
  if (metric === 'cost') return (value / 100).toFixed(2);
  return String(value / 1000);
}

export function unitLabel(metric: ParetoMetric, unit: string | null): string {
  if (metric === 'count') return 'reports';
  if (metric === 'quantity') return unit ?? 'units';
  return unit ?? 'currency unspecified';
}

function csvCell(value: string): string {
  // A leading =, +, - or @ would be run as a formula by a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const METRIC_NAMES: Record<ParetoMetric, string> = {
  count: 'NCR count',
  quantity: 'Affected quantity',
  cost: 'Recorded cost',
};

/**
 * One series as CSV, built from the same result the chart draws, so the file
 * and the screen cannot disagree. Every row repeats the metric, unit, the number
 * of reports analysed and how many were left out, so the file explains itself.
 */
export function paretoCsv(result: ParetoResult, series: ParetoSeries): string {
  const percent = (share: number | null) => (share === null ? '' : (share * 100).toFixed(2));
  const header = [
    'rank',
    'defect_category',
    'value',
    'unit',
    'share_percent',
    'cumulative_percent',
    'contributing_reports',
    'metric',
    'reports_analysed',
    'reports_with_a_value_for_metric',
    'reports_with_a_cost_in_another_or_no_currency',
  ];
  const lines = series.rows.map((row, index) =>
    [
      String(index + 1),
      row.category ?? 'Uncategorized',
      plainValue(result.metric, row.value),
      unitLabel(result.metric, series.unit),
      percent(row.share),
      percent(row.cumulativeShare),
      String(row.records),
      METRIC_NAMES[result.metric],
      String(result.population),
      String(result.recorded),
      String(result.excluded),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
