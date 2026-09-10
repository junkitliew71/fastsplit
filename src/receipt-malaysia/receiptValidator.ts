export function validateReceiptTotal(calculatedCents: number, printedTotalCents: number | null) {
  return printedTotalCents === null || Math.abs(calculatedCents - printedTotalCents) <= 2;
}
