import type { NcrRecord } from '../core/ncr.ts';
import { fieldOptions, isFiltering, NO_FILTER } from '../modules/quality/filter.ts';
import type { RecordFilter } from '../modules/quality/filter.ts';
import { Cost, DemoTag, Icon, Quantity, StatusBadge, Text } from './bits.tsx';
import { formatWhole } from './format.ts';

// <select> values are strings, so "any" and "no value" need stand-ins.
const ANY = '\u0000any';
const NONE = '\u0000none';
const toSelect = (value: string | null | undefined) => (value === undefined ? ANY : (value ?? NONE));
const fromSelect = (value: string) => (value === ANY ? undefined : value === NONE ? null : value);

export function RecordsPanel(props: {
  /** Every stored record, used to build the filter choices. */
  records: NcrRecord[];
  /** The records matching the current filter. */
  visible: NcrRecord[];
  filter: RecordFilter;
  onFilter: (filter: RecordFilter) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Shown above the toolbar. Omitted when the page heading already says "Records". */
  heading?: string;
}) {
  const { records, visible, filter, onFilter, selectedId, onSelect, heading } = props;
  const statuses = fieldOptions(records, 'status');
  const categories = fieldOptions(records, 'defectCategory');
  const filtering = isFiltering(filter);

  return (
    <section className="records" aria-label="Records">
      {heading !== undefined && <h2 className="section-title">{heading}</h2>}
      <div className="toolbar">
        <label className="search">
          <span className="visually-hidden">Search reports</span>
          <Icon name="search" />
          <input
            className="field"
            type="search"
            placeholder="Search ID, part, supplier, text…"
            value={filter.search}
            onChange={(e) => onFilter({ ...filter, search: e.target.value })}
          />
        </label>
        <label>
          <span className="visually-hidden">Status</span>
          <select
            className="field"
            value={toSelect(filter.status)}
            onChange={(e) => onFilter({ ...filter, status: fromSelect(e.target.value) })}
          >
            <option value={ANY}>All statuses</option>
            {statuses.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
            {statuses.hasMissing && <option value={NONE}>No status recorded</option>}
          </select>
        </label>
        <label>
          <span className="visually-hidden">Defect category</span>
          <select
            className="field"
            value={toSelect(filter.category)}
            onChange={(e) => onFilter({ ...filter, category: fromSelect(e.target.value) })}
          >
            <option value={ANY}>All categories</option>
            {categories.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
            {categories.hasMissing && <option value={NONE}>Uncategorized</option>}
          </select>
        </label>
        {filtering && (
          <button type="button" className="btn btn-quiet" onClick={() => onFilter(NO_FILTER)}>
            Clear filters
          </button>
        )}
        <p className="toolbar-count" role="status">
          {filtering
            ? `${formatWhole(visible.length)} of ${formatWhole(records.length)} reports`
            : `${formatWhole(records.length)} ${records.length === 1 ? 'report' : 'reports'}`}
        </p>
      </div>

      <div className="table-wrap">
        {visible.length === 0 ? (
          <div className="no-rows">
            <p>No reports match these filters.</p>
            <button type="button" className="btn" onClick={() => onFilter(NO_FILTER)}>
              Clear filters
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-id">NCR ID</th>
                <th className="col-date">Opened</th>
                <th className="col-part">Part</th>
                <th className="col-supplier">Supplier</th>
                <th className="col-category">Category</th>
                <th className="col-status">Status</th>
                <th className="col-qty num">Affected qty</th>
                <th className="col-cost num">Recorded cost</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className={r.id === selectedId ? 'is-selected' : undefined} onClick={() => onSelect(r.id)}>
                  <th scope="row" className="col-id">
                    <button
                      type="button"
                      className="row-open"
                      aria-haspopup="dialog"
                      aria-label={`Open details for ${r.ncrNumber}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(r.id);
                      }}
                    >
                      {r.ncrNumber}
                    </button>
                    {r.origin === 'sample' && <DemoTag />}
                  </th>
                  <td className="col-date">
                    <Text value={r.openedOn} />
                  </td>
                  <td className="col-part mono" title={r.partNumber ?? undefined}>
                    <Text value={r.partNumber} />
                  </td>
                  <td className="col-supplier" title={r.supplier ?? undefined}>
                    <Text value={r.supplier} />
                  </td>
                  <td className="col-category" title={r.defectCategory ?? undefined}>
                    <Text value={r.defectCategory} />
                  </td>
                  <td className="col-status">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="col-qty num">
                    <Quantity value={r.quantityAffected} unit={r.quantityUnit} />
                  </td>
                  <td className="col-cost num">
                    <Cost cents={r.costCents} currency={r.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
