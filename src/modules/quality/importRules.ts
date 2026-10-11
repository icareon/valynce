// Rules for turning the rows of a CSV file into NCR records.
// Nothing here guesses: an ambiguous date format must be chosen by the user, a
// value that cannot be read exactly is an error on that row, and an empty cell
// stays "not recorded".
import { columnLabels } from '../../core/csv.ts';
import type { CsvTable } from '../../core/csv.ts';
import { isCalendarDate, isCurrencyCode } from '../../core/ncr.ts';
import type { NcrFields } from '../../core/ncr.ts';

export const IMPORT_FIELDS = [
  'ncrNumber',
  'openedOn',
  'partNumber',
  'supplier',
  'defectCategory',
  'description',
  'quantityAffected',
  'cost',
  'currency',
  'status',
  'disposition',
  'reportedCause',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** For each Valynce field, the index of the file column that holds it, or null. */
export type ImportMapping = Record<ImportField, number | null>;

export type DateFormat = 'YMD' | 'DMY' | 'MDY';
export type DecimalSeparator = '.' | ',';

export interface ImportOptions {
  /** How dates are written in the file. Null means it could not be told and must be chosen. */
  dateFormat: DateFormat | null;
  decimalSeparator: DecimalSeparator;
  /** Currency for costs in rows that state none. Null leaves them unspecified. */
  defaultCurrency: string | null;
}

export const FIELD_LABELS: Record<ImportField, string> = {
  ncrNumber: 'NCR ID',
  openedOn: 'Opened date',
  partNumber: 'Part',
  supplier: 'Supplier',
  defectCategory: 'Defect category',
  description: 'Description',
  quantityAffected: 'Affected quantity',
  cost: 'Recorded cost',
  currency: 'Currency',
  status: 'Status',
  disposition: 'Disposition',
  reportedCause: 'Reported cause',
};

// Header spellings recognised when suggesting a mapping, compared with
// everything but letters and digits removed.
const SYNONYMS: Record<ImportField, readonly string[]> = {
  ncrNumber: ['ncr', 'ncrno', 'ncrnumber', 'ncrid', 'ncrnr', 'ncrref', 'reportno', 'reportnumber', 'reportid', 'id'],
  openedOn: ['opened', 'openedon', 'opendate', 'dateopened', 'date', 'created', 'createdon', 'raised', 'dateraised', 'issuedate'],
  partNumber: ['part', 'partno', 'partnumber', 'partnr', 'pn', 'item', 'itemno', 'itemnumber', 'material', 'materialno'],
  supplier: ['supplier', 'suppliername', 'vendor', 'vendorname'],
  defectCategory: ['category', 'defectcategory', 'defecttype', 'defect', 'defectcode', 'failuremode', 'type', 'nonconformancetype'],
  description: ['description', 'desc', 'issue', 'problem', 'details', 'nonconformance', 'defectdescription'],
  quantityAffected: ['qty', 'quantity', 'quantityaffected', 'affectedquantity', 'affectedqty', 'qtyaffected', 'units', 'nonconformingqty', 'qtyrejected', 'rejectedqty'],
  cost: ['cost', 'recordedcost', 'totalcost', 'amount', 'value', 'costofnonconformance'],
  currency: ['currency', 'cur', 'ccy', 'currencycode'],
  status: ['status', 'state'],
  disposition: ['disposition', 'dispo', 'decision'],
  reportedCause: ['cause', 'reportedcause', 'rootcause', 'causecode', 'reason'],
};

const normalise = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Matches file columns to Valynce fields by header name. Unrecognised fields stay unmapped. */
export function suggestMapping(headers: readonly string[]): ImportMapping {
  const names = headers.map(normalise);
  const taken = new Set<number>();
  const mapping = {} as ImportMapping;
  for (const field of IMPORT_FIELDS) {
    let found: number | null = null;
    for (const synonym of SYNONYMS[field]) {
      const index = names.findIndex((name, i) => name === synonym && !taken.has(i));
      if (index !== -1) {
        found = index;
        break;
      }
    }
    if (found !== null) taken.add(found);
    mapping[field] = found;
  }
  return mapping;
}

// A date, optionally followed by a time of day, which is ignored.
const TIME = String.raw`(?:[ T]\d{1,2}:\d{2}.*)?`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}$`);
const YEAR_LAST = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME}$`);

/**
 * Works out how dates are written, but only when the values leave no doubt.
 * 03/04/2026 alone could be March or April, so that returns null.
 */
export function detectDateFormat(values: readonly string[]): DateFormat | null {
  const present = values.map((v) => v.trim()).filter((v) => v !== '');
  if (present.length === 0) return null;
  if (present.every((v) => YEAR_FIRST.test(v))) return 'YMD';
  let firstOver12 = false;
  let secondOver12 = false;
  for (const value of present) {
    const match = YEAR_LAST.exec(value);
    if (!match) return null;
    if (Number(match[1]) > 12) firstOver12 = true;
    if (Number(match[2]) > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return 'DMY';
  if (secondOver12 && !firstOver12) return 'MDY';
  return null;
}

export function detectDecimalSeparator(values: readonly string[]): DecimalSeparator {
  const present = values.map((v) => v.trim()).filter((v) => v !== '');
  const commaDecimals = present.some((v) => /,\d{1,2}$/.test(v));
  const dotDecimals = present.some((v) => /\.\d{1,2}$/.test(v));
  return commaDecimals && !dotDecimals ? ',' : '.';
}

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

function parseDate(raw: string, format: DateFormat): Parsed<string> {
  const match = (format === 'YMD' ? YEAR_FIRST : YEAR_LAST).exec(raw);
  const expected = { YMD: 'YYYY-MM-DD', DMY: 'DD/MM/YYYY', MDY: 'MM/DD/YYYY' }[format];
  if (!match) return { ok: false, problem: `Opened date "${raw}" is not written as ${expected}.` };
  const [year, month, day] =
    format === 'YMD'
      ? [match[1]!, match[2]!, match[3]!]
      : format === 'DMY'
        ? [match[3]!, match[2]!, match[1]!]
        : [match[3]!, match[1]!, match[2]!];
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isCalendarDate(iso)) return { ok: false, problem: `Opened date "${raw}" is not a real calendar date.` };
  return { ok: true, value: iso };
}

function parseQuantity(raw: string): Parsed<number> {
  if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) return { ok: true, value: Number(raw) };
  return {
    ok: false,
    problem: `Affected quantity "${raw}" is not a whole number of units written with digits only.`,
  };
}

/** Reads an amount into hundredths exactly. It never rounds and never strips a currency symbol. */
function parseCost(raw: string, separator: DecimalSeparator): Parsed<number> {
  const text = raw.replace(/[  ]/g, ' ');
  const symbol = /[^\d.,\s-]/.exec(text)?.[0];
  if (symbol !== undefined) {
    return {
      ok: false,
      problem: `Recorded cost "${raw}" contains "${symbol}". Give the amount alone and state the currency in a currency column or the import settings.`,
    };
  }
  const [thousands, decimal] = separator === '.' ? ['[, ]', String.raw`\.`] : ['[. ]', ','];
  const grouped = new RegExp(String.raw`^(\d{1,3}(?:${thousands}\d{3})+|\d+)(?:${decimal}(\d+))?$`);
  const match = grouped.exec(text);
  if (!match) {
    return {
      ok: false,
      problem: `Recorded cost "${raw}" is not a plain amount that is zero or more, with "${separator}" as the decimal separator.`,
    };
  }
  const fraction = match[2] ?? '';
  if (fraction.length > 2) {
    return { ok: false, problem: `Recorded cost "${raw}" has more than two decimal places. Valynce does not round.` };
  }
  const cents = Number(match[1]!.replace(/\D/g, '')) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return { ok: false, problem: `Recorded cost "${raw}" is too large.` };
  return { ok: true, value: cents };
}

export type RowStatus = 'ready' | 'error' | 'duplicate-in-file' | 'duplicate-stored' | 'blank';

export interface PlannedRow {
  /** Row number as a spreadsheet shows it: the header is row 1, the first record is row 2. */
  row: number;
  status: RowStatus;
  ncrNumber: string | null;
  /** Why the row will not be imported. Empty for a ready row. */
  problems: string[];
  /** The record this row becomes. Null when the row has errors or is blank. */
  fields: NcrFields | null;
  /** The row's cells exactly as they appear in the file, by column name. */
  source: Record<string, string>;
}

export interface ImportSummary {
  total: number;
  ready: number;
  errors: number;
  duplicatesInFile: number;
  duplicatesStored: number;
  blank: number;
}

export interface ImportPlan {
  /** Problems with the mapping or settings that must be fixed before anything can be imported. */
  blocking: string[];
  rows: PlannedRow[];
  summary: ImportSummary;
  /** Ready rows that have a cost but no currency. They will be stored as "currency unspecified". */
  costWithoutCurrency: number;
}

const COMPARED: readonly (keyof NcrFields)[] = [
  'openedOn',
  'partNumber',
  'supplier',
  'defectCategory',
  'description',
  'quantityAffected',
  'costCents',
  'currency',
  'status',
  'disposition',
  'reportedCause',
];

const COMPARED_LABELS: Record<string, string> = {
  openedOn: 'opened date',
  partNumber: 'part',
  supplier: 'supplier',
  defectCategory: 'defect category',
  description: 'description',
  quantityAffected: 'affected quantity',
  costCents: 'recorded cost',
  currency: 'currency',
  status: 'status',
  disposition: 'disposition',
  reportedCause: 'reported cause',
};

function differences(a: NcrFields, b: NcrFields): string[] {
  return COMPARED.filter((field) => a[field] !== b[field]).map((field) => COMPARED_LABELS[field]!);
}

/**
 * Decides what happens to every row of the file. `stored` holds the records
 * already in Valynce, by NCR ID. Stored records are never overwritten: a row
 * with an ID that already exists, or that appeared earlier in the file, is
 * reported as a duplicate and skipped.
 */
export function planImport(
  table: CsvTable,
  mapping: ImportMapping,
  options: ImportOptions,
  stored: ReadonlyMap<string, NcrFields>,
): ImportPlan {
  const labels = columnLabels(table.headers);
  const cellOf = (cells: readonly string[], field: ImportField): string => {
    const index = mapping[field];
    return index === null ? '' : (cells[index] ?? '').trim();
  };

  const blocking: string[] = [];
  if (mapping.ncrNumber === null) blocking.push('Choose the column that holds the NCR ID.');
  const hasDates = mapping.openedOn !== null && table.rows.some((cells) => cellOf(cells, 'openedOn') !== '');
  if (hasDates && options.dateFormat === null) {
    blocking.push('The dates in this file could be read more than one way. Choose how they are written.');
  }

  const rows: PlannedRow[] = [];
  const seen = new Map<string, PlannedRow>();
  const summary: ImportSummary = { total: table.rows.length, ready: 0, errors: 0, duplicatesInFile: 0, duplicatesStored: 0, blank: 0 };
  let costWithoutCurrency = 0;

  table.rows.forEach((cells, index) => {
    const source: Record<string, string> = {};
    labels.forEach((label, i) => (source[label] = cells[i] ?? ''));
    const planned: PlannedRow = { row: index + 2, status: 'ready', ncrNumber: null, problems: [], fields: null, source };
    rows.push(planned);

    if (cells.every((value) => value.trim() === '')) {
      planned.status = 'blank';
      summary.blank += 1;
      return;
    }

    const problems = planned.problems;
    if (cells.length > table.headers.length && cells.slice(table.headers.length).some((v) => v.trim() !== '')) {
      problems.push(`The row has ${cells.length} values but the header names ${table.headers.length} columns.`);
    }

    const ncrNumber = cellOf(cells, 'ncrNumber');
    if (ncrNumber === '') problems.push('NCR ID is empty.');
    else planned.ncrNumber = ncrNumber;

    const text = (field: ImportField): string | null => cellOf(cells, field) || null;

    let openedOn: string | null = null;
    const rawDate = cellOf(cells, 'openedOn');
    if (rawDate !== '' && options.dateFormat !== null) {
      const parsed = parseDate(rawDate, options.dateFormat);
      if (parsed.ok) openedOn = parsed.value;
      else problems.push(parsed.problem);
    }

    let quantityAffected: number | null = null;
    const rawQuantity = cellOf(cells, 'quantityAffected');
    if (rawQuantity !== '') {
      const parsed = parseQuantity(rawQuantity);
      if (parsed.ok) quantityAffected = parsed.value;
      else problems.push(parsed.problem);
    }

    let costCents: number | null = null;
    const rawCost = cellOf(cells, 'cost');
    if (rawCost !== '') {
      const parsed = parseCost(rawCost, options.decimalSeparator);
      if (parsed.ok) costCents = parsed.value;
      else problems.push(parsed.problem);
    }

    let currency: string | null = null;
    const rawCurrency = cellOf(cells, 'currency').toUpperCase();
    if (rawCurrency !== '' && !isCurrencyCode(rawCurrency)) {
      problems.push(`Currency "${cellOf(cells, 'currency')}" is not an ISO 4217 code such as USD or EUR.`);
    } else if (costCents !== null) {
      // A currency only means something beside a cost.
      currency = rawCurrency !== '' ? rawCurrency : options.defaultCurrency;
    }

    if (problems.length > 0) {
      planned.status = 'error';
      summary.errors += 1;
      return;
    }

    const fields: NcrFields = {
      ncrNumber,
      openedOn,
      partNumber: text('partNumber'),
      supplier: text('supplier'),
      defectCategory: text('defectCategory'),
      description: text('description'),
      quantityAffected,
      costCents,
      currency,
      status: text('status'),
      disposition: text('disposition'),
      reportedCause: text('reportedCause'),
    };
    planned.fields = fields;

    const existing = stored.get(ncrNumber);
    const earlier = seen.get(ncrNumber);
    if (existing !== undefined) {
      const changed = differences(existing, fields);
      planned.status = 'duplicate-stored';
      planned.problems.push(
        changed.length === 0
          ? 'Already stored with the same values. Skipped.'
          : `Already stored with different values (${changed.join(', ')}). The stored record is kept.`,
      );
      summary.duplicatesStored += 1;
    } else if (earlier !== undefined) {
      const changed = differences(earlier.fields!, fields);
      planned.status = 'duplicate-in-file';
      planned.problems.push(
        changed.length === 0
          ? `Repeats row ${earlier.row} exactly. Skipped.`
          : `Same NCR ID as row ${earlier.row} but different values (${changed.join(', ')}). Row ${earlier.row} is kept.`,
      );
      summary.duplicatesInFile += 1;
    } else {
      seen.set(ncrNumber, planned);
      summary.ready += 1;
      if (costCents !== null && currency === null) costWithoutCurrency += 1;
    }
  });

  return { blocking, rows, summary, costWithoutCurrency };
}
