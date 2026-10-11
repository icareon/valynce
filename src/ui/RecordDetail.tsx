import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ImportBatch, NcrRecord } from '../core/ncr.ts';
import { DemoTag, Icon, StatusBadge } from './bits.tsx';
import { formatCost, formatWhole } from './format.ts';

const notRecorded = <span className="unknown-text">Not recorded</span>;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? notRecorded}</dd>
    </>
  );
}

function costText(record: NcrRecord): ReactNode {
  if (record.costCents === null) return null;
  if (record.currency === null) {
    return (
      <>
        {formatCost(record.costCents, null)} <span className="tag">Currency unspecified</span>
      </>
    );
  }
  return `${formatCost(record.costCents, record.currency)} (${record.currency})`;
}

function Source({ record, batch }: { record: NcrRecord; batch: ImportBatch | undefined }) {
  if (record.origin === 'sample') {
    return (
      <p className="detail-text">
        Synthetic demo data that ships with Valynce. It describes no real part, supplier or cost.
      </p>
    );
  }
  if (batch === undefined || record.sourceRow === null) {
    return <p className="detail-text">The file this record came from was not recorded.</p>;
  }
  return (
    <>
      <dl className="facts">
        <Fact label="Imported from">{batch.fileName}</Fact>
        <Fact label="Row in file">{formatWhole(record.sourceRow)}</Fact>
        <Fact label="Imported">{new Date(batch.importedAt).toLocaleString()}</Fact>
      </dl>
      {record.sourceValues !== null && (
        <details className="source-row">
          <summary>Original row, as written in the file</summary>
          <dl className="facts">
            {Object.entries(record.sourceValues).map(([column, value]) => (
              <Fact key={column} label={column}>
                {value === '' ? <span className="unknown-text">Empty</span> : value}
              </Fact>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}

export function RecordDetail(props: { record: NcrRecord; batch: ImportBatch | undefined; onClose: () => void }) {
  const { record, batch, onClose } = props;
  const panel = useRef<HTMLElement>(null);

  // Move focus into the panel when it opens or switches record, so keyboard and
  // screen-reader users land on the new content.
  useEffect(() => {
    panel.current?.focus();
  }, [record.id]);

  return (
    <aside
      className="detail"
      role="dialog"
      aria-modal="false"
      aria-labelledby="detail-title"
      tabIndex={-1}
      ref={panel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="detail-head">
        <div>
          <p className="detail-eyebrow">NCR report</p>
          <h2 className="detail-title" id="detail-title">
            {record.ncrNumber}
          </h2>
        </div>
        {record.origin === 'sample' && <DemoTag />}
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      <div className="detail-body">
        <section className="detail-section">
          <dl className="facts">
            <Fact label="Opened">{record.openedOn}</Fact>
            <Fact label="Status">{record.status === null ? null : <StatusBadge status={record.status} />}</Fact>
            <Fact label="Part">{record.partNumber === null ? null : <span className="mono">{record.partNumber}</span>}</Fact>
            <Fact label="Supplier">{record.supplier}</Fact>
            <Fact label="Defect category">{record.defectCategory}</Fact>
            <Fact label="Disposition">{record.disposition}</Fact>
            <Fact label="Affected quantity">
              {record.quantityAffected === null ? null : formatWhole(record.quantityAffected)}
            </Fact>
            <Fact label="Recorded cost">{costText(record)}</Fact>
          </dl>
        </section>

        <section className="detail-section">
          <h3>Description</h3>
          <p className="detail-text">{record.description ?? notRecorded}</p>
        </section>

        <section className="detail-section">
          <h3>Reported cause</h3>
          <p className="detail-text">{record.reportedCause ?? notRecorded}</p>
          <p className="detail-note">
            This is the cause as written on the report. Valynce holds no verified root cause for this record.
          </p>
        </section>

        <section className="detail-section">
          <h3>Source</h3>
          <Source record={record} batch={batch} />
        </section>
      </div>
    </aside>
  );
}
