import type { Receipt, ReceiptItem } from '../types';
import { lastMoney, moneyValues, normaliseMoneyOcr } from './malaysiaCurrency';
import { deliveryLabels, discountLabels, packagingLabels, roundingLabels, serviceLabels, subtotalLabels, taxLabels, totalLabels } from './malaysiaReceiptKeywords';
import { isNoiseLine } from './malaysiaIgnorePatterns';
import { validateReceiptTotal } from './receiptValidator';
import { eachPrice, isColumnHeader, isQuantitySummary, isUnitPriceContinuation } from './restaurantReceiptSemantics';

const uuid = () => crypto.randomUUID();
const rate = (line: string) => line.match(/(?:\b|\s)(\d{1,2}(?:\.\d+)?)\s*%/)?.[1];
function item(name: string, quantity: number, total: number): ReceiptItem | null {
  const clean = name.replace(eachPrice, '').replace(/\(\s*$/, '').replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^\d{4,14}\s+/, '').trim().slice(0, 100);
  if (!clean || quantity < 1 || quantity > 50 || total < 0) return null;
  return { id: uuid(), name: clean, quantity, unitPriceCents: total % quantity === 0 ? total / quantity : total, totalPriceCents: total };
}
function looksLikeMerchant(line: string) { return /\p{L}{3,}/u.test(line) && !moneyValues(line).length && line.length <= 70 && !/\b(?:cash|card|receipt|invoice|date|time|tel|table|pax|gst)\b/i.test(line); }
const matches = (label: RegExp, line: string, compact: string) => label.test(line) || label.test(compact);
function quantityAndName(line: string, values: number[]) {
  let name = line.slice(0, line.search(/(?:\bRM|\bMYR|\d+[.,]\d{1,2})/i)).trim();
  const explicit = line.match(/^\s*(\d{1,2})\s*(?:x|\*|@)\s*/i) || line.match(/\s(?:x|\*)\s*(\d{1,2})\s*$/i);
  // One/two digit leading numbers on restaurant rows are quantities. Longer
  // numeric prefixes remain SKU/PLU codes and are removed later by item().
  const quantityFirst = !explicit && values.length > 0 ? line.match(/^\s*(\d{1,2})\s+(?=[\p{L}][\p{L}\d]*\s)/u) : null;
  const quantityAt = !explicit && values.length > 1 ? line.match(/\s(\d{1,2})(?:\.0+)?\s*@/) : null;
  const trailingQuantity = !explicit && !quantityFirst && !quantityAt && values.length > 1 ? name.match(/\s(\d{1,2})$/) : null;
  if (explicit && /^\s*\d{1,2}\s*(?:x|\*|@)/i.test(name)) name = name.replace(/^\s*\d{1,2}\s*(?:x|\*|@)\s*/i, '');
  if (quantityFirst) name = name.replace(/^\s*\d{1,2}\s+/, '');
  if (quantityAt) name = name.replace(/\s\d{1,2}(?:\.0+)?\s*@\s*$/, '');
  if (trailingQuantity) name = name.slice(0, -trailingQuantity[0].length).trim();
  return { name, quantity: Number(explicit?.[1] || quantityFirst?.[1] || quantityAt?.[1] || trailingQuantity?.[1] || 1) };
}
/** Flexible post-OCR parser for Malaysian POS, retail and e-receipt text. */
export function parseMalaysiaReceiptText(text: string): Receipt {
  const lines = text.replace(/\r/g, '').split('\n').map(line => normaliseMoneyOcr(line).trim()).filter(Boolean);
  const items: ReceiptItem[] = []; let serviceChargeCents = 0, taxCents = 0, discountCents = 0, roundingCents = 0, otherFees = 0, printedTotal: number | null = null, restaurant = '';
  let pendingName = '', skipOrderValue = false;
  for (const line of lines) {
    const compact = line.replace(/\s/g, ''); const value = lastMoney(line); const values = moneyValues(line);
    if (!restaurant && looksLikeMerchant(line)) restaurant = line;
    if (/^\s*(?:order|queue)(?:\s*(?:no|number|#))?\s*$/i.test(line)) { skipOrderValue = true; pendingName = ''; continue; }
    if (skipOrderValue) { skipOrderValue = false; continue; }
    if (isColumnHeader(line) || isQuantitySummary(line) || isUnitPriceContinuation(line)) { pendingName = ''; continue; }
    if (/\d{1,3}\.\d{3}\.\d{2}/.test(line)) continue; // dotted address / identifier, never a price
    if (matches(subtotalLabels, line, compact)) continue;
    if (matches(totalLabels, line, compact)) { if (value !== null) printedTotal = value; continue; }
    if (matches(discountLabels, line, compact)) { if (value !== null) discountCents += value; continue; }
    if (matches(serviceLabels, line, compact)) { if (value !== null) serviceChargeCents += value; continue; }
    if (matches(taxLabels, line, compact)) { if (value !== null) taxCents += value; continue; }
    if (roundingLabels.test(line)) { if (value !== null) roundingCents += /-\s*(?:RM|MYR)?\s*\d/.test(line) ? -value : value; continue; }
    if (deliveryLabels.test(line) || packagingLabels.test(line)) { if (value !== null) otherFees += value; continue; }
    if (isNoiseLine(line)) continue;
    if (value === null) { if (/\p{L}/u.test(line) && line.length <= 100) pendingName = line; continue; }
    const candidate = pendingName ? `${pendingName} ${line}` : line; pendingName = '';
    const candidateValues = moneyValues(candidate); const parsed = quantityAndName(candidate, candidateValues);
    const lineItem = item(parsed.name, parsed.quantity, candidateValues[candidateValues.length - 1]);
    if (lineItem) items.push(lineItem);
  }
  const calculated = items.reduce((sum, entry) => sum + entry.totalPriceCents, 0) + serviceChargeCents + taxCents + otherFees + roundingCents - discountCents;
  const warnings = ['Please check the detected items before continuing.'];
  if (!items.length) warnings.push('No priced item lines were certain enough to add. Enter the receipt manually.');
  if (!validateReceiptTotal(calculated, printedTotal)) warnings.push(`Detected entries add up to ${(calculated / 100).toFixed(2)}, while the printed total is ${(printedTotal! / 100).toFixed(2)}. Check every amount.`);
  // FastSplit currently has fields only for food/service/tax/discount. Other fees are
  // included with service charge so the bill remains balanced and visibly editable.
  return { restaurant: restaurant || 'Receipt', items, serviceChargeCents: serviceChargeCents + otherFees + roundingCents, taxCents, discountCents, scanWarning: warnings.join(' ') };
}
