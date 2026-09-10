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
});
