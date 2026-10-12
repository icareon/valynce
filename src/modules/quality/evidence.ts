// The evidence bundle: exactly what a summary request may send to a model, and
// nothing else. It is built from the same population, metric and ranking as the
// chart, so a summary cannot describe different reports from the ones on screen.
// Figures in it are computed here, never by the model.
import type { NcrRecord } from '../../core/ncr.ts';
import { filterRecords } from './filter.ts';
import { computePareto, PARETO_METRICS, pickSeries, plainValue, unitLabel } from './pareto.ts';
import type { ParetoMetric } from './pareto.ts';
import { REPORTING_CURRENCY } from './totals.ts';

/** The most reports one request may carry. A larger selection is refused, never cut short. */
export const MAX_EVIDENCE_RECORDS = 200;
/** The most categories one request may carry. */
export const MAX_EVIDENCE_CATEGORIES = 40;
/** A longer description or reported cause is shortened to this many characters, and the request says so. */
export const MAX_EVIDENCE_TEXT = 400;

/** What the chart is showing when a summary is asked for. */
export interface AnalysisScope {
  metric: ParetoMetric;
  /** The quantity unit being ranked; null is a count of pieces. Ignored for NCR count and for cost, which is always USD. */
  unit: string | null;
  search: string;
  /** Absent matches every status. Null matches reports with no status. */
  status?: string | null;
  /** The category selected in the chart. Absent means none. Null is the reports with no category. */
  category?: string | null;
}

/** Checks a scope that arrived over the network. Returns a message when it cannot be used. */
export function parseScope(input: unknown): AnalysisScope | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'The analysis scope is missing.';
  const raw = input as Record<string, unknown>;
  if (!PARETO_METRICS.includes(raw.metric as ParetoMetric)) return 'The metric is not valid.';
  if (raw.unit !== null && raw.unit !== undefined && (typeof raw.unit !== 'string' || raw.unit.length > 20)) return 'The unit is not valid.';
  if (typeof raw.search !== 'string' || raw.search.length > 200) return 'The search text is not valid.';
  for (const key of ['status', 'category'] as const) {
    const value = raw[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 500)) return `The ${key} filter is not valid.`;
  }
  const scope: AnalysisScope = { metric: raw.metric as ParetoMetric, unit: (raw.unit as string | null | undefined) ?? null, search: raw.search };
  if (raw.status !== undefined) scope.status = raw.status as string | null;
  if (raw.category !== undefined) scope.category = raw.category as string | null;
  return scope;
}

export interface EvidenceCategory {
  rank: number;
  /** The defect category as written, or "Uncategorized" for reports that state none. */
  category: string;
  uncategorized: boolean;
  /** In the metric's unit, as plain digits. */
  value: string;
  /** Percent of the total, two decimals. Null when the total is zero. */
  sharePercent: string | null;
  cumulativePercent: string | null;
  /** Reports that contribute to the value. */
  contributingReports: number;
  /** Reports in this category in the population, with or without a value. */
  reportsInCategory: number;
}

export type EvidenceValueStatus = 'recorded' | 'not_recorded' | 'cost_in_another_or_no_currency' | 'quantity_in_another_unit';

export interface EvidenceRecord {
  /** The report's NCR ID. This is the only identifier a summary may cite. */
  id: string;
  openedOn: string | null;
  defectCategory: string | null;
  description: string | null;
  status: string | null;
  disposition: string | null;
  /** As written on the report. Not a verified root cause. */
  reportedCause: string | null;
  /** The report's value for the metric, in the metric's unit. Null unless valueStatus is "recorded". */
  value: string | null;
  valueStatus: EvidenceValueStatus;
  /** True when description or reportedCause was shortened to the length limit. */
  textShortened: boolean;
}

export interface EvidenceBundle {
  metric: { key: ParetoMetric; name: string; unit: string };
  filters: { search: string | null; status: string | null; selectedCategory: string | null };
  storedReports: number;
  /** Reports matching the search and status filter: the population the chart ranks. */
  populationReports: number;
  coverage: {
    /** Reports with a value in the ranked unit or currency. */
    rankedReports: number;
    /** Reports with no value for the metric. Not ranked and not zero. */
    notRecorded: number;
    /** Reports with a cost in another currency or with none stated. Not ranked, not converted, not zero. */
    costInAnotherOrNoCurrency: number;
    /** Quantities in other units, ranked separately and never added to this one. */
    quantityInOtherUnits: { unit: string; reports: number }[];
  };
  /** Sum of the ranked values, in the metric's unit. */
  total: string;
  categories: EvidenceCategory[];
  recordsCover: 'all_reports_in_population' | 'selected_category_only';
  records: EvidenceRecord[];
}

/** What the user is shown before anything is sent. */
export interface EvidenceDisclosure {
  recordCount: number;
  categoryCount: number;
  /** Fields sent for each report, in words. */
  fieldsSent: string[];
  /** Fields that are stored but never sent. */
  fieldsWithheld: string[];
  /** Reports whose description or reported cause is shortened. */
  shortenedTexts: number;
}

export type EvidenceRefusal = 'no_reports' | 'nothing_to_rank' | 'empty_category' | 'too_many_records' | 'too_many_categories';

export type EvidenceResult =
  | { ok: true; bundle: EvidenceBundle; disclosure: EvidenceDisclosure; facts: string[] }
  | { ok: false; reason: EvidenceRefusal; message: string };

const METRIC_NAMES: Record<ParetoMetric, string> = {
  count: 'NCR count',
  quantity: 'Affected quantity',
  cost: `Recorded cost (${REPORTING_CURRENCY})`,
};

export const FIELDS_SENT = [
  'NCR ID',
  'opened date',
  'defect category',
  'description',
  'status',
  'disposition',
  'reported cause',
] as const;

export const FIELDS_WITHHELD = ['supplier', 'part number', 'original file cells', 'file name and row number'] as const;

const percent = (share: number | null): string | null => (share === null ? null : (share * 100).toFixed(2));
const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const many = (count: number, one: string, more = `${one}s`): string => `${group(String(count))} ${count === 1 ? one : more}`;

/** A value as a sentence would write it, in one fixed format: 4 reports, 100 units, 2.5 kg, $850.00. */
function written(metric: ParetoMetric, value: number, unit: string | null): string {
  const [whole, fraction] = plainValue(metric, value).split('.');
  const digits = group(whole!) + (fraction === undefined ? '' : `.${fraction}`);
  if (metric === 'count') return `${digits} ${value === 1 ? 'report' : 'reports'}`;
  if (metric === 'quantity') return `${digits} ${unit ?? (value === 1000 ? 'unit' : 'units')}`;
  return unit === 'USD' ? `$${digits}` : `${digits} ${unit ?? ''}`.trim();
}

function shorten(text: string | null): { text: string | null; cut: boolean } {
  if (text === null || text.length <= MAX_EVIDENCE_TEXT) return { text, cut: false };
  return { text: `${text.slice(0, MAX_EVIDENCE_TEXT)} [shortened]`, cut: true };
}

/**
 * Builds the evidence for one analysis from the stored reports. The population
 * is the reports matching search and status, as for the chart. The reports
 * listed are that population, or only the selected category when one is selected.
 */
export function buildEvidence(stored: readonly NcrRecord[], scope: AnalysisScope): EvidenceResult {
  const { metric } = scope;
  const population = filterRecords(stored, { search: scope.search, status: scope.status, category: undefined });
  if (population.length === 0) {
    return { ok: false, reason: 'no_reports', message: 'No reports match the current search and status filter, so there is nothing to summarise.' };
  }
  const result = computePareto(population, metric, { costCurrency: REPORTING_CURRENCY });
  const series = pickSeries(result, metric === 'quantity' ? scope.unit : undefined);
  if (series === undefined) {
    return {
      ok: false,
      reason: 'nothing_to_rank',
      message: metric === 'cost' ? `No ${REPORTING_CURRENCY} costs recorded, so there is no ranking to summarise.` : 'None of these reports states a quantity, so there is no ranking to summarise.',
    };
  }
  if (series.rows.length > MAX_EVIDENCE_CATEGORIES) {
    return {
      ok: false,
      reason: 'too_many_categories',
      message: `This analysis has ${group(String(series.rows.length))} categories. A summary request carries at most ${MAX_EVIDENCE_CATEGORIES}. Narrow the reports with the search or the status filter.`,
    };
  }

  const selected = scope.category !== undefined;
  const listed = selected ? population.filter((r) => r.defectCategory === scope.category) : population;
  if (listed.length === 0) {
    return { ok: false, reason: 'empty_category', message: 'The selected category has no reports under the current search and status filter.' };
  }
  if (listed.length > MAX_EVIDENCE_RECORDS) {
    return {
      ok: false,
      reason: 'too_many_records',
      message:
        `This selection has ${many(listed.length, 'report')}. A summary request carries at most ${MAX_EVIDENCE_RECORDS}, and Valynce does not send a partial selection. ` +
        (selected ? 'Narrow it with the search or the status filter.' : 'Narrow it with the search or the status filter, or select one category in the chart.'),
    };
  }

  const inCategory = new Map<string | null, number>();
  for (const r of population) inCategory.set(r.defectCategory, (inCategory.get(r.defectCategory) ?? 0) + 1);

  const unit = unitLabel(metric, series.unit);
  const categories: EvidenceCategory[] = series.rows.map((row, index) => ({
    rank: index + 1,
    category: row.category ?? 'Uncategorized',
    uncategorized: row.category === null,
    value: plainValue(metric, row.value),
    sharePercent: percent(row.share),
    cumulativePercent: percent(row.cumulativeShare),
    contributingReports: row.records,
    reportsInCategory: inCategory.get(row.category) ?? row.records,
  }));

  let shortenedTexts = 0;
  const records: EvidenceRecord[] = [...listed]
    .sort((a, b) => a.ncrNumber.localeCompare(b.ncrNumber))
    .map((r) => {
      const description = shorten(r.description);
      const cause = shorten(r.reportedCause);
      if (description.cut || cause.cut) shortenedTexts += 1;
      let value: string | null = null;
      let valueStatus: EvidenceValueStatus = 'recorded';
      if (metric === 'count') {
        value = '1';
      } else if (metric === 'quantity') {
        if (r.quantityAffected === null) valueStatus = 'not_recorded';
        else if (r.quantityUnit !== series.unit) valueStatus = 'quantity_in_another_unit';
        else value = String(r.quantityAffected);
      } else if (r.costCents === null) {
        valueStatus = 'not_recorded';
      } else if (r.currency !== REPORTING_CURRENCY) {
        valueStatus = 'cost_in_another_or_no_currency';
      } else {
        value = plainValue('cost', r.costCents);
      }
      return {
        id: r.ncrNumber,
        openedOn: r.openedOn,
        defectCategory: r.defectCategory,
        description: description.text,
        status: r.status,
        disposition: r.disposition,
        reportedCause: cause.text,
        value,
        valueStatus,
        textShortened: description.cut || cause.cut,
      };
    });

  const otherUnits = metric === 'quantity' ? result.series.filter((s) => s !== series).map((s) => ({ unit: unitLabel(metric, s.unit), reports: s.recorded })) : [];
  const bundle: EvidenceBundle = {
    metric: { key: metric, name: METRIC_NAMES[metric], unit },
    filters: {
      search: scope.search.trim() === '' ? null : scope.search.trim(),
      status: scope.status === undefined ? null : (scope.status ?? 'Not recorded'),
      selectedCategory: selected ? (scope.category ?? 'Uncategorized') : null,
    },
    storedReports: stored.length,
    populationReports: population.length,
    coverage: {
      rankedReports: series.recorded,
      notRecorded: result.missing,
      costInAnotherOrNoCurrency: result.excluded,
      quantityInOtherUnits: otherUnits,
    },
    total: plainValue(metric, series.total),
    categories,
    recordsCover: selected ? 'selected_category_only' : 'all_reports_in_population',
    records,
  };

  // The figures a person reads beside the summary. Written here, from the ranking, not by the model.
  const facts: string[] = [];
  const filters: string[] = [];
  if (bundle.filters.search !== null) filters.push(`search "${bundle.filters.search}"`);
  if (scope.status !== undefined) filters.push(scope.status === null ? 'no status recorded' : `status "${scope.status}"`);
  facts.push(
    filters.length === 0
      ? `Scope: all ${many(population.length, 'stored report')}, ranked by ${METRIC_NAMES[metric]}${metric === 'quantity' ? ` in ${unit}` : ''}.`
      : `Scope: ${group(String(population.length))} of ${many(stored.length, 'stored report')} (${filters.join(', ')}), ranked by ${METRIC_NAMES[metric]}${metric === 'quantity' ? ` in ${unit}` : ''}.`,
  );
  if (metric === 'count') {
    facts.push(`Total: ${written(metric, series.total, null)} in ${many(categories.length, 'category', 'categories')}.`);
  } else {
    const left: string[] = [];
    if (result.excluded > 0) left.push(`${many(result.excluded, 'report')} with a cost in another currency or with no currency stated`);
    for (const other of otherUnits) left.push(`${many(other.reports, 'report')} with a quantity in ${other.unit}`);
    if (result.missing > 0) left.push(`${many(result.missing, 'report')} with no ${metric === 'cost' ? 'cost' : 'quantity'}`);
    facts.push(
      `Total: ${written(metric, series.total, series.unit)} from ${group(String(series.recorded))} of ${many(population.length, 'report')}.` +
        (left.length === 0 ? '' : ` Not ranked, not converted and not counted as zero: ${left.join('; ')}.`),
    );
  }
  for (const [index, row] of series.rows.slice(0, 3).entries()) {
    const c = categories[index]!;
    facts.push(
      `${c.rank}. ${c.category}: ${written(metric, row.value, series.unit)}` +
        (row.share === null ? ' (the total is zero, so there is no share)' : `, ${(row.share * 100).toFixed(1)}% of the total`) +
        (metric === 'count' ? '.' : `, from ${many(row.records, 'report')}.`),
    );
  }
  if (categories.length > 3) facts.push(`${many(categories.length - 3, 'more category', 'more categories')} ranked below these.`);
  facts.push(
    selected
      ? `Reports sent to the model: the ${many(records.length, 'report')} in ${bundle.filters.selectedCategory}. Category totals cover the whole scope.`
      : `Reports sent to the model: all ${many(records.length, 'report')} in scope.`,
  );

  return {
    ok: true,
    bundle,
    disclosure: {
      recordCount: records.length,
      categoryCount: categories.length,
      fieldsSent: [...FIELDS_SENT, ...(metric === 'cost' ? [`recorded cost when stated in ${REPORTING_CURRENCY}`] : metric === 'quantity' ? [`affected quantity when stated in ${unit}`] : [])],
      fieldsWithheld: [...FIELDS_WITHHELD, ...(metric === 'cost' ? [] : ['recorded cost']), ...(metric === 'quantity' ? [] : ['affected quantity'])],
      shortenedTexts,
    },
    facts,
  };
}
