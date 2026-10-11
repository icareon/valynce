import type { NcrFields } from '../../core/ncr.ts';

/** A sum over the records that have a value, with the count of those that do not. */
export interface MetricTotal {
  sum: number;
  recorded: number;
  missing: number;
}

/** Recorded cost in one currency. A null currency means the reports did not state one. */
export interface CostGroup {
  currency: string | null;
  sumCents: number;
  recorded: number;
}

export interface CostTotal {
  /** One total per currency, never added together. Stated currencies first, by code. */
  groups: CostGroup[];
  recorded: number;
  missing: number;
}

export interface NcrTotals {
  /** Number of NCRs. Each report counts once, whatever its quantity or cost. */
  recordCount: number;
  /** Units affected, summed over records that state a quantity. */
  quantityAffected: MetricTotal;
  /** Recorded cost, summed per currency over records that state a cost. */
  cost: CostTotal;
}

type TotalsInput = Pick<NcrFields, 'quantityAffected' | 'costCents' | 'currency'>;

/**
 * A missing quantity or cost is counted as missing. It is not treated as zero,
 * so a total is always "the sum of what was recorded" plus how much is unknown.
 * Costs in different currencies, or with no stated currency, are kept apart.
 */
export function computeTotals(records: readonly TotalsInput[]): NcrTotals {
  const quantityAffected: MetricTotal = { sum: 0, recorded: 0, missing: 0 };
  const groups = new Map<string | null, CostGroup>();
  let costMissing = 0;

  for (const r of records) {
    if (r.quantityAffected === null) {
      quantityAffected.missing += 1;
    } else {
      quantityAffected.sum += r.quantityAffected;
      quantityAffected.recorded += 1;
    }

    if (r.costCents === null) {
      costMissing += 1;
    } else {
      const group = groups.get(r.currency) ?? { currency: r.currency, sumCents: 0, recorded: 0 };
      group.sumCents += r.costCents;
      group.recorded += 1;
      groups.set(r.currency, group);
    }
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.currency === null) return 1;
    if (b.currency === null) return -1;
    return a.currency.localeCompare(b.currency);
  });

  return {
    recordCount: records.length,
    quantityAffected,
    cost: { groups: sorted, recorded: records.length - costMissing, missing: costMissing },
  };
}
