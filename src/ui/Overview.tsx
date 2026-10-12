import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { paretoCsv, PARETO_METRICS, unitLabel } from '../modules/quality/pareto.ts';
import type { ParetoMetric, ParetoResult, ParetoRow, ParetoSeries } from '../modules/quality/pareto.ts';
import { costInCurrency, REPORTING_CURRENCY } from '../modules/quality/totals.ts';
import type { NcrTotals } from '../modules/quality/totals.ts';
import { Icon, Unknown } from './bits.tsx';
import { formatCost, formatPercent, formatQuantity, formatWhole, plural } from './format.ts';

function Metric(props: { label: string; value: ReactNode; coverage: string; help: string }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  return (
    <article className="metric">
      <div className="metric-head">
        <h2 className="metric-label">{props.label}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={open}
          aria-controls={helpId}
          aria-label={`What "${props.label}" means`}
          onClick={() => setOpen(!open)}
        >
          <Icon name="help" />
        </button>
      </div>
      {props.value}
      <p className="metric-coverage">{props.coverage}</p>
      <p className="metric-help" id={helpId} hidden={!open}>
        {props.help}
      </p>
    </article>
  );
}

/** One total per unit, side by side on one line. Quantities in different units are never added together. */
function QuantityValue({ totals }: { totals: NcrTotals }) {
  const { groups } = totals.quantity;
  if (groups.length === 0) {
    return (
      <div className="metric-value">
        <Unknown />
      </div>
    );
  }
  return (
    <div className={`metric-value${groups.length > 1 ? ' is-split' : ''}`}>
      {groups.map((group) => (
        <span className="metric-part" key={group.unit ?? '\u0000pieces'}>
          {formatQuantity(group.sum, null)}
          <span className="metric-unit">{group.unit ?? 'units'}</span>
        </span>
      ))}
    </div>
  );
}

export function MetricCards({ totals, categorized }: { totals: NcrTotals; categorized: number }) {
  const n = totals.recordCount;
  const cost = costInCurrency(totals.cost, REPORTING_CURRENCY);
  const others =
    cost.otherCurrency === 0
      ? ''
      : ` ${plural(cost.otherCurrency, 'report')} ${cost.otherCurrency === 1 ? 'has' : 'have'} a cost in another currency or with no currency stated. ${cost.otherCurrency === 1 ? 'It is' : 'They are'} kept as recorded, not converted and not counted as zero.`;
  return (
    <section className="metrics" aria-label="Totals for all stored reports">
      <Metric
        label="NCR reports"
        value={<div className="metric-value">{formatWhole(n)}</div>}
        coverage={`Category in ${formatWhole(categorized)} of ${formatWhole(n)} reports`}
        help="The number of non-conformance reports stored. Each report counts once, however many units it covers. The line above says how many of them state a defect category."
      />
      <Metric
        label="Affected quantity"
        value={<QuantityValue totals={totals} />}
        coverage={`Quantity in ${formatWhole(totals.quantity.recorded)} of ${formatWhole(n)} reports`}
        help="The quantity the reports say was affected, added up. With no unit it is a count of pieces. A report with no quantity is left out of the sum; it is not counted as zero. Quantities in different units are never added together."
      />
      <Metric
        label={`Recorded cost (${REPORTING_CURRENCY})`}
        value={
          cost.sumCents === null ? (
            <div className="metric-value is-empty">No {REPORTING_CURRENCY} costs recorded.</div>
          ) : (
            <div className="metric-value">{formatCost(cost.sumCents, REPORTING_CURRENCY)}</div>
          )
        }
        coverage={`${REPORTING_CURRENCY} cost recorded in ${formatWhole(cost.recorded)} of ${formatWhole(n)} reports`}
        help={`Cost as written on the reports, added up for the reports that state it in ${REPORTING_CURRENCY}. It is not an estimate of the total cost of poor quality. A report with no cost is left out of the sum.${others}`}
      />
    </section>
  );
}

// ---------- Pareto ----------

const METRIC_LABELS: Record<ParetoMetric, { button: string; title: string; noun: string; column: string }> = {
  count: { button: 'NCR reports', title: 'NCR reports by category', noun: 'reports', column: 'Reports' },
  quantity: { button: 'Affected quantity', title: 'Affected quantity by category', noun: 'affected quantity', column: 'Quantity' },
  cost: {
    button: `Recorded cost (${REPORTING_CURRENCY})`,
    title: `Recorded cost (${REPORTING_CURRENCY}) by category`,
    noun: 'recorded cost',
    column: 'Cost',
  },
};

const AXIS_TICKS = [0, 25, 50, 75, 100];

/** A value as people read it: 12 reports, 2.5 kg, $850.00. */
function displayValue(metric: ParetoMetric, value: number, unit: string | null): string {
  if (metric === 'count') return formatWhole(value);
  if (metric === 'quantity') return formatQuantity(value / 1000, unit);
  return formatCost(value, unit);
}

function coverageText(result: ParetoResult, series: ParetoSeries | undefined): string {
  const n = formatWhole(result.population);
  if (result.metric === 'count') {
    const uncategorized = series?.rows.find((row) => row.category === null)?.value ?? 0;
    return uncategorized === 0
      ? `All ${n} reports are ranked, and each states a category.`
      : `All ${n} reports are ranked. ${plural(uncategorized, 'report')} ${uncategorized === 1 ? 'states' : 'state'} no category and ${uncategorized === 1 ? 'is' : 'are'} shown as Uncategorized.`;
  }
  if (result.metric === 'cost') {
    // The ranking is of one currency only; say what that leaves out, and that none of it is zero.
    const other =
      result.excluded === 0
        ? ''
        : ` ${plural(result.excluded, 'report')} with a cost in another currency or with no currency stated ${result.excluded === 1 ? 'is' : 'are'} not ranked and not converted.`;
    const none = result.missing === 0 ? '' : ` ${plural(result.missing, 'report')} with no cost ${result.missing === 1 ? 'is' : 'are'} not ranked.`;
    const notZero = result.excluded + result.missing === 0 ? '' : ' None of these is treated as zero.';
    return `${REPORTING_CURRENCY} cost recorded in ${formatWhole(result.recorded)} of ${n} reports.${other}${none}${notZero}`;
  }
  const left = result.missing === 0 ? '' : ` ${plural(result.missing, 'report')} with no quantity ${result.missing === 1 ? 'is' : 'are'} not ranked; ${result.missing === 1 ? 'it is' : 'they are'} not treated as zero.`;
  const split =
    result.series.length > 1 && series !== undefined
      ? ` This ranking covers the ${formatWhole(series.recorded)} in ${unitLabel(result.metric, series.unit)}; other units are ranked separately.`
      : '';
  return `Quantity recorded in ${formatWhole(result.recorded)} of ${n} reports.${left}${split}`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ParetoPanel(props: {
  /** Computed over exactly the reports the search and status filters allow. */
  result: ParetoResult;
  /** Number of stored reports before filtering. */
  stored: number;
  /** Reports per category in that same population, whether or not they have a value for the metric. */
  categoryCounts: ReadonlyMap<string | null, number>;
  onMetric: (metric: ParetoMetric) => void;
  /** The quantity unit being ranked, when there is more than one. */
  seriesUnit: string | null | undefined;
  onSeries: (unit: string | null) => void;
  selected: string | null | undefined;
  onSelect: (category: string | null | undefined) => void;
}) {
  const { result, stored, selected, onSelect } = props;
  const metric = result.metric;
  const labels = METRIC_LABELS[metric];
  const [helpOpen, setHelpOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null | undefined>(undefined);
  const helpId = useId();

  // Fall back to the unit most of these reports use if the wanted one is not among them.
  const series =
    result.series.find((s) => props.seriesUnit !== undefined && s.unit === props.seriesUnit) ??
    [...result.series].sort((a, b) => b.recorded - a.recorded)[0];
  const rows = series?.rows ?? [];
  const rowHeight = 32;
  const filtered = result.population !== stored;

  const rowText = (row: ParetoRow): ReactNode => {
    const name = row.category ?? 'Uncategorized';
    const inCategory = props.categoryCounts.get(row.category) ?? row.records;
    const without = inCategory - row.records;
    return (
      <>
        <strong>{name}</strong>: {displayValue(metric, row.value, series!.unit)}
        {metric === 'count' ? ` ${row.value === 1 ? 'report' : 'reports'}` : ''}
        {row.share === null
          ? '. The total is zero, so it has no share.'
          : `, ${formatPercent(row.share)} of ${displayValue(metric, series!.total, series!.unit)}. Cumulative ${formatPercent(row.cumulativeShare!)}.`}{' '}
        {metric !== 'count' &&
          `${plural(row.records, 'report')} ${row.records === 1 ? 'contributes' : 'contribute'}` +
            (without > 0
              ? `; ${without} more in this category ${without === 1 ? 'has' : 'have'} no ${labels.noun} in ${unitLabel(metric, series!.unit)}.`
              : '.')}
      </>
    );
  };

  const focusRow = rows.find((row) => hovered !== undefined && row.category === hovered) ?? rows.find((row) => selected !== undefined && row.category === selected);

  return (
    <section className="card pareto" aria-labelledby="chart-title">
      <div className="pareto-head">
        <div>
          <p className="pareto-eyebrow">Pareto analysis</p>
          <h2 className="section-title" id="chart-title">
            {labels.title}
          </h2>
        </div>
        <div className="pareto-controls">
          <div className="seg" role="group" aria-label="Metric to rank by">
            {PARETO_METRICS.map((option) => (
              <button key={option} type="button" aria-pressed={option === metric} onClick={() => props.onMetric(option)}>
                {METRIC_LABELS[option].button}
              </button>
            ))}
          </div>
          {metric === 'quantity' && result.series.length > 1 && series !== undefined && (
            <div className="seg" role="group" aria-label="Unit to rank">
              {result.series.map((option) => (
                <button
                  key={option.unit ?? '\u0000none'}
                  type="button"
                  aria-pressed={option.unit === series.unit}
                  onClick={() => props.onSeries(option.unit)}
                >
                  {option.unit ?? 'Units'} · {formatWhole(option.recorded)}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn"
            disabled={series === undefined}
            onClick={() =>
              series !== undefined &&
              download(`valynce-pareto-${metric}-${(series.unit ?? (metric === 'count' ? 'reports' : metric === 'quantity' ? 'units' : 'unspecified')).toLowerCase()}.csv`, paretoCsv(result, series))
            }
          >
            <Icon name="download" />
            Export CSV
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-label="How to read this chart"
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <Icon name="help" />
          </button>
        </div>
      </div>

      <p className="pareto-note" id="pareto-coverage">
        {filtered && `Showing ${formatWhole(result.population)} of ${formatWhole(stored)} reports that match the search and status filter. `}
        {coverageText(result, series)}
      </p>

      <div className="pareto-help" id={helpId} hidden={!helpOpen}>
        <ul>
          <li>
            <strong>Bars</strong> rank the categories from largest to smallest by the chosen metric. Each bar's length is the
            category's share of the total.
          </li>
          <li>
            <strong>Share</strong> is the category's value divided by the total of the values that were recorded.
          </li>
          <li>
            <strong>Cumulative</strong> is the running sum of shares down the ranking. The line and dots mark it on the same
            0 to 100% scale as the bars.
          </li>
          <li>
            <strong>NCR reports</strong> counts each report once. <strong>Affected quantity</strong> adds the quantities
            reported, one unit at a time. <strong>Recorded cost ({REPORTING_CURRENCY})</strong> adds the costs the reports
            state in {REPORTING_CURRENCY}. Costs in other currencies, or with no currency stated, are kept as recorded and
            are not converted or ranked here.
          </li>
          <li>
            The chart, the table below it and the exported file all use the same reports: those matching the search and
            status filter.
          </li>
        </ul>
      </div>

      {result.population === 0 ? (
        <p className="pareto-empty">No reports match the current search and status filter, so there is nothing to rank.</p>
      ) : series === undefined && metric === 'cost' ? (
        <p className="pareto-empty">No {REPORTING_CURRENCY} costs recorded. There is nothing to rank by recorded cost.</p>
      ) : series === undefined ? (
        <p className="pareto-empty">
          None of the {plural(result.population, 'report')} {result.population === 1 ? 'states' : 'state'} a quantity, so there is
          nothing to rank by {labels.noun}.
        </p>
      ) : (
        <>
          <div className="pareto-colhead">
            <span>Category</span>
            <span className="pareto-axis" aria-hidden="true">
              {AXIS_TICKS.map((tick) => (
                <span key={tick} className={tick % 50 === 0 ? undefined : 'minor'} style={{ left: `${tick}%` }}>
                  {tick}%
                </span>
              ))}
            </span>
            <span className="num">
              {labels.column}
              {metric !== 'count' && ` (${unitLabel(metric, series.unit)})`}
            </span>
            <span className="num col-share">Share</span>
            <span className="num">Cumulative</span>
          </div>

          <div className="pareto-rows">
            <ul className="bars" onMouseLeave={() => setHovered(undefined)}>
              {rows.map((row) => {
                const pressed = selected !== undefined && selected === row.category;
                const name = row.category ?? 'Uncategorized';
                return (
                  <li key={row.category ?? '\u0000uncategorized'}>
                    <button
                      type="button"
                      className={`bar${row.category === null ? ' is-uncategorized' : ''}`}
                      aria-pressed={pressed}
                      aria-label={`${name}: ${displayValue(metric, row.value, series.unit)}${row.share === null ? '' : `, ${formatPercent(row.share)} share, ${formatPercent(row.cumulativeShare!)} cumulative`}. Show its reports.`}
                      onClick={() => onSelect(pressed ? undefined : row.category)}
                      onMouseEnter={() => setHovered(row.category)}
                      onFocus={() => setHovered(row.category)}
                      onBlur={() => setHovered(undefined)}
                    >
                      <span className="bar-label">{name}</span>
                      <span className="bar-track" aria-hidden="true">
                        {row.share !== null && <span className="bar-fill" style={{ width: `${row.share * 100}%` }} />}
                      </span>
                      <span className="bar-count">{displayValue(metric, row.value, metric === 'quantity' ? null : series.unit)}</span>
                      <span className="bar-share">{row.share === null ? <Unknown /> : formatPercent(row.share)}</span>
                      <span className="bar-cum">{row.cumulativeShare === null ? <Unknown /> : formatPercent(row.cumulativeShare)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="pareto-overlay" aria-hidden="true">
              <svg>
                {AXIS_TICKS.slice(1).map((tick) => (
                  <line key={tick} className="grid" x1={`${tick}%`} x2={`${tick}%`} y1="0" y2="100%" />
                ))}
                {series.total > 0 &&
                  rows.slice(1).map((row, index) => (
                    <line
                      key={row.category ?? '\u0000uncategorized'}
                      className="cum-line"
                      x1={`${rows[index]!.cumulativeShare! * 100}%`}
                      y1={index * rowHeight + rowHeight / 2}
                      x2={`${row.cumulativeShare! * 100}%`}
                      y2={(index + 1) * rowHeight + rowHeight / 2}
                    />
                  ))}
                {series.total > 0 &&
                  rows.map((row, index) => (
                    <circle
                      key={row.category ?? '\u0000uncategorized'}
                      className="cum-dot"
                      cx={`${row.cumulativeShare! * 100}%`}
                      cy={index * rowHeight + rowHeight / 2}
                      r="4"
                    />
                  ))}
              </svg>
            </div>
          </div>

          {series.total === 0 && (
            <p className="pareto-note">
              Every recorded {metric === 'quantity' ? 'quantity' : 'cost'} here is zero, so the total is zero and shares cannot be
              worked out. The categories are listed without bars.
            </p>
          )}

          <div className="pareto-legend" aria-hidden="true">
            <span>
              <i className="legend-bar" /> Share of total
            </span>
            <span>
              <i className="legend-line" /> Cumulative share
            </span>
          </div>

          <p className="pareto-readout" aria-live="polite">
            {focusRow !== undefined ? (
              <>
                {rowText(focusRow)}
                {selected !== undefined && focusRow.category === selected && ' Its reports are listed below.'}
              </>
            ) : (
              'Point at a category for its figures. Select one to list its reports below.'
            )}
          </p>

          <p className="pareto-note">
            This ranking shows where {metric === 'count' ? 'reports are' : metric === 'quantity' ? 'affected quantity is' : 'cost is'}{' '}
            recorded. It does not show why, and the leading category is not a verified root cause.
          </p>
        </>
      )}
    </section>
  );
}
