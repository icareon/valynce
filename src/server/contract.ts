// Shapes of the JSON the local backend returns. Types only, so the UI can import them.
import type { Delimiter } from '../core/csv.ts';
import type { ImportBatch, InsertResult, NcrRecord } from '../core/ncr.ts';
import type {
  DateFormat,
  ImportMapping,
  ImportOptions,
  ImportSummary,
  NumberExample,
  NumberFormat,
  PlannedRow,
} from '../modules/quality/importRules.ts';
import type { NcrTotals } from '../modules/quality/totals.ts';

export interface NcrListResponse {
  records: NcrRecord[];
  totals: NcrTotals;
  /** How many of the records are synthetic sample data. */
  sampleCount: number;
  /** Files imported so far, newest first. */
  imports: ImportBatch[];
}

/** Sent to preview or carry out an import. The file's text is sent each time; the server keeps nothing between calls. */
export interface ImportRequest {
  fileName: string;
  text: string;
  /** Omit both to let the server suggest them from the file. */
  mapping?: ImportMapping;
  options?: ImportOptions;
}

export interface ImportPreviewResponse {
  fileName: string;
  delimiter: Delimiter;
  /** Column names for display, one per file column. */
  columns: string[];
  /** The first non-empty value in each column, as an example. */
  examples: (string | null)[];
  mapping: ImportMapping;
  options: ImportOptions;
  /**
   * What the file's own values prove. A null format means they do not settle it.
   * `numberFormatNeeded` is true when some number has a separator, so the format changes what is read.
   */
  detected: { dateFormat: DateFormat | null; numberFormat: NumberFormat | null; numberFormatNeeded: boolean };
  /** Numbers from the file with how each will be read under the current settings. */
  numberExamples: NumberExample[];
  blocking: string[];
  summary: ImportSummary;
  costWithoutCurrency: number;
  /** Every row that will not be imported, up to a limit. */
  skippedRows: PlannedRow[];
  /** The first rows that will be imported. */
  readyRows: PlannedRow[];
  /** True when there were more skipped rows than could be listed. */
  skippedRowsTruncated: boolean;
}

export interface ImportCommitResponse {
  batch: ImportBatch;
  summary: ImportSummary;
  skippedRows: PlannedRow[];
  skippedRowsTruncated: boolean;
}

export interface RemoveImportResponse {
  deleted: number;
}

export type LoadSampleResponse = InsertResult;

export interface RemoveSampleResponse {
  deleted: number;
}
