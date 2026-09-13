import type { OcrToken, Receipt } from '../types';

export type ScanProgress = (message: string) => void;
export type ScannedReceipt = Receipt & { ocrTokens: OcrToken[]; imageWidth:number; imageHeight:number };
const apiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export function validateReceiptImage(file: File) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP receipt. For HEIC photos, export as JPG first.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  if (!file.size) throw new Error('This image is empty. Choose another photo.');
}

/** Lightweight upload optimization only; recognition and image enhancement run on the server. */
export async function prepareReceiptImage(file: File): Promise<Blob> {
  validateReceiptImage(file);
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const url=URL.createObjectURL(file);
  try {
    const image=new Image(); image.src=url;
    try { await image.decode(); } catch { throw new Error('This image cannot be opened. Export it as JPG and try again.'); }
    const maxSide=2400, scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d'); if(!context) throw new Error('Image compression is unavailable in this browser.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Unable to prepare this photo.')),'image/jpeg',.9));
  } finally { URL.revokeObjectURL(url); }
}

type ScanResponse={success:boolean; imageWidth:number; imageHeight:number; ocrBlocks:{text:string;confidence:number;source?:string;textType?:'printed'|'handwritten'|'unknown';polygon?:number[][];candidates?:{text:string;confidence:number;source:string}[];x:number;y:number;width:number;height:number}[]; items:{name:string;quantity:number;unitPrice:number;totalPrice:number;confidence?:number;needsReview?:boolean}[]; restaurant?:string; subtotal?:number|null; serviceCharge?:number|null; tax?:number|null; discount?:number|null; rounding?:number|null; grandTotal?:number|null; warning?:string; error?:{code:string;message:string}};
function errorMessage(status:number, payload?:ScanResponse) { const code=payload?.error?.code; if(code==='LOW_IMAGE_QUALITY') return payload?.error?.message||'This receipt photo is too blurry. Please retake it.'; if(code==='NO_TEXT_FOUND') return 'No readable receipt text was found. Try a clearer photo.'; if(code==='INVALID_IMAGE') return 'That file is not a supported receipt image.'; if(code==='IMAGE_TOO_LARGE') return 'This image is too large to scan. Choose a smaller photo.'; if(code==='SERVER_BUSY') return 'The receipt scanner is busy. Please try again shortly.'; if(status===0) return 'Unable to reach the receipt scanner. Check your connection and try again.'; return payload?.error?.message || 'Unable to scan this receipt. Please try again.'; }
const cents=(value:number|null|undefined)=>value==null?0:Math.round(value*100);
export async function scanReceipt(file:File, progress:ScanProgress=()=>{}):Promise<ScannedReceipt> {
  progress('Preparing upload…'); const image=await prepareReceiptImage(file);
  progress('Uploading receipt…'); const form=new FormData(); form.append('image',image,file.name.replace(/\.[^.]+$/,'')+'.jpg');
  let response:Response;
  try { response=await fetch(`${apiBase}/api/receipt/scan`,{method:'POST',body:form,signal:AbortSignal.timeout(90_000)}); } catch { throw new Error(errorMessage(0)); }
  const payload=await response.json().catch(()=>undefined) as ScanResponse|undefined;
  if(!response.ok||!payload?.success) throw new Error(errorMessage(response.status,payload));
  progress('Organizing items…');
  const items=payload.items.map((item,index)=>({id:`server_item_${index+1}`,name:item.name,quantity:item.quantity||1,unitPriceCents:cents(item.unitPrice),totalPriceCents:cents(item.totalPrice),confidence:item.confidence,needsReview:item.needsReview}));
  const calculated=items.reduce((sum,item)=>sum+item.totalPriceCents,0)+cents(payload.serviceCharge)+cents(payload.tax)+cents(payload.rounding)-cents(payload.discount);
  const printedTotal=payload.grandTotal==null?null:cents(payload.grandTotal);
  const totalsMatch=printedTotal===null||Math.abs(calculated-printedTotal)<=2;
  const receipt:ScannedReceipt={restaurant:payload.restaurant||'',items,serviceChargeCents:cents(payload.serviceCharge),taxCents:cents(payload.tax),discountCents:cents(payload.discount),roundingCents:cents(payload.rounding),printedSubtotalCents:payload.subtotal==null?null:cents(payload.subtotal),printedTotalCents:printedTotal,receiptNeedsReview:!totalsMatch||items.some(item=>item.needsReview),scanWarning:payload.warning||(!totalsMatch?'Please check the detected items before continuing.':'OCR complete. Review and map the receipt text.'),ocrTokens:payload.ocrBlocks.map((block,index)=>({id:`token_${index+1}`,text:block.text,confidence:block.confidence,source:block.source,textType:block.textType,polygon:block.polygon,candidates:block.candidates,bbox:{x:block.x,y:block.y,width:block.width,height:block.height}})),imageWidth:payload.imageWidth,imageHeight:payload.imageHeight};
  progress('Done'); return receipt;
}
export function demoReceipt():Receipt { return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0}; }
