import type { NcrFields } from '../../core/ncr.ts';

/** A sum over the records that have a value, with the count of those that do not. */
export interface MetricTotal {
  sum: number;
  recorded: number;
  missing: number;
}

export interface NcrTotals {
  /** Number of NCRs. Each report counts once, whatever its quantity or cost. */
  recordCount: number;
  /** Units affected, summed over records that state a quantity. */
  quantityAffected: MetricTotal;
  /** Recorded cost in hundredths, summed over records that state a cost. */
  costCents: MetricTotal;
}

function total(values: readonly (number | null)[]): MetricTotal {
  const result: MetricTotal = { sum: 0, recorded: 0, missing: 0 };
  for (const value of values) {
    if (value === null) {
      result.missing += 1;
    } else {
      result.sum += value;
      result.recorded += 1;
    }
  }
  return result;
}

/**
 * A missing quantity or cost is counted as missing. It is not treated as zero,
 * so a total is always "the sum of what was recorded" plus how much is unknown.
 */
export function computeTotals(records: readonly Pick<NcrFields, 'quantityAffected' | 'costCents'>[]): NcrTotals {
  return {
    recordCount: records.length,
    quantityAffected: total(records.map((r) => r.quantityAffected)),
    costCents: total(records.map((r) => r.costCents)),
  };
}
