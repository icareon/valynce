import { toMilli } from '../../core/ncr.ts';
import type { NcrFields } from '../../core/ncr.ts';

/** Affected quantity in one unit. A null unit is a count of pieces. */
export interface QuantityGroup {
  unit: string | null;
  sum: number;
  recorded: number;
}

export interface QuantityTotal {
  /** One total per unit, never added together. Piece counts first, then units by name. */
  groups: QuantityGroup[];
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
  /** Affected quantity, summed per unit over records that state a quantity. */
  quantity: QuantityTotal;
  /** Recorded cost, summed per currency over records that state a cost. */
  cost: CostTotal;
}

type TotalsInput = Pick<NcrFields, 'quantityAffected' | 'quantityUnit' | 'costCents' | 'currency'>;

/**
 * A missing quantity or cost is counted as missing. It is not treated as zero,
 * so a total is always "the sum of what was recorded" plus how much is unknown.
 * Quantities in different units, and costs in different or unstated currencies,
 * are kept apart. Sums are made in whole thousandths and hundredths, so they are exact.
 */
export function computeTotals(records: readonly TotalsInput[]): NcrTotals {
  const quantities = new Map<string | null, { milli: number; recorded: number }>();
  const costs = new Map<string | null, CostGroup>();
  let quantityMissing = 0;
  let costMissing = 0;

  for (const r of records) {
    if (r.quantityAffected === null) {
      quantityMissing += 1;
    } else {
      const group = quantities.get(r.quantityUnit) ?? { milli: 0, recorded: 0 };
      group.milli += toMilli(r.quantityAffected) ?? 0;
      group.recorded += 1;
      quantities.set(r.quantityUnit, group);
    }

    if (r.costCents === null) {
      costMissing += 1;
    } else {
      const group = costs.get(r.currency) ?? { currency: r.currency, sumCents: 0, recorded: 0 };
      group.sumCents += r.costCents;
      group.recorded += 1;
      costs.set(r.currency, group);
    }
  }

  const quantityGroups = [...quantities.entries()]
    .map(([unit, group]) => ({ unit, sum: group.milli / 1000, recorded: group.recorded }))
    .sort((a, b) => (a.unit === null ? -1 : b.unit === null ? 1 : a.unit.localeCompare(b.unit)));
  const costGroups = [...costs.values()].sort((a, b) =>
    a.currency === null ? 1 : b.currency === null ? -1 : a.currency.localeCompare(b.currency),
  );

  return {
    recordCount: records.length,
    quantity: { groups: quantityGroups, recorded: records.length - quantityMissing, missing: quantityMissing },
    cost: { groups: costGroups, recorded: records.length - costMissing, missing: costMissing },
  };
}

/**
 * The one currency the summary and the cost ranking show for now. Costs in any
 * other currency, or with none stated, stay stored exactly as recorded; they are
 * left out of these two views, never converted and never relabelled.
 */
export const REPORTING_CURRENCY = 'USD';

export interface CurrencyCost {
  currency: string;
  /** Sum of the costs stated in this currency. Null when no report states one, which is not the same as zero. */
  sumCents: number | null;
  /** Reports with a cost stated in this currency. */
  recorded: number;
  /** Reports with a cost in another currency or with no currency stated. They are not in the sum. */
  otherCurrency: number;
  /** Reports with no cost at all. */
  missing: number;
}

/** The part of a cost total that is stated in one currency, with what it leaves out counted. */
export function costInCurrency(total: CostTotal, currency: string): CurrencyCost {
  const group = total.groups.find((g) => g.currency === currency);
  const recorded = group?.recorded ?? 0;
  return {
    currency,
    sumCents: group === undefined ? null : group.sumCents,
    recorded,
    otherCurrency: total.recorded - recorded,
    missing: total.missing,
  };
}
