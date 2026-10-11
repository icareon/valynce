import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { CategoryCount } from '../modules/quality/categories.ts';
import type { NcrTotals } from '../modules/quality/totals.ts';
import { Icon, Unknown } from './bits.tsx';
import { formatCost, formatWhole, plural } from './format.ts';

function Metric(props: { label: string; value: ReactNode; coverage: string; help: string }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  return (
    <article className="card metric">
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

function CostValue({ totals }: { totals: NcrTotals }) {
  const { groups } = totals.cost;
  const [only] = groups;
  if (only === undefined) {
    return (
      <div className="metric-value">
        <Unknown />
      </div>
    );
  }
  if (groups.length === 1) {
    return (
      <div className="metric-value">
        {formatCost(only.sumCents, only.currency)}
        {only.currency === null && <span className="tag">Currency unspecified</span>}
      </div>
    );
  }
  // Several currencies: one total each. They are never added together.
  return (
    <ul className="metric-costs">
      {groups.map((group) => (
        <li key={group.currency ?? 'unspecified'}>
          <span className="amount">{formatCost(group.sumCents, group.currency)}</span>
          <span className="of">
            {group.currency ?? 'Currency unspecified'} · {plural(group.recorded, 'report')}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MetricCards({ totals, categorized }: { totals: NcrTotals; categorized: number }) {
  const n = totals.recordCount;
  const several = totals.cost.groups.length > 1;
  return (
    <section className="metrics" aria-label="Totals for all stored reports">
      <Metric
        label="NCR reports"
        value={<div className="metric-value">{formatWhole(n)}</div>}
        coverage={`Category recorded in ${formatWhole(categorized)} of ${formatWhole(n)} reports.`}
        help="The number of non-conformance reports stored. Each report counts once, however many units it covers."
      />
      <Metric
        label="Affected units"
        value={
          <div className="metric-value">
            {totals.quantityAffected.recorded === 0 ? <Unknown /> : formatWhole(totals.quantityAffected.sum)}
          </div>
        }
        coverage={`Quantity recorded in ${formatWhole(totals.quantityAffected.recorded)} of ${formatWhole(n)} reports.`}
        help="Units the reports say were affected, added up. A report with no quantity is left out of the sum; it is not counted as zero."
      />
      <Metric
        label="Recorded cost"
        value={<CostValue totals={totals} />}
        coverage={
          `Cost recorded in ${formatWhole(totals.cost.recorded)} of ${formatWhole(n)} reports.` +
          (several ? ' Currencies are not combined.' : '')
        }
        help="Cost as written on the reports, added up per currency. It is not an estimate of the total cost of poor quality. A report with no cost is left out of the sum, and amounts in different or unstated currencies are never added together."
      />
    </section>
  );
}

export function CategoryChart(props: {
  categories: CategoryCount[];
  /** Number of reports the bars add up to. */
  total: number;
  /** Number of stored reports, before search and status filtering. */
  stored: number;
  selected: string | null | undefined;
  onSelect: (category: string | null | undefined) => void;
}) {
  const { categories, total, stored, selected, onSelect } = props;
  const max = Math.max(1, ...categories.map((c) => c.count));
  return (
    <section className="card chart" aria-labelledby="chart-title">
      <div className="chart-head">
        <h2 className="section-title" id="chart-title">
          NCR reports by category
        </h2>
        <p className="chart-sub">
          {total === stored
            ? `${plural(total, 'report')}. Select a category to filter the records below.`
            : `${formatWhole(total)} of ${formatWhole(stored)} reports match the current search and status filter.`}
        </p>
      </div>
      {categories.length === 0 ? (
        <p className="chart-sub">No reports match the current search and status filter.</p>
      ) : (
        <ul className={`bars${selected !== undefined ? ' has-selection' : ''}`}>
          {categories.map(({ category, count }) => {
            const pressed = selected !== undefined && selected === category;
            const name = category ?? 'Uncategorized';
            return (
              <li key={category ?? '\u0000uncategorized'}>
                <button
                  type="button"
                  className={`bar${category === null ? ' is-uncategorized' : ''}`}
                  aria-pressed={pressed}
                  title={`${name}: ${plural(count, 'report')} of ${formatWhole(total)}`}
                  onClick={() => onSelect(pressed ? undefined : category)}
                >
                  <span className="bar-label">{name}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${(count / max) * 100}%` }} />
                  </span>
                  <span className="bar-count">
                    {formatWhole(count)}
                    <span className="visually-hidden"> {count === 1 ? 'report' : 'reports'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
