import type { NcrFields } from '../../core/ncr.ts';

/** For status and category: undefined matches everything, null matches records with no value. */
export interface RecordFilter {
  search: string;
  status: string | null | undefined;
  category: string | null | undefined;
}

export const NO_FILTER: RecordFilter = { search: '', status: undefined, category: undefined };

const SEARCHED_FIELDS = [
  'ncrNumber',
  'partNumber',
  'supplier',
  'defectCategory',
  'description',
  'status',
  'disposition',
  'reportedCause',
] as const;

export function isFiltering(filter: RecordFilter): boolean {
  return filter.search.trim() !== '' || filter.status !== undefined || filter.category !== undefined;
}

/**
 * Records matching every active part of the filter. Search is a case-insensitive
 * match on any text field; status and category match exactly as written.
 */
export function filterRecords<T extends NcrFields>(records: readonly T[], filter: RecordFilter): T[] {
  const needle = filter.search.trim().toLowerCase();
  return records.filter((r) => {
    if (filter.status !== undefined && r.status !== filter.status) return false;
    if (filter.category !== undefined && r.defectCategory !== filter.category) return false;
    if (needle === '') return true;
    return SEARCHED_FIELDS.some((field) => r[field]?.toLowerCase().includes(needle));
  });
}

export interface FieldOptions {
  /** Distinct recorded values, alphabetical. */
  values: string[];
  /** True when at least one record has no value for the field. */
  hasMissing: boolean;
}

export function fieldOptions(
  records: readonly NcrFields[],
  field: 'status' | 'defectCategory',
): FieldOptions {
  const values = new Set<string>();
  let hasMissing = false;
  for (const r of records) {
    const value = r[field];
    if (value === null) hasMissing = true;
    else values.add(value);
  }
  return { values: [...values].sort((a, b) => a.localeCompare(b)), hasMissing };
}
