import { describe, it, expect } from 'vitest';
import { parseReceiptText, prepareReceiptImage, validateReceiptImage } from '../src/services/receiptScanner';
describe('Receipt image input',()=>{
  it('accepts large supported photos for preprocessing',()=>{expect(()=>validateReceiptImage(new File([new Uint8Array(5*1024*1024)],'receipt.jpg',{type:'image/jpeg'}))).not.toThrow();});
  it('keeps small images unchanged to preserve fine print',async()=>{const file=new File(['image'],'receipt.png',{type:'image/png'});expect(await prepareReceiptImage(file)).toBe(file);});
  it('gives actionable errors for unsupported and empty photos',()=>{expect(()=>validateReceiptImage(new File(['image'],'receipt.heic',{type:'image/heic'}))).toThrow('export as JPG');expect(()=>validateReceiptImage(new File([],'receipt.png',{type:'image/png'}))).toThrow('empty');});
});
describe('local receipt parser',()=>{
  it('extracts Malaysian-style item amounts and charges conservatively',()=>{const receipt=parseReceiptText('Kedai Makan\nChicken Rice RM 8.50\n2 x Coke 6.00\nService Charge 1.45\nSST 0.87\nTotal 16.82');expect(receipt.restaurant).toBe('Kedai Makan');expect(receipt.items.map(i=>i.name)).toEqual(['Chicken Rice','Coke']);expect(receipt.items[1].quantity).toBe(2);expect(receipt.serviceChargeCents).toBe(145);expect(receipt.taxCents).toBe(87);});
  it('does not manufacture unreadable item lines',()=>{expect(parseReceiptText('TOTAL RM 10.00').items).toEqual([]);});
  it('does not treat subtotal or TNG settlement lines as food',()=>{const receipt=parseReceiptText('Mango Juice 6.50\nCreme Brulee Souffle Pancake 17.90\nEe SUBTTL 24.40\nBee TNG 28.30');expect(receipt.items.map(i=>i.name)).toEqual(['Mango Juice','Creme Brulee Souffle Pancake']);});
  it('excludes Italian and Chinese subtotal and payment rows',()=>{const receipt=parseReceiptText('2x Tovagliato 2,00\n1x Birra Media 6,00\nSUBTOTALE 8,00\nTOTALE EUR 8,00\n清炒白菜 28.00\n小计 28.00\n实收 28.00');expect(receipt.items.map(i=>i.name)).toEqual(['Tovagliato','Birra Media','清炒白菜']);});
  it('does not extract a price from identifiers or total-GST rows',()=>{const receipt=parseReceiptText('LOT TL 1.108.00\nChocolate 30.00\nTotalGST 0.00\nTotal Sales 30.00');expect(receipt.items.map(i=>i.name)).toEqual(['Chocolate']);});
  it('recognizes spaced Chinese labels and table quantities',()=>{const receipt=parseReceiptText('矿 泉 水 6 3.00 18.00\n应 收 452.00\n优 惠 20.00\n实 收 432.00');expect(receipt.items.map(i=>({name:i.name,quantity:i.quantity,total:i.totalPriceCents}))).toEqual([{name:'矿 泉 水',quantity:6,total:1800}]);expect(receipt.discountCents).toBe(2000);});
  it('recognizes quantity-at-price and quantity-first receipt columns',()=>{const receipt=parseReceiptText('PLAIN NAAN 11.0 @ 3.00 33.00\n2 Grilled chicken sandwich 8.50 17.00');expect(receipt.items.map(i=>({name:i.name,quantity:i.quantity,total:i.totalPriceCents}))).toEqual([{name:'PLAIN NAAN',quantity:11,total:3300},{name:'Grilled chicken sandwich',quantity:2,total:1700}]);});
});
