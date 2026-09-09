import { describe, it, expect } from 'vitest';
import { prepareReceiptImage, validateReceiptImage } from '../src/services/receiptScanner';
describe('Receipt image input',()=>{
  it('accepts large supported photos for preprocessing',()=>{expect(()=>validateReceiptImage(new File([new Uint8Array(5*1024*1024)],'receipt.jpg',{type:'image/jpeg'}))).not.toThrow();});
  it('keeps small images unchanged to preserve fine print',async()=>{const file=new File(['image'],'receipt.png',{type:'image/png'});expect(await prepareReceiptImage(file)).toBe(file);});
  it('gives actionable errors for unsupported and empty photos',()=>{expect(()=>validateReceiptImage(new File(['image'],'receipt.heic',{type:'image/heic'}))).toThrow('export as JPG');expect(()=>validateReceiptImage(new File([],'receipt.png',{type:'image/png'}))).toThrow('empty');});
});
