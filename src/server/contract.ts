// Shapes of the JSON the local backend returns. Types only, so the UI can import them.
import type { Delimiter } from '../core/csv.ts';
import type { ImportBatch, InsertResult, NcrRecord } from '../core/ncr.ts';
import type { AnalysisScope, EvidenceDisclosure } from '../modules/quality/evidence.ts';
import type {
  DateFormat,
  ImportMapping,
  ImportOptions,
  ImportSummary,
  NumberExample,
  NumberFormat,
  PlannedRow,
} from '../modules/quality/importRules.ts';
import type { AiLocation, OfflineStatus } from '../ai/provider.ts';
import type { AiSummary } from '../modules/quality/summaryRules.ts';
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
  /** Reports to import whose cost takes its currency from the import setting. */
  costWithDefaultCurrency: number;
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

// ---------- AI summary ----------

/** A generated summary with the analysis it belongs to. */
export interface SummaryRecord {
  id: number;
  createdAt: string;
  /** Where it was generated. Fixed when it is stored; choosing another provider later does not change it. */
  location: AiLocation;
  provider: string;
  model: string;
  /** Identifies the exact evidence it was generated from. */
  fingerprint: string;
  scope: AnalysisScope;
  /** Scope and figures as Valynce computed them when the summary was generated. */
  facts: string[];
  /** NCR IDs of the reports the model was given. */
  recordIds: string[];
  summary: AiSummary;
  durationMs: number;
  /** Model calls made: 1, or 2 when the first reply had to be corrected. */
  attempts: number;
}

export interface SummaryCheckRequest {
  scope: AnalysisScope;
  /** Which provider the user has selected. The limits differ. Defaults to online. */
  location?: AiLocation;
}

/** What a summary of the current analysis would send, and the state of the last one. Nothing is sent to produce this. */
export interface SummaryCheckResponse {
  /** The provider the request below was worked out for. */
  location: AiLocation;
  /** The online provider. Null when no API key is configured. The key itself never leaves the server. */
  provider: { name: string; model: string; host: string } | null;
  /** The offline AI on this computer: installed or not, and what a set-up would download. */
  offline: OfflineStatus;
  /** What the offline model reads for each report, in words. */
  offlineFields: string[];
  /** What would be sent. `ok: false` carries the reason this analysis cannot be summarised as it stands. */
  request:
    | { ok: true; fingerprint: string; disclosure: EvidenceDisclosure; facts: string[] }
    | { ok: false; reason: string; message: string };
  /** Limits for the selected provider. */
  limits: { records: number; categories: number; textChars: number; timeoutSeconds: number };
  latest: SummaryRecord | null;
  /** True when `latest` was generated from different evidence than the current analysis. */
  latestOutdated: boolean;
}

export interface SummaryGenerateRequest {
  scope: AnalysisScope;
  /** From the check the user confirmed. The request is refused if the evidence has changed since. */
  fingerprint: string;
  /** Must be true: the user confirmed this request, and for the online provider that this data is sent to it. */
  confirmed: boolean;
  /** The provider the user selected and confirmed. Never substituted by the server. Defaults to online. */
  location?: AiLocation;
}

export interface SummaryGenerateResponse {
  summary: SummaryRecord;
}

/** The offline AI's state. Returned by the routes that start, cancel and remove its download. */
export type OfflineStatusResponse = OfflineStatus;

export interface RemoveSummaryResponse {
  deleted: boolean;
}
