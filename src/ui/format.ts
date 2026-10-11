const whole = new Intl.NumberFormat();
const amount = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byCurrency = new Map<string, Intl.NumberFormat>();

export const formatWhole = (value: number): string => whole.format(value);

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
