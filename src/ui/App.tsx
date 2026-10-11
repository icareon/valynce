import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { NcrRecord } from '../core/ncr.ts';
import type { MetricTotal } from '../modules/quality/totals.ts';
import type { NcrListResponse } from '../server/contract.ts';
import { listNcrs, loadSample, removeSample } from './api.ts';

const wholeNumber = new Intl.NumberFormat();
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatCost = (cents: number) => money.format(cents / 100);

function Missing() {
  return (
    <span className="missing" title="Not recorded">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">Not recorded</span>
    </span>
  );
}

function Cell({ value }: { value: string | null }) {
  return value === null ? <Missing /> : <>{value}</>;
}

function missingNote(total: MetricTotal, what: string): string {
  if (total.recorded + total.missing === 0) return 'No records yet.';
  if (total.missing === 0) return `All ${total.recorded} records state a ${what}.`;
  const records = total.missing === 1 ? 'record has' : 'records have';
  return `${total.missing} ${records} no ${what} and ${total.missing === 1 ? 'is' : 'are'} not in this sum.`;
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>
    </div>
  );
}

function RecordTable({ records }: { records: NcrRecord[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>NCR</th>
            <th>Opened</th>
            <th>Part</th>
            <th>Supplier</th>
            <th>Defect category</th>
            <th>Description</th>
            <th className="num">Affected quantity</th>
            <th className="num">Recorded cost</th>
            <th>Status</th>
            <th>Disposition</th>
            <th>Reported cause</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {r.ncrNumber}
                {r.origin === 'sample' && <span className="tag">sample</span>}
              </th>
              <td className="nowrap"><Cell value={r.openedOn} /></td>
              <td className="nowrap"><Cell value={r.partNumber} /></td>
              <td className="nowrap"><Cell value={r.supplier} /></td>
              <td><Cell value={r.defectCategory} /></td>
              <td className="wide"><Cell value={r.description} /></td>
              <td className="num">{r.quantityAffected === null ? <Missing /> : wholeNumber.format(r.quantityAffected)}</td>
              <td className="num">{r.costCents === null ? <Missing /> : formatCost(r.costCents)}</td>
              <td><Cell value={r.status} /></td>
              <td><Cell value={r.disposition} /></td>
              <td><Cell value={r.reportedCause} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function App() {
  const [data, setData] = useState<NcrListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      return;
    }
    await refresh();
    setBusy(false);
  };

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">NCR analyzer · Runs locally</p>
        <h1>Valynce</h1>
        <p>Records are stored on this computer and are not sent anywhere.</p>
      </header>
      <div className="divider" />

      {error !== null && (
        <p className="banner banner-error" role="alert">
          Could not reach the local Valynce backend: {error}
        </p>
      )}

      {data !== null && data.sampleCount > 0 && (
        <div className="banner">
          <p>
            <strong>
              {data.sampleCount} of {data.totals.recordCount} records are synthetic samples.
            </strong>{' '}
            They were invented for demonstration and describe no real part, supplier or cost.
          </p>
          <button type="button" disabled={busy} onClick={() => void run(removeSample)}>
            Remove sample records
          </button>
        </div>
      )}

      {data !== null && (
        <>
          <section className="tiles" aria-label="Totals">
            <Tile
              label="NCR count"
              value={wholeNumber.format(data.totals.recordCount)}
              note="Number of reports. Each counts once, whatever its quantity or cost."
            />
            <Tile
              label="Affected quantity"
              value={
                data.totals.quantityAffected.recorded === 0 ? <Missing /> : wholeNumber.format(data.totals.quantityAffected.sum)
              }
              note={`Units, summed. ${missingNote(data.totals.quantityAffected, 'quantity')}`}
            />
            <Tile
              label="Recorded cost"
              value={data.totals.costCents.recorded === 0 ? <Missing /> : formatCost(data.totals.costCents.sum)}
              note={`As written on the reports, summed. ${missingNote(data.totals.costCents, 'cost')}`}
            />
          </section>

          {data.records.length === 0 ? (
            <div className="empty">
              <p>No records yet.</p>
              <button type="button" disabled={busy} onClick={() => void run(loadSample)}>
                Load synthetic sample records
              </button>
            </div>
          ) : (
            <RecordTable records={data.records} />
          )}
        </>
      )}
    </div>
  );
}
