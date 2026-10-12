import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { columnLabels, parseCsv } from '../core/csv.ts';
import type { CsvTable } from '../core/csv.ts';
import { isCurrencyCode, readQuantityUnit } from '../core/ncr.ts';
import type { NcrStorage } from '../core/storage.ts';
import {
  detectDateFormat,
  detectNumberFormat,
  IMPORT_FIELDS,
  numberExamples,
  numericValues,
  planImport,
  suggestMapping,
} from '../modules/quality/importRules.ts';
import type { ImportMapping, ImportOptions, ImportPlan } from '../modules/quality/importRules.ts';
import type { ImportCommitResponse, ImportPreviewResponse, RemoveImportResponse } from './contract.ts';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_SKIPPED_LISTED = 1000;
const READY_PREVIEWED = 50;

interface Prepared {
  fileName: string;
  text: string;
  table: CsvTable;
  mapping: ImportMapping;
  options: ImportOptions;
  detected: ImportPreviewResponse['detected'];
  plan: ImportPlan;
}

const columnValues = (table: CsvTable, index: number | null): string[] =>
  index === null ? [] : table.rows.map((cells) => cells[index] ?? '');

/** Checks the request and plans the import. Returns a message when the request cannot be used. */
function prepare(body: unknown, storage: NcrStorage): Prepared | string {
  if (typeof body !== 'object' || body === null) return 'The request is not an object.';
  const { fileName, text, mapping: rawMapping, options: rawOptions } = body as Record<string, unknown>;
  if (typeof fileName !== 'string' || fileName.trim() === '' || fileName.length > 255) return 'A file name is required.';
  if (typeof text !== 'string') return 'The file text is missing.';

  const parsed = parseCsv(text);
  if (!parsed.ok) return parsed.error;
  const { table } = parsed;
  if (table.rows.length === 0) return 'The file has a header row but no records.';
  if (table.rows.length > MAX_ROWS) return `The file has more than ${MAX_ROWS.toLocaleString('en')} rows.`;

  let mapping: ImportMapping;
  if (rawMapping === undefined) {
    mapping = suggestMapping(table.headers);
  } else {
    if (typeof rawMapping !== 'object' || rawMapping === null) return 'The column mapping is not valid.';
    mapping = {} as ImportMapping;
    for (const field of IMPORT_FIELDS) {
      const index = (rawMapping as Record<string, unknown>)[field] ?? null;
      const inRange = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < table.headers.length;
      if (index !== null && !inRange) return `The column chosen for ${field} is not in the file.`;
      mapping[field] = index as number | null;
    }
  }

  const numbers = detectNumberFormat(numericValues(table, mapping));
  const detected = {
    dateFormat: detectDateFormat(columnValues(table, mapping.openedOn)),
    numberFormat: numbers.format,
    numberFormatNeeded: numbers.needed,
  };

  let options: ImportOptions;
  if (rawOptions === undefined) {
    options = { dateFormat: detected.dateFormat, numberFormat: detected.numberFormat, defaultCurrency: null, defaultQuantityUnit: null };
  } else {
    if (typeof rawOptions !== 'object' || rawOptions === null) return 'The import settings are not valid.';
    const { dateFormat, numberFormat, defaultCurrency, defaultQuantityUnit } = rawOptions as Record<string, unknown>;
    if (dateFormat !== null && dateFormat !== 'YMD' && dateFormat !== 'DMY' && dateFormat !== 'MDY') {
      return 'The date format is not valid.';
    }
    if (numberFormat !== null && numberFormat !== 'point' && numberFormat !== 'comma') return 'The number format is not valid.';
    if (defaultQuantityUnit !== null && (typeof defaultQuantityUnit !== 'string' || defaultQuantityUnit.trim() === '' || defaultQuantityUnit.length > 20)) {
      return 'The quantity unit is not valid.';
    }
    if (defaultCurrency !== null && !(typeof defaultCurrency === 'string' && isCurrencyCode(defaultCurrency))) {
      return 'The currency is not an ISO 4217 code such as USD or EUR.';
    }
    options = {
      dateFormat,
      numberFormat,
      defaultCurrency,
      // Stored the way a unit read from the file would be, so both routes agree.
      defaultQuantityUnit: defaultQuantityUnit === null ? null : readQuantityUnit(defaultQuantityUnit).unit,
    };
  }

  const stored = new Map(storage.list().map((record) => [record.ncrNumber, record]));
  return { fileName: fileName.trim(), text, table, mapping, options, detected, plan: planImport(table, mapping, options, stored) };
}

function skipped(plan: ImportPlan) {
  const all = plan.rows.filter((row) => row.status !== 'ready' && row.status !== 'blank');
  return { skippedRows: all.slice(0, MAX_SKIPPED_LISTED), skippedRowsTruncated: all.length > MAX_SKIPPED_LISTED };
}

export function registerImportRoutes(app: Hono, storage: NcrStorage): void {
  const limit = bodyLimit({
    maxSize: MAX_FILE_BYTES,
    onError: (c) => c.json({ error: 'The file is larger than 20 MB.' }, 413),
  });

  const read = async (request: { json: () => Promise<unknown> }): Promise<Prepared | string> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return 'The request is not valid JSON.';
    }
    return prepare(body, storage);
  };

  // Shows what an import would do. Nothing is stored.
  app.post('/api/import/preview', limit, async (c) => {
    const prepared = await read(c.req);
    if (typeof prepared === 'string') return c.json({ error: prepared }, 400);
    const { table, plan } = prepared;
    const body: ImportPreviewResponse = {
      fileName: prepared.fileName,
      delimiter: table.delimiter,
      columns: columnLabels(table.headers),
      examples: table.headers.map((_, i) => table.rows.find((cells) => (cells[i] ?? '').trim() !== '')?.[i]?.trim() ?? null),
      mapping: prepared.mapping,
      options: prepared.options,
      detected: prepared.detected,
      numberExamples: numberExamples(table, prepared.mapping, prepared.options),
      blocking: plan.blocking,
      summary: plan.summary,
      costWithoutCurrency: plan.costWithoutCurrency,
      costWithDefaultCurrency: plan.costWithDefaultCurrency,
      ...skipped(plan),
      readyRows: plan.rows.filter((row) => row.status === 'ready').slice(0, READY_PREVIEWED),
    };
    return c.json(body);
  });

  // Stores the rows the preview marked as ready, with a record of the file they came from.
  app.post('/api/import/commit', limit, async (c) => {
    const prepared = await read(c.req);
    if (typeof prepared === 'string') return c.json({ error: prepared }, 400);
    const { plan } = prepared;
    if (plan.blocking.length > 0) return c.json({ error: plan.blocking.join(' ') }, 400);
    const ready = plan.rows.filter((row) => row.status === 'ready');
    if (ready.length === 0) return c.json({ error: 'No row in this file can be imported.' }, 400);

    const batch = storage.importBatch(
      {
        fileName: prepared.fileName,
        fileSha256: createHash('sha256').update(prepared.text).digest('hex'),
        settings: { mapping: prepared.mapping, options: prepared.options, columns: columnLabels(prepared.table.headers) },
        rowsTotal: plan.summary.total,
        rowsDuplicate: plan.summary.duplicatesInFile + plan.summary.duplicatesStored,
        rowsRejected: plan.summary.errors,
        rowsBlank: plan.summary.blank,
      },
      ready.map((row) => ({ fields: row.fields!, sourceRow: row.row, sourceValues: row.source })),
    );
    const body: ImportCommitResponse = { batch, summary: plan.summary, ...skipped(plan) };
    return c.json(body);
  });

  // Undoes one import.
  app.delete('/api/imports/:id', (c) => {
    const id = Number(c.req.param('id'));
    const deleted = Number.isInteger(id) ? storage.deleteImport(id) : null;
    if (deleted === null) return c.json({ error: 'No such import.' }, 404);
    const body: RemoveImportResponse = { deleted };
    return c.json(body);
  });
}
