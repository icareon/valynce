// The NCR entity shared by storage, quality rules, server and UI.
// A field that was not recorded is null. It is never replaced by 0, '' or a guess.

export type NcrOrigin = 'sample' | 'import';

export interface NcrFields {
  /** The report's own identifier, unique within Valynce. */
  ncrNumber: string;
  /** Calendar date as YYYY-MM-DD. */
  openedOn: string | null;
  partNumber: string | null;
  supplier: string | null;
  defectCategory: string | null;
  description: string | null;
  /** Units affected, a whole number. */
  quantityAffected: number | null;
  /** Cost as recorded on the report, in hundredths of `currency`. */
  costCents: number | null;
  /** ISO 4217 code for the cost. Null means the currency was not stated; it is never assumed. */
  currency: string | null;
  status: string | null;
  disposition: string | null;
  /** The cause as written on the report. Valynce does not treat it as verified. */
  reportedCause: string | null;
}

export interface NcrRecord extends NcrFields {
  id: number;
  origin: NcrOrigin;
  createdAt: string;
  /** The import that brought this record in. Null for demo data and for records stored before imports were tracked. */
  importBatchId: number | null;
  /** The row of the imported file this record came from. The header is row 1. */
  sourceRow: number | null;
  /** That row's cells exactly as they appeared in the file, by column name. */
  sourceValues: Record<string, string> | null;
}

/** One imported file: what it was, when it came in and what happened to its rows. */
export interface ImportBatch {
  id: number;
  fileName: string;
  /** SHA-256 of the file's text, to tell whether two imports were the same file. */
  fileSha256: string;
  importedAt: string;
  rowsTotal: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsRejected: number;
  rowsBlank: number;
}

export interface ImportRow {
  fields: NcrFields;
  sourceRow: number;
  sourceValues: Record<string, string>;
}

export interface InsertResult {
  inserted: number;
  /** NCR numbers that were already stored and were left untouched. */
  skippedDuplicates: string[];
}

export type ParseResult = { ok: true; value: NcrFields } | { ok: false; errors: string[] };

const TEXT_FIELDS = [
  'partNumber',
  'supplier',
  'defectCategory',
  'description',
  'status',
  'disposition',
  'reportedCause',
] as const;

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

let knownCurrencies: Set<string> | undefined;

/** True for an upper-case ISO 4217 code this runtime knows, such as USD or EUR. */
export function isCurrencyCode(value: string): boolean {
  knownCurrencies ??= new Set(Intl.supportedValuesOf('currency'));
  return knownCurrencies.has(value);
}

/** Checks an untrusted object and returns clean NCR fields, or every problem found. */
export function parseNcrFields(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['record is not an object'] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];

  let ncrNumber = '';
  if (typeof raw.ncrNumber === 'string' && raw.ncrNumber.trim() !== '') {
    ncrNumber = raw.ncrNumber.trim();
  } else {
    errors.push('ncrNumber is required');
  }

  const text = {} as Record<(typeof TEXT_FIELDS)[number], string | null>;
  for (const field of TEXT_FIELDS) {
    const value = raw[field];
    if (isMissing(value)) {
      text[field] = null;
    } else if (typeof value === 'string') {
      text[field] = value.trim();
    } else {
      text[field] = null;
      errors.push(`${field} must be text`);
    }
  }

  let openedOn: string | null = null;
  if (!isMissing(raw.openedOn)) {
    if (typeof raw.openedOn === 'string' && isCalendarDate(raw.openedOn.trim())) {
      openedOn = raw.openedOn.trim();
    } else {
      errors.push('openedOn must be a real date written as YYYY-MM-DD');
    }
  }

  const wholeNumber = (field: 'quantityAffected' | 'costCents'): number | null => {
    const value = raw[field];
    if (isMissing(value)) return null;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    errors.push(`${field} must be a whole number that is not negative`);
    return null;
  };
  const quantityAffected = wholeNumber('quantityAffected');
  const costCents = wholeNumber('costCents');

  let currency: string | null = null;
  if (!isMissing(raw.currency)) {
    if (typeof raw.currency === 'string' && isCurrencyCode(raw.currency.trim().toUpperCase())) {
      currency = raw.currency.trim().toUpperCase();
    } else {
      errors.push('currency must be an ISO 4217 code such as USD or EUR');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ncrNumber, openedOn, ...text, quantityAffected, costCents, currency } };
}
