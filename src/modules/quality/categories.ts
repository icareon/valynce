import type { NcrFields } from '../../core/ncr.ts';

export interface CategoryCount {
  /** The defect category as written on the reports. Null is the uncategorized bucket. */
  category: string | null;
  /** Number of NCRs. Each report counts once. */
  count: number;
}

/**
 * NCR count per defect category, largest first. Categories are compared exactly
 * as written; nothing is merged or renamed. Reports with no category are counted
 * in one uncategorized bucket, listed last, so the counts always add up to the
 * number of records.
 */
export function countByCategory(records: readonly Pick<NcrFields, 'defectCategory'>[]): CategoryCount[] {
  const counts = new Map<string | null, number>();
  for (const r of records) counts.set(r.defectCategory, (counts.get(r.defectCategory) ?? 0) + 1);

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => {
      if (a.category === null) return 1;
      if (b.category === null) return -1;
      return b.count - a.count || a.category.localeCompare(b.category);
    });
}
