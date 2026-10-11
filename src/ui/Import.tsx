import { useRef, useState } from 'react';
import type { ImportBatch } from '../core/ncr.ts';
import { FIELD_LABELS, IMPORT_FIELDS } from '../modules/quality/importRules.ts';
import type {
  DateFormat,
  DecimalSeparator,
  ImportField,
  ImportMapping,
  ImportOptions,
  PlannedRow,
} from '../modules/quality/importRules.ts';
import type { ImportCommitResponse, ImportPreviewResponse } from '../server/contract.ts';
import { commitImport, previewImport, removeImport } from './api.ts';
import { Cost, Text, Unknown } from './bits.tsx';
import { formatWhole, plural } from './format.ts';

interface ChosenFile {
  name: string;
  text: string;
}

const FIELD_HINTS: Partial<Record<ImportField, string>> = {
  ncrNumber: 'Required. Must be unique.',
  cost: 'The amount alone, without a currency symbol.',
  currency: 'An ISO code such as USD or EUR.',
  reportedCause: 'Kept as the reported cause, not as a verified root cause.',
};

const RESULT_LABELS: Record<PlannedRow['status'], string> = {
  ready: 'Ready',
  error: 'Error',
  'duplicate-in-file': 'Repeated in file',
  'duplicate-stored': 'Already stored',
  blank: 'Blank',
};

const DELIMITER_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function SkippedRows({ rows, truncated }: { rows: PlannedRow[]; truncated: boolean }) {
  if (rows.length === 0) return null;
  return (
    <>
      <div className="table-wrap">
        <table className="table-plain">
          <thead>
            <tr>
              <th className="col-row num">Row</th>
              <th className="col-id">NCR ID</th>
              <th className="col-result">Result</th>
              <th>Why it is not imported</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row}>
                <td className="num">{row.row}</td>
                <td className="mono">{row.ncrNumber ?? <Unknown />}</td>
                <td>
                  <span className={`badge badge-${row.status === 'error' ? 'error' : 'neutral'}`}>
                    <span className="badge-dot" aria-hidden="true" />
                    {RESULT_LABELS[row.status]}
                  </span>
                </td>
                <td className="wrap">{row.problems.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <p className="hint">Only the first {formatWhole(rows.length)} skipped rows are listed.</p>}
    </>
  );
}

function PreviousImports(props: { imports: ImportBatch[]; onRemoved: () => Promise<void> }) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (props.imports.length === 0) return null;

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await removeImport(id);
      setError(null);
      await props.onRemoved();
    } catch (cause) {
      setError(errorText(cause));
    }
    setConfirming(null);
    setBusy(false);
  };

  return (
    <section className="import-section" aria-labelledby="previous-imports">
      <h2 className="section-title" id="previous-imports">
        Imported files
      </h2>
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table className="table-plain">
          <thead>
            <tr>
              <th>File</th>
              <th className="col-when">Imported</th>
              <th className="col-count num">Reports</th>
              <th className="col-count num">Skipped rows</th>
              <th className="col-action" />
            </tr>
          </thead>
          <tbody>
            {props.imports.map((batch) => (
              <tr key={batch.id}>
                <td title={batch.fileName}>{batch.fileName}</td>
                <td>{new Date(batch.importedAt).toLocaleString()}</td>
                <td className="num">{formatWhole(batch.rowsImported)}</td>
                <td className="num">{formatWhole(batch.rowsDuplicate + batch.rowsRejected)}</td>
                <td className="actions">
                  {confirming === batch.id ? (
                    <>
                      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove(batch.id)}>
                        Remove {plural(batch.rowsImported, 'report')}
                      </button>
                      <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Remove the import of ${batch.fileName}`}
                      onClick={() => setConfirming(batch.id)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ImportView(props: { imports: ImportBatch[]; onChanged: () => Promise<void> }) {
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [currencyDraft, setCurrencyDraft] = useState('');
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const picker = useRef<HTMLInputElement>(null);

  // Asks the server what importing would do. A slower, older answer never replaces a newer one.
  const runPreview = async (chosen: ChosenFile, mapping?: ImportMapping, options?: ImportOptions) => {
    const ticket = (latest.current += 1);
    try {
      let next = await previewImport({ fileName: chosen.name, text: chosen.text, mapping, options });
      // After a column change the file may now make the date format clear; adopt it rather than keep asking.
      if (options !== undefined && options.dateFormat === null && next.detected.dateFormat !== null) {
        next = await previewImport({
          fileName: chosen.name,
          text: chosen.text,
          mapping,
          options: { ...options, dateFormat: next.detected.dateFormat },
        });
      }
      if (ticket !== latest.current) return;
      setPreview(next);
      setError(null);
    } catch (cause) {
      if (ticket !== latest.current) return;
      setError(errorText(cause));
      if (mapping === undefined) setPreview(null);
    }
  };

  const choose = async (picked: File | undefined) => {
    if (picked === undefined) return;
    const chosen = { name: picked.name, text: await picked.text() };
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setCurrencyDraft('');
    await runPreview(chosen);
  };

  const reset = () => {
    latest.current += 1;
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setCurrencyDraft('');
    if (picker.current) picker.current.value = '';
  };

  const setMapping = (field: ImportField, column: number | null) => {
    if (file === null || preview === null) return;
    void runPreview(file, { ...preview.mapping, [field]: column }, preview.options);
  };
  const setOptions = (change: Partial<ImportOptions>) => {
    if (file === null || preview === null) return;
    void runPreview(file, preview.mapping, { ...preview.options, ...change });
  };
  const setCurrency = (value: string) => {
    const code = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    setCurrencyDraft(code);
    if (code === '') setOptions({ defaultCurrency: null });
    else if (code.length === 3) setOptions({ defaultCurrency: code });
  };

  const commit = async () => {
    if (file === null || preview === null) return;
    setBusy(true);
    try {
      const done = await commitImport({ fileName: file.name, text: file.text, mapping: preview.mapping, options: preview.options });
      setResult(done);
      setError(null);
      await props.onChanged();
    } catch (cause) {
      setError(errorText(cause));
    }
    setBusy(false);
  };

  const head = (
    <div className="page-head">
      <div>
        <h1>Import CSV</h1>
        <p>Add reports from a CSV file. The file is read by Valynce on this computer and is not sent anywhere.</p>
      </div>
    </div>
  );

  if (result !== null) {
    const { batch, summary } = result;
    const skipped = summary.errors + summary.duplicatesInFile + summary.duplicatesStored;
    return (
      <>
        {head}
        <section className="card pad import-done" aria-live="polite">
          <h2 className="section-title">
            Imported {plural(batch.rowsImported, 'report')} from {batch.fileName}
          </h2>
          <p className="hint">
            {skipped === 0
              ? 'Every row with content was imported.'
              : `${plural(skipped, 'row')} ${skipped === 1 ? 'was' : 'were'} not imported. ${skipped === 1 ? 'It is' : 'They are'} listed below.`}{' '}
            Each report keeps the file name and row it came from.
          </p>
          <div className="button-row">
            <a className="btn btn-primary" href="#/records">
              View records
            </a>
            <button type="button" className="btn" onClick={reset}>
              Import another file
            </button>
          </div>
        </section>
        <div className="import-section">
          <SkippedRows rows={result.skippedRows} truncated={result.skippedRowsTruncated} />
        </div>
        <PreviousImports imports={props.imports} onRemoved={props.onChanged} />
      </>
    );
  }

  const summary = preview?.summary;
  const notImported = summary ? summary.errors + summary.duplicatesInFile + summary.duplicatesStored : 0;
  const canImport = preview !== null && preview.blocking.length === 0 && preview.summary.ready > 0;
  const hasDates = preview !== null && preview.mapping.openedOn !== null;

  return (
    <>
      {head}
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <section className="card pad import-section" aria-labelledby="step-file">
        <h2 className="section-title" id="step-file">
          1. Choose a file
        </h2>
        <div className="file-row">
          <label className="btn btn-primary file-pick">
            <input
              ref={picker}
              className="visually-hidden"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            {file === null ? 'Choose CSV file' : 'Choose another file'}
          </label>
          {file === null ? (
            <p className="hint">The first row must name the columns. Save the file as UTF-8 text.</p>
          ) : (
            <p className="file-name">
              <strong>{file.name}</strong>
              {preview !== null && (
                <span className="hint">
                  {' '}
                  {plural(preview.summary.total, 'row')} after the header, {DELIMITER_NAMES[preview.delimiter]}-separated
                </span>
              )}
            </p>
          )}
        </div>
      </section>

      {preview !== null && (
        <>
          <section className="card pad import-section" aria-labelledby="step-map">
            <h2 className="section-title" id="step-map">
              2. Match columns
            </h2>
            <p className="hint">Valynce matched the columns it recognised. Check each one and correct any that are wrong.</p>
            <div className="map-grid" role="group" aria-label="Column for each Valynce field">
              {IMPORT_FIELDS.map((field) => {
                const column = preview.mapping[field];
                const id = `map-${field}`;
                return (
                  <div className="map-row" key={field}>
                    <label htmlFor={id}>
                      {FIELD_LABELS[field]}
                      {FIELD_HINTS[field] !== undefined && <span className="hint">{FIELD_HINTS[field]}</span>}
                    </label>
                    <select
                      id={id}
                      className="field"
                      value={column ?? ''}
                      onChange={(e) => setMapping(field, e.target.value === '' ? null : Number(e.target.value))}
                    >
                      <option value="">Not in this file</option>
                      {preview.columns.map((name, index) => (
                        <option key={index} value={index}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <span className="map-example" title={column === null ? undefined : (preview.examples[column] ?? undefined)}>
                      {column === null ? '' : (preview.examples[column] ?? 'no values')}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="settings">
              <label>
                <span>Dates are written</span>
                <select
                  className="field"
                  value={preview.options.dateFormat ?? ''}
                  disabled={!hasDates}
                  onChange={(e) => setOptions({ dateFormat: e.target.value as DateFormat })}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="YMD">Year first, as 2026-03-04</option>
                  <option value="DMY">Day first, as 04/03/2026</option>
                  <option value="MDY">Month first, as 03/04/2026</option>
                </select>
              </label>
              <label>
                <span>Decimal separator</span>
                <select
                  className="field"
                  value={preview.options.decimalSeparator}
                  onChange={(e) => setOptions({ decimalSeparator: e.target.value as DecimalSeparator })}
                >
                  <option value=".">Point, as 1,234.56</option>
                  <option value=",">Comma, as 1.234,56</option>
                </select>
              </label>
              <label>
                <span>Currency for costs that state none</span>
                <input
                  className="field currency-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="Unspecified"
                  maxLength={3}
                  value={currencyDraft}
                  onChange={(e) => setCurrency(e.target.value)}
                />
              </label>
            </div>
            <p className="hint">
              Leave the currency empty unless you know it. A cost with no currency is stored as "currency unspecified" and
              is never added to costs in a known currency.
            </p>
          </section>

          <section className="card pad import-section" aria-labelledby="step-check">
            <h2 className="section-title" id="step-check">
              3. Check and import
            </h2>
            {preview.blocking.map((message) => (
              <p className="alert" role="alert" key={message}>
                {message}
              </p>
            ))}
            <ul className="chips" aria-label="What will happen to the rows">
              <li className="chip chip-ready">
                <strong>{formatWhole(preview.summary.ready)}</strong> will be imported
              </li>
              {preview.summary.errors > 0 && (
                <li className="chip chip-error">
                  <strong>{formatWhole(preview.summary.errors)}</strong> with errors
                </li>
              )}
              {preview.summary.duplicatesInFile > 0 && (
                <li className="chip">
                  <strong>{formatWhole(preview.summary.duplicatesInFile)}</strong> repeated in the file
                </li>
              )}
              {preview.summary.duplicatesStored > 0 && (
                <li className="chip">
                  <strong>{formatWhole(preview.summary.duplicatesStored)}</strong> already stored
                </li>
              )}
              {preview.summary.blank > 0 && (
                <li className="chip">
                  <strong>{formatWhole(preview.summary.blank)}</strong> blank
                </li>
              )}
            </ul>
            {preview.costWithoutCurrency > 0 && (
              <p className="hint">
                {plural(preview.costWithoutCurrency, 'report')} to import {preview.costWithoutCurrency === 1 ? 'has' : 'have'} a
                cost with no currency. {preview.costWithoutCurrency === 1 ? 'It' : 'They'} will be stored as currency unspecified.
              </p>
            )}

            <div className="button-row">
              <button type="button" className="btn btn-primary" disabled={!canImport || busy} onClick={() => void commit()}>
                Import {plural(preview.summary.ready, 'report')}
              </button>
              {notImported > 0 && (
                <span className="hint">
                  {plural(notImported, 'row')} will not be imported. Stored records are never overwritten.
                </span>
              )}
            </div>

            {preview.readyRows.length > 0 && (
              <details className="ready-preview">
                <summary>
                  Preview {preview.readyRows.length < preview.summary.ready ? `the first ${preview.readyRows.length} of ` : ''}
                  {plural(preview.summary.ready, 'report')} that will be imported
                </summary>
                <div className="table-wrap">
                  <table className="table-plain">
                    <thead>
                      <tr>
                        <th className="col-row num">Row</th>
                        <th className="col-id">NCR ID</th>
                        <th className="col-date">Opened</th>
                        <th>Category</th>
                        <th className="col-status">Status</th>
                        <th className="col-qty num">Affected qty</th>
                        <th className="col-cost num">Recorded cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.readyRows.map((row) => (
                        <tr key={row.row}>
                          <td className="num">{row.row}</td>
                          <td className="mono">{row.ncrNumber}</td>
                          <td>
                            <Text value={row.fields!.openedOn} />
                          </td>
                          <td>
                            <Text value={row.fields!.defectCategory} />
                          </td>
                          <td>
                            <Text value={row.fields!.status} />
                          </td>
                          <td className="num">
                            {row.fields!.quantityAffected === null ? <Unknown /> : formatWhole(row.fields!.quantityAffected)}
                          </td>
                          <td className="num">
                            <Cost cents={row.fields!.costCents} currency={row.fields!.currency} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>

          {preview.skippedRows.length > 0 && (
            <section className="import-section" aria-labelledby="skipped-title">
              <h2 className="section-title" id="skipped-title">
                Rows that will not be imported
              </h2>
              <SkippedRows rows={preview.skippedRows} truncated={preview.skippedRowsTruncated} />
            </section>
          )}
        </>
      )}

      <PreviousImports imports={props.imports} onRemoved={props.onChanged} />
    </>
  );
}
