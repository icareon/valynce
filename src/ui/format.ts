const whole = new Intl.NumberFormat();
const amount = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byCurrency = new Map<string, Intl.NumberFormat>();

const quantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const percent = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatWhole = (value: number): string => whole.format(value);

/** A quantity with its unit. With no unit it is a count of pieces and is shown as a bare number. */
export const formatQuantity = (value: number, unit: string | null): string =>
  unit === null ? quantity.format(value) : `${quantity.format(value)} ${unit}`;

/** A share between 0 and 1 as a percentage with one decimal. */
export const formatPercent = (share: number): string => percent.format(share);

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${formatWhole(count)} ${count === 1 ? one : many}`;

/**
 * Formats a cost held in hundredths. With no currency the bare amount is
 * returned; the caller must say that the currency is unspecified.
 */
export function formatCost(cents: number, currency: string | null): string {
  if (currency === null) return amount.format(cents / 100);
  let format = byCurrency.get(currency);
  if (format === undefined) {
    try {
      format = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return `${currency} ${amount.format(cents / 100)}`;
    }
    byCurrency.set(currency, format);
  }
  return format.format(cents / 100);
}
