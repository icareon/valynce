// Small pieces shared by the views.
import type { ReactNode } from 'react';
import { formatCost } from './format.ts';

const ICONS: Record<string, ReactNode> = {
  overview: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  records: <path d="M2 4h12M2 8h12M2 12h12" />,
  import: <path d="M8 10V2M5 5l3-3 3 3M2 10v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.4 6.3a1.7 1.7 0 1 1 2.5 1.5c-.6.3-.9.7-.9 1.3M8 11.3v.1" />
    </>
  ),
};

export type IconName = 'overview' | 'records' | 'import' | 'search' | 'close' | 'help';

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** A value that was not recorded. Deliberately different from how a zero is shown. */
export function Unknown() {
  return (
    <span className="unknown" title="Not recorded">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">Not recorded</span>
    </span>
  );
}

export function Text({ value }: { value: string | null }) {
  return value === null ? <Unknown /> : <>{value}</>;
}

export function DemoTag() {
  return (
    <span className="tag" title="Synthetic demo record. It describes no real part, supplier or cost.">
      Demo
    </span>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (status === null) return <Unknown />;
  const key = status.trim().toLowerCase();
  const tone = key === 'open' ? 'open' : key === 'closed' ? 'closed' : 'neutral';
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

/** A recorded cost. An amount with no stated currency carries the generic ¤ sign, never a guessed symbol. */
export function Cost({ cents, currency }: { cents: number | null; currency: string | null }) {
  if (cents === null) return <Unknown />;
  if (currency !== null) return <>{formatCost(cents, currency)}</>;
  return (
    <span title="Currency unspecified">
      <span className="currency-unknown" aria-hidden="true">
        ¤
      </span>
      {formatCost(cents, null)}
      <span className="visually-hidden"> (currency unspecified)</span>
    </span>
  );
}
