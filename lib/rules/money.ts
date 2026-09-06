/**
 * Money is stored and reasoned about in minor units. Formatting lives here so
 * rule reasons and the UI render the same string for the same amount.
 */
export function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(amountCents / 100);
}
