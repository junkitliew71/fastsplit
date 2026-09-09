import type { Bill, ItemUnit, Participant, ParticipantSettlement } from '../types';
export const money = (cents: number) => `${(cents / 100).toFixed(2)}`;
export function cents(value: string): number {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) throw new Error('Enter a non-negative amount with up to 2 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100000000) throw new Error('Amount is too large.');
  return result;
}
// Largest remainder allocation. BigInt avoids fractional-cent and multiplication drift.
export function fixRoundingDifference(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new Error('Invalid allocation.');
  const sum = weights.reduce((a,b) => a + b, 0);
  if (!sum) { if (total) throw new Error('Cannot allocate charges without food.'); return weights.map(() => 0); }
  const shares = weights.map(w => Number(BigInt(total) * BigInt(w) / BigInt(sum)));
  const order = weights.map((w,i) => ({i, r: BigInt(total) * BigInt(w) % BigInt(sum)})).sort((a,b) => a.r === b.r ? a.i-b.i : a.r > b.r ? -1 : 1);
  let left = total - shares.reduce((a,b) => a+b,0);
  for (const {i} of order) { if (!left) break; shares[i]++; left--; }
  return shares;
}
export function calculateItemShares(unit: ItemUnit, participants: Participant[]): number[] {
  const ids = new Set(unit.participantIds);
  if (ids.size !== unit.participantIds.length || [...ids].some(id => !participants.some(p => p.id === id))) throw new Error('Invalid assignment.');
  if (unit.priceCents && !ids.size) throw new Error('Assign every item before calculating.');
  return fixRoundingDifference(unit.priceCents, participants.map(p => ids.has(p.id) ? 1 : 0));
}
export function calculateParticipantFoodSubtotal(units: ItemUnit[], participants: Participant[]) {
  return units.reduce((sum,u) => calculateItemShares(u,participants).map((v,i) => v+sum[i]), participants.map(() => 0));
}
export const calculateServiceChargeShares = fixRoundingDifference;
export const calculateTaxShares = fixRoundingDifference;
export const calculateDiscountShares = fixRoundingDifference;
export function calculateSettlement(bill: Bill): ParticipantSettlement[] {
  const food = calculateParticipantFoodSubtotal(bill.itemUnits,bill.participants);
  if (bill.discountCents > bill.subtotalCents) throw new Error('Discount cannot exceed the food subtotal.');
  const service = calculateServiceChargeShares(bill.serviceChargeCents, food);
  const tax = calculateTaxShares(bill.taxCents, food);
  const discount = calculateDiscountShares(bill.discountCents, food);
  return bill.participants.map((p,i) => ({participantId:p.id,foodSubtotalCents:food[i],serviceChargeCents:service[i],taxCents:tax[i],discountCents:discount[i],finalTotalCents:food[i]+service[i]+tax[i]-discount[i]}));
}
export function validateBillTotal(bill: Bill) { return bill.totalCents === bill.settlements.reduce((s,p) => s+p.finalTotalCents,0); }
export function totals(bill: Bill): Bill {
  const items = bill.items.map(i => ({...i,totalPriceCents:i.quantity*i.unitPriceCents}));
  const subtotalCents = items.reduce((s,i) => s+i.totalPriceCents,0);
  return {...bill,items,subtotalCents,totalCents:subtotalCents+bill.serviceChargeCents+bill.taxCents-bill.discountCents};
}
