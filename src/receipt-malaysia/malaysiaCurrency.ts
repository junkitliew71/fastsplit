/** Extract a price only when it is decimal, or has an explicit Malaysian currency marker. */
const money = /(?:\b(?:RM|MYR)\s*)?((?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d{1,5})(?:[.,]\d{1,2})?(?![\d.,]))/ig;
export function normaliseMoneyOcr(value: string) {
  // OCR substitutions are safe only inside a number that is already marked as money.
  return value.replace(/\b(?:RM|MYR)\s*[Il](?=\d*(?:[.,]\d{1,2})?\b)/ig, match => match.replace(/[Il]/g, '1'))
    .replace(/\b\d+[.,][SO]{1,2}(?=\b)/g, match => match.replace(/S/g, '5').replace(/O/g, '0'));
}
export function moneyValues(line: string): number[] {
  const fixed = normaliseMoneyOcr(line);
  return [...fixed.matchAll(money)].flatMap(match => {
    const raw = match[1]; const marked = /(?:RM|MYR)/i.test(match[0]);
    // Plain integers are commonly SKU, quantity, table/pax or postcode. Require RM/MYR.
    if (!marked && !/[.,]\d{1,2}$/.test(raw)) return [];
    const numeric = Number(raw.replace(/,/g, ''));
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100000 ? [Math.round(numeric * 100)] : [];
  });
}
export function lastMoney(line: string) { const values = moneyValues(line); return values.length ? values[values.length - 1] : null; }
