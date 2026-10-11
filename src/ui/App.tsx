import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countByCategory } from '../modules/quality/categories.ts';
import { filterRecords, NO_FILTER } from '../modules/quality/filter.ts';
import type { RecordFilter } from '../modules/quality/filter.ts';
import type { NcrListResponse } from '../server/contract.ts';
import { listNcrs, loadSample, removeSample } from './api.ts';
import { Icon } from './bits.tsx';
import type { IconName } from './bits.tsx';
import { plural } from './format.ts';
import { ImportView } from './Import.tsx';
import { CategoryChart, MetricCards } from './Overview.tsx';
import { RecordDetail } from './RecordDetail.tsx';
import { RecordsPanel } from './Records.tsx';

type View = 'overview' | 'records' | 'import';

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'records', label: 'Records', icon: 'records' },
  { id: 'import', label: 'Import', icon: 'import' },
];

function viewFromHash(): View {
  const id = window.location.hash.replace(/^#\/?/, '');
  return VIEWS.find((v) => v.id === id)?.id ?? 'overview';
}

function useView(): View {
  const [view, setView] = useState(viewFromHash);
  useEffect(() => {
    const onChange = () => setView(viewFromHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return view;
}

function DemoNotice(props: { demo: number; total: number; busy: boolean; onRemove: () => void }) {
  return (
    <div className="demo-notice">
      <span>
        <strong>Demo data</strong>{' '}
        {props.demo === props.total
          ? `${plural(props.demo, 'synthetic report')}`
          : `${props.demo} of ${plural(props.total, 'report')} are synthetic`}
      </span>
      <button type="button" className="btn btn-sm" disabled={props.busy} onClick={props.onRemove}>
        Remove demo data
      </button>
    </div>
  );
}

export function App() {
  const view = useView();
  const [data, setData] = useState<NcrListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<RecordFilter>(NO_FILTER);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listNcrs());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setBusy(false);
  };

  const records = useMemo(() => data?.records ?? [], [data]);
  const visible = useMemo(() => filterRecords(records, filter), [records, filter]);
  // The chart counts whatever search and status allow, so its bars always add
  // up to a stated number and each bar equals the table count after clicking it.
  const chartRecords = useMemo(() => filterRecords(records, { ...filter, category: undefined }), [records, filter]);
  const categories = useMemo(() => countByCategory(chartRecords), [chartRecords]);
  const selected = records.find((r) => r.id === selectedId) ?? null;

  const openRecord = (id: number) => {
    if (selectedId === null) opener.current = document.activeElement as HTMLElement | null;
    setSelectedId(id);
  };
  const closeRecord = () => {
    setSelectedId(null);
    // Return focus to where the user was, if that element is still on the page.
    if (opener.current?.isConnected) opener.current.focus();
    opener.current = null;
  };

  const demoNotice = data !== null && data.sampleCount > 0 && (
    <DemoNotice
      demo={data.sampleCount}
      total={records.length}
      busy={busy}
      onRemove={() => {
        setSelectedId(null);
        setFilter(NO_FILTER);
        void run(removeSample);
      }}
    />
  );

  const recordsPanel = (heading?: string) => (
    <RecordsPanel
      records={records}
      visible={visible}
      filter={filter}
      onFilter={setFilter}
      selectedId={selectedId}
      onSelect={openRecord}
      heading={heading}
    />
  );

  return (
    <div className={`app${selected !== null && view !== 'import' ? ' has-detail' : ''}`}>
      <header className="appbar">
        <a className="wordmark" href="#/overview">
          <svg className="wordmark-mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2 3l7 12 7-12" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Valynce
        </a>
        <p className="crumbs">
          <span>Quality</span>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span className="here">NCR Analyzer</span>
        </p>
        <span className="spacer" />
        <span className="local" title="Valynce is running on this computer. Records stay in a local database.">
          <span className="local-dot" aria-hidden="true" />
          Local
        </span>
      </header>

      <nav className="rail" aria-label="Views">
        {VIEWS.map((v) => (
          <a key={v.id} href={`#/${v.id}`} aria-current={view === v.id ? 'page' : undefined} title={v.label}>
            <Icon name={v.icon} />
            <span>{v.label}</span>
          </a>
        ))}
      </nav>

      <main className="main">
        <div className="view">
          {error !== null && (
            <p className="alert" role="alert">
              Could not reach the local Valynce backend: {error}
            </p>
          )}

          {data !== null && view === 'import' && <ImportView imports={data.imports} onChanged={refresh} />}

          {data !== null && view !== 'import' && records.length === 0 && (
            <div className="empty">
              <h1>No reports yet</h1>
              <p>
                Valynce analyses non-conformance reports on your own computer, showing report counts, affected units
                and recorded cost by defect category.
              </p>
              <div className="button-row">
                <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => void run(loadSample)}>
                  Load demo data
                </button>
                <a className="btn btn-lg" href="#/import">
                  Import a CSV file
                </a>
              </div>
              <p className="fine">Demo data is 24 synthetic reports. You can remove it at any time.</p>
            </div>
          )}

          {data !== null && records.length > 0 && view === 'overview' && (
            <>
              <div className="page-head">
                <div>
                  <h1>Quality overview</h1>
                  <p>What the stored non-conformance reports add up to.</p>
                </div>
                {demoNotice}
              </div>
              <MetricCards totals={data.totals} categorized={records.filter((r) => r.defectCategory !== null).length} />
              <CategoryChart
                categories={categories}
                total={chartRecords.length}
                stored={records.length}
                selected={filter.category}
                onSelect={(category) => setFilter({ ...filter, category })}
              />
              {recordsPanel('Records')}
            </>
          )}

          {data !== null && records.length > 0 && view === 'records' && (
            <>
              <div className="page-head">
                <div>
                  <h1>Records</h1>
                  <p>Every stored report. Select a row to see all of its fields.</p>
                </div>
                {demoNotice}
              </div>
              {recordsPanel()}
            </>
          )}
        </div>
      </main>

      {selected !== null && view !== 'import' && (
        <RecordDetail
          record={selected}
          batch={data?.imports.find((batch) => batch.id === selected.importBatchId)}
          onClose={closeRecord}
        />
      )}
    </div>
  );
}
