// Rules for turning the rows of a CSV file into NCR records.
// Nothing here guesses: an ambiguous date format must be chosen by the user, a
// value that cannot be read exactly is an error on that row, and an empty cell
// stays "not recorded".
import { columnLabels } from '../../core/csv.ts';
import type { CsvTable } from '../../core/csv.ts';
import { isCalendarDate, isCurrencyCode, readQuantityUnit } from '../../core/ncr.ts';
import type { NcrFields } from '../../core/ncr.ts';

export const IMPORT_FIELDS = [
  'ncrNumber',
  'openedOn',
  'partNumber',
  'supplier',
  'defectCategory',
  'description',
  'quantityAffected',
  'quantityUnit',
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
/** 'point' reads 1,234.56 and 'comma' reads 1.234,56 as one thousand two hundred thirty-four and 56 hundredths. */
export type NumberFormat = 'point' | 'comma';

export interface ImportOptions {
  /** How dates are written in the file. Null means it could not be told and must be chosen. */
  dateFormat: DateFormat | null;
  /** How numbers are written. Null means the file does not settle it; it must be chosen if any number has a separator. */
  numberFormat: NumberFormat | null;
  /** Currency for costs in rows that state none. Null leaves them unspecified. */
  defaultCurrency: string | null;
  /** Unit for quantities in rows that state none. Null means they are counts of pieces. */
  defaultQuantityUnit: string | null;
}

export const FIELD_LABELS: Record<ImportField, string> = {
  ncrNumber: 'NCR ID',
  openedOn: 'Opened date',
  partNumber: 'Part',
  supplier: 'Supplier',
  defectCategory: 'Defect category',
  description: 'Description',
  quantityAffected: 'Affected quantity',
  quantityUnit: 'Quantity unit',
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
  quantityAffected: ['qty', 'quantity', 'quantityaffected', 'affectedquantity', 'affectedqty', 'qtyaffected', 'nonconformingqty', 'qtyrejected', 'rejectedqty'],
  quantityUnit: ['unit', 'units', 'uom', 'unitofmeasure', 'qtyunit', 'quantityunit', 'qtyuom'],
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

export interface NumberFormatEvidence {
  /** The format the values prove, or null when they prove nothing or contradict each other. */
  format: NumberFormat | null;
  /** True when at least one value contains a point or comma, so the format changes what is read. */
  needed: boolean;
}

const tidy = (raw: string) => raw.trim().replace(/[  ]/g, ' ');

/**
 * Works out how numbers are written, but only from values that can be read one
 * way. "1,234.56" proves the point format and "12,5" proves the comma format.
 * "1,234" proves nothing: it is 1234 in one format and 1.234 in the other, so
 * on its own it leaves the format undecided.
 */
export function detectNumberFormat(values: readonly string[]): NumberFormatEvidence {
  let needed = false;
  const proven = new Set<NumberFormat>();
  for (const raw of values) {
    const value = tidy(raw);
    if (!/^[\d., ]+$/.test(value)) continue;
    const lastPoint = value.lastIndexOf('.');
    const lastComma = value.lastIndexOf(',');
    if (lastPoint === -1 && lastComma === -1) continue;
    needed = true;
    if (lastPoint !== -1 && lastComma !== -1) {
      // With both present, the one written last is the decimal separator.
      proven.add(lastPoint > lastComma ? 'point' : 'comma');
      continue;
    }
    const separator = lastPoint !== -1 ? '.' : ',';
    const asDecimal: NumberFormat = separator === '.' ? 'point' : 'comma';
    const asThousands: NumberFormat = separator === '.' ? 'comma' : 'point';
    const parts = value.split(separator);
    if (parts.length > 2) {
      proven.add(asThousands);
    } else {
      const [before, after] = [parts[0]!.replace(/ /g, ''), parts[1]!];
      const couldBeThousands = after.length === 3 && before.length >= 1 && before.length <= 3;
      if (!couldBeThousands) proven.add(asDecimal);
    }
  }
  return { format: proven.size === 1 ? [...proven][0]! : null, needed };
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

const FORMAT_EXAMPLE: Record<NumberFormat, string> = { point: '1,234.56', comma: '1.234,56' };

/**
 * Splits a written number into its whole digits and its decimal digits, exactly
 * as the chosen format says. Nothing is rounded and no symbol is stripped.
 */
function readNumber(label: string, raw: string, format: NumberFormat | null): Parsed<{ whole: string; fraction: string }> {
  const text = tidy(raw);
  const symbol = /[^\d.,\s-]/.exec(text)?.[0];
  if (symbol !== undefined) {
    return { ok: false, problem: `${label} "${raw}" contains "${symbol}". Give the number alone.` };
  }
  if (/^\d+$/.test(text)) return { ok: true, value: { whole: text, fraction: '' } };
  if (format === null) {
    return { ok: false, problem: `${label} "${raw}" cannot be read until the number format is chosen.` };
  }
  const [thousands, decimal] = format === 'point' ? ['[, ]', String.raw`\.`] : ['[. ]', ','];
  const match = new RegExp(String.raw`^(\d{1,3}(?:${thousands}\d{3})+|\d+)(?:${decimal}(\d+))?$`).exec(text);
  if (!match) {
    return {
      ok: false,
      problem: `${label} "${raw}" is not a number that is zero or more, written like ${FORMAT_EXAMPLE[format]}.`,
    };
  }
  return { ok: true, value: { whole: match[1]!.replace(/\D/g, ''), fraction: match[2] ?? '' } };
}

/** Reads an amount into hundredths exactly. */
function parseCost(raw: string, format: NumberFormat | null): Parsed<number> {
  const read = readNumber('Recorded cost', raw, format);
  if (!read.ok) {
    return /contains "/.test(read.problem)
      ? { ok: false, problem: `${read.problem.replace(' Give the number alone.', '')} Give the amount alone and state the currency in a currency column or the import settings.` }
      : read;
  }
  const { whole, fraction } = read.value;
  if (fraction.length > 2) {
    return { ok: false, problem: `Recorded cost "${raw}" has more than two decimal places. Valynce does not round.` };
  }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return { ok: false, problem: `Recorded cost "${raw}" is too large.` };
  return { ok: true, value: cents };
}

/**
 * Reads a quantity. A count of pieces must be whole. A fraction is accepted
 * only when the row's unit is a recognised unit of measure, such as kg.
 */
function parseQuantity(raw: string, format: NumberFormat | null, fractional: boolean, unit: string | null): Parsed<number> {
  const read = readNumber('Affected quantity', raw, format);
  if (!read.ok) return read;
  const fraction = read.value.fraction.replace(/0+$/, '');
  if (fraction !== '' && !fractional) {
    return {
      ok: false,
      problem:
        unit === null
          ? `Affected quantity "${raw}" is not a whole number. Pieces are counted whole; a fraction needs a unit of measure such as kg.`
          : `Affected quantity "${raw}" is not a whole number, and "${unit}" is not a recognised unit of measure, so a fraction cannot be accepted.`,
    };
  }
  if (fraction.length > 3) {
    return { ok: false, problem: `Affected quantity "${raw}" has more than three decimal places. Valynce does not round.` };
  }
  const milli = Number(read.value.whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(milli)) return { ok: false, problem: `Affected quantity "${raw}" is too large.` };
  return { ok: true, value: milli / 1000 };
}

export interface NumberExample {
  field: 'quantityAffected' | 'cost';
  /** The value as written in the file. */
  raw: string;
  /** How it will be read, in plain digits with a point, or null when it cannot be read. */
  read: string | null;
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
  /** Ready rows whose cost takes its currency from the import setting, because the row itself states none. */
  costWithDefaultCurrency: number;
}

const COMPARED: readonly (keyof NcrFields)[] = [
  'openedOn',
  'partNumber',
  'supplier',
  'defectCategory',
  'description',
  'quantityAffected',
  'quantityUnit',
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
  quantityUnit: 'quantity unit',
  costCents: 'recorded cost',
  currency: 'currency',
  status: 'status',
  disposition: 'disposition',
  reportedCause: 'reported cause',
};

function differences(a: NcrFields, b: NcrFields): string[] {
  return COMPARED.filter((field) => a[field] !== b[field]).map((field) => COMPARED_LABELS[field]!);
}

/** Every non-empty value in the columns mapped to a number. */
export function numericValues(table: CsvTable, mapping: ImportMapping): string[] {
  const values: string[] = [];
  for (const field of ['quantityAffected', 'cost'] as const) {
    const index = mapping[field];
    if (index === null) continue;
    for (const cells of table.rows) {
      const value = (cells[index] ?? '').trim();
      if (value !== '') values.push(value);
    }
  }
  return values;
}

/**
 * A few numbers from the file with how each will be read, so the reading can
 * be checked by eye before anything is imported. Values that contain a
 * separator come first, since they are the ones the format changes.
 */
export function numberExamples(table: CsvTable, mapping: ImportMapping, options: ImportOptions, limit = 4): NumberExample[] {
  const examples: NumberExample[] = [];
  for (const field of ['quantityAffected', 'cost'] as const) {
    const index = mapping[field];
    if (index === null) continue;
    const distinct = [...new Set(table.rows.map((cells) => (cells[index] ?? '').trim()).filter((v) => v !== ''))];
    const chosen = [...distinct.filter((v) => /[.,]/.test(v)), ...distinct.filter((v) => !/[.,]/.test(v))].slice(0, limit);
    for (const raw of chosen) {
      let read: string | null = null;
      if (field === 'cost') {
        const parsed = parseCost(raw, options.numberFormat);
        if (parsed.ok) read = (parsed.value / 100).toFixed(2);
      } else {
        // Shown as a number only; whether a fraction is allowed depends on each row's unit.
        const parsed = parseQuantity(raw, options.numberFormat, true, null);
        if (parsed.ok) read = String(parsed.value);
      }
      examples.push({ field, raw, read });
    }
  }
  return examples;
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
  const numbers = numericValues(table, mapping);
  if (options.numberFormat === null && detectNumberFormat(numbers).needed) {
    const example = numbers.map(tidy).find((value) => /[.,]/.test(value));
    blocking.push(
      `Numbers in this file such as "${example}" could be read more than one way. Choose how numbers are written.`,
    );
  }

  const rows: PlannedRow[] = [];
  const seen = new Map<string, PlannedRow>();
  const summary: ImportSummary = { total: table.rows.length, ready: 0, errors: 0, duplicatesInFile: 0, duplicatesStored: 0, blank: 0 };
  let costWithoutCurrency = 0;
  let costWithDefaultCurrency = 0;

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
    let quantityUnit: string | null = null;
    const rawQuantity = cellOf(cells, 'quantityAffected');
    if (rawQuantity !== '') {
      // A unit only means something beside a quantity.
      const stated = readQuantityUnit(cellOf(cells, 'quantityUnit') || options.defaultQuantityUnit);
      const parsed = parseQuantity(rawQuantity, options.numberFormat, stated.fractional, stated.unit);
      if (parsed.ok) {
        quantityAffected = parsed.value;
        quantityUnit = stated.unit;
      } else {
        problems.push(parsed.problem);
      }
    }

    let costCents: number | null = null;
    const rawCost = cellOf(cells, 'cost');
    if (rawCost !== '') {
      const parsed = parseCost(rawCost, options.numberFormat);
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
      quantityUnit,
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
      if (costCents !== null && currency !== null && rawCurrency === '') costWithDefaultCurrency += 1;
    }
  });

  return { blocking, rows, summary, costWithoutCurrency, costWithDefaultCurrency };
}
