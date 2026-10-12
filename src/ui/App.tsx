import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterRecords, NO_FILTER } from '../modules/quality/filter.ts';
import type { RecordFilter } from '../modules/quality/filter.ts';
import { computePareto } from '../modules/quality/pareto.ts';
import type { ParetoMetric } from '../modules/quality/pareto.ts';
import type { NcrListResponse } from '../server/contract.ts';
import { listNcrs, loadSample, removeSample } from './api.ts';
import { Icon } from './bits.tsx';
import type { IconName } from './bits.tsx';
import { plural } from './format.ts';
import { ImportView } from './Import.tsx';
import { MetricCards, ParetoPanel } from './Overview.tsx';
import { RecordDetail } from './RecordDetail.tsx';
import { RecordsPanel } from './Records.tsx';

type View = 'overview' | 'records' | 'import';
type Theme = 'light' | 'dark';

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'records', label: 'Records', icon: 'records' },
  { id: 'import', label: 'Import', icon: 'import' },
];

const THEME_KEY = 'valynce-theme';

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

/**
 * The theme is set on <html> by a script in index.html before the page paints.
 * Switching only changes that attribute, so nothing on the page is reset.
 */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable; the theme still applies for this visit.
    }
    setTheme(next);
  };
  return [theme, toggle];
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
  const [theme, toggleTheme] = useTheme();
  const [data, setData] = useState<NcrListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<RecordFilter>(NO_FILTER);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [metric, setMetric] = useState<ParetoMetric>('count');
  // The currency or unit chosen for each metric, when it has more than one.
  const [seriesUnits, setSeriesUnits] = useState<Partial<Record<ParetoMetric, string | null>>>({});
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
  // One population for the chart, its export and the table: the reports that
  // search and status allow. Selecting a category then narrows only the table.
  const population = useMemo(() => filterRecords(records, { ...filter, category: undefined }), [records, filter]);
  const pareto = useMemo(() => computePareto(population, metric), [population, metric]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const r of population) counts.set(r.defectCategory, (counts.get(r.defectCategory) ?? 0) + 1);
    return counts;
  }, [population]);
  // Which currency or unit to rank when there are several: the one most stored
  // reports use, so that applying a filter does not switch it unasked.
  const usualUnit = useMemo(
    () => [...computePareto(records, metric).series].sort((a, b) => b.recorded - a.recorded)[0]?.unit,
    [records, metric],
  );
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

  const otherTheme = theme === 'dark' ? 'light' : 'dark';

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
          <span aria-hidden="true">/</span>
          <span className="here">NCR Analyzer</span>
        </p>
        <span className="spacer" />
        <span className="local" title="Valynce is running on this computer. Records stay in a local database.">
          <span className="local-dot" aria-hidden="true" />
          Local
        </span>
        <button
          type="button"
          className="btn theme-toggle"
          aria-label={`Switch to ${otherTheme} theme`}
          title={`Switch to ${otherTheme} theme`}
          onClick={toggleTheme}
        >
          <Icon name={otherTheme === 'dark' ? 'moon' : 'sun'} />
          {otherTheme === 'dark' ? 'Dark' : 'Light'}
        </button>
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

          {data !== null && view !== 'import' && records.length === 0 && (
            <div className="empty">
              <h1>No reports yet</h1>
              <p>
                Valynce analyses non-conformance reports on your own computer, ranking defect categories by report count,
                affected quantity and recorded cost.
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
                </div>
                {demoNotice}
              </div>
              <MetricCards totals={data.totals} categorized={records.filter((r) => r.defectCategory !== null).length} />
              <ParetoPanel
                result={pareto}
                stored={records.length}
                categoryCounts={categoryCounts}
                onMetric={setMetric}
                seriesUnit={metric in seriesUnits ? seriesUnits[metric] : usualUnit}
                onSeries={(unit) => setSeriesUnits({ ...seriesUnits, [metric]: unit })}
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

          {/* Kept mounted while another view is shown, so a file being checked is not lost. */}
          {data !== null && (
            <div className="import-view" hidden={view !== 'import'}>
              <ImportView imports={data.imports} onChanged={refresh} />
            </div>
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
