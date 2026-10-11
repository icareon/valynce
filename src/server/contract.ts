// Shapes of the JSON the local backend returns. Types only, so the UI can import them.
import type { InsertResult, NcrRecord } from '../core/ncr.ts';
import type { NcrTotals } from '../modules/quality/totals.ts';

export interface NcrListResponse {
  records: NcrRecord[];
  totals: NcrTotals;
  /** How many of the records are synthetic sample data. */
  sampleCount: number;
}

export type LoadSampleResponse = InsertResult;

export interface RemoveSampleResponse {
  deleted: number;
}
