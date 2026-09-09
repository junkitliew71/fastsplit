import { describe,it,expect } from 'vitest';
import { calculateSettlement,calculateItemShares,fixRoundingDifference,cents,validateBillTotal } from '../src/utils/billCalculator';
import type { Bill } from '../src/types';
import { fixture } from './fixture';
describe('exact-cent calculation',()=>{
  it('parses money without floating point drift',()=>{expect(cents('12.50')).toBe(1250);expect(cents('0.29')).toBe(29);expect(()=>cents('1.234')).toThrow();expect(()=>cents('-1')).toThrow();});
  it('one person and one item',()=>{const b=fixture();b.participants=b.participants.slice(0,1);b.itemUnits[0].participantIds=['a'];expect(calculateSettlement(b)[0].finalTotalCents).toBe(1150);});
  it('shared items and deterministic three-way rounding',()=>{expect(fixRoundingDifference(1000,[1,1,1])).toEqual([334,333,333]);expect(fixRoundingDifference(2,[1,1,1])).toEqual([1,1,0]);});
  it('quantity units can go to different people',()=>{const b=fixture();b.itemUnits=[{id:'1',itemId:'drink',name:'Coke #1',priceCents:300,participantIds:['a']},{id:'2',itemId:'drink',name:'Coke #2',priceCents:300,participantIds:['b']},{id:'3',itemId:'drink',name:'Coke #3',priceCents:300,participantIds:['b']}];b.subtotalCents=900;b.serviceChargeCents=b.taxCents=b.discountCents=0;expect(calculateSettlement(b).map(s=>s.finalTotalCents)).toEqual([300,600,0]);});
  it('distributes service, SST and discounts proportionally',()=>{const b=fixture();b.itemUnits=[{id:'1',itemId:'a',name:'a',priceCents:2500,participantIds:['a']},{id:'2',itemId:'b',name:'b',priceCents:7500,participantIds:['b']}];b.subtotalCents=10000;b.serviceChargeCents=1000;b.taxCents=600;b.discountCents=1000;expect(calculateSettlement(b)[0]).toMatchObject({foodSubtotalCents:2500,serviceChargeCents:250,taxCents:150,discountCents:250,finalTotalCents:2650});});
  it('rejects unassigned chargeable items and unknown people',()=>{const b=fixture();expect(()=>calculateItemShares({...b.itemUnits[0],participantIds:[]},b.participants)).toThrow();expect(()=>calculateItemShares({...b.itemUnits[0],participantIds:['bad']},b.participants)).toThrow();});
  it('always reconciles over a broad range of cent totals',()=>{for(let n=1;n<1000;n++){const b=fixture();b.itemUnits[0].priceCents=n;b.subtotalCents=n;b.discountCents=Math.min(n,10);b.totalCents=n+160-b.discountCents;b.settlements=calculateSettlement(b);expect(validateBillTotal(b)).toBe(true);expect(b.settlements.every(s=>s.finalTotalCents>=0)).toBe(true);}});
});
