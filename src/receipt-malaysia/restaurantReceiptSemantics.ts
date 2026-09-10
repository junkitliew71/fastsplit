/** Semantic roles used by Malaysian restaurant/cafe POS receipts. */
export const restaurantSemanticMap = {
  qty: 'quantity', quantity: 'quantity', unit: 'quantity', units: 'quantity', pcs: 'quantity', pc: 'quantity', piece: 'quantity', pieces: 'quantity',
  ea: 'each', each: 'each',
  item: 'item_header', description: 'item_header', product: 'item_header', menu: 'item_header', details: 'item_header',
  price: 'price_header', amount: 'price_header', rate: 'price_header',
  subtotal: 'subtotal', 'bill rounding': 'rounding', rounding: 'rounding', total: 'total', balance: 'balance',
  'invoice no': 'invoice_number', date: 'date_time', 'table pax': 'pax', order: 'order_number',
} as const;

export const quantityWords = /\b(?:qty|quantity|units?|pcs?|pieces?|ea|each)\b/i;
export const itemHeaderWords = /\b(?:item|description|product|menu|details)\b/i;
export const priceHeaderWords = /\b(?:price|amount|unit\s*price|rate|total\s*price|line\s*total)\b/i;
export const eachPrice = /\(\s*(?:RM|MYR)?\s*([0-9]+(?:[.,][0-9]{1,2}))\s*\/(?:ea|unit)\s*\)|\b(?:RM|MYR)?\s*([0-9]+(?:[.,][0-9]{1,2}))\s+per\s+(?:item|unit)\b/i;

export function isColumnHeader(line: string) {
  if (/\d+[.,]\d{1,2}/.test(line)) return false;
  return (quantityWords.test(line) && (itemHeaderWords.test(line) || priceHeaderWords.test(line)))
    || /^\s*(?:qty|quantity|item|description|product|menu|details|price(?:\s*\((?:MYR|RM)\))?|amount|rate)\s*$/i.test(line);
}

export function isQuantitySummary(line: string) { return /^\s*\d{1,3}\s+(?:qty|quantity|units?|pcs?|pieces?)\s*$/i.test(line); }
export function isUnitPriceContinuation(line: string) { return /^\s*\(\s*(?:RM|MYR)?\s*[0-9]+(?:[.,][0-9]{1,2})\s*\/(?:ea|unit)\s*\)\s*$/i.test(line); }
