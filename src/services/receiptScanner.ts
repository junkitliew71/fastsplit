import type { OcrToken, Receipt } from '../types';

export type ScanProgress = (message: string) => void;
export type ScannedReceipt = Receipt & { ocrTokens: OcrToken[]; imageWidth:number; imageHeight:number };
const localHost=['localhost','127.0.0.1'].includes(location.hostname);
const apiBase = (import.meta.env.VITE_API_BASE_URL || (localHost?'http://localhost:8000':'')).replace(/\/$/, '');
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

export interface ServerReceiptScanResponse {
  success:boolean;
  schemaVersion?:number;
  extractionStatus?:'complete'|'needs_manual_mapping';
  imageWidth:number;
  imageHeight:number;
  ocrBlocks:{text:string;confidence:number;source?:string;textType?:'printed'|'handwritten'|'unknown';polygon?:number[][];candidates?:{text:string;confidence:number;source:string}[];x:number;y:number;width:number;height:number}[];
  items:{name:string;quantity:number;unitPrice:number;totalPrice:number;confidence?:number;needsReview?:boolean}[];
  restaurant?:string;
  subtotal?:number|null;serviceCharge?:number|null;tax?:number|null;discount?:number|null;rounding?:number|null;grandTotal?:number|null;
  warning?:string;
  error?:{code:string;message:string};
}
type ScanResponse=ServerReceiptScanResponse;
function errorMessage(status:number, payload?:ScanResponse) { const code=payload?.error?.code; if(code==='LOW_IMAGE_QUALITY') return payload?.error?.message||'This receipt photo is too blurry. Please retake it.'; if(code==='NO_TEXT_FOUND') return 'No readable receipt text was found. Try a clearer photo.'; if(code==='INVALID_IMAGE') return 'That file is not a supported receipt image.'; if(code==='IMAGE_TOO_LARGE') return 'This image is too large to scan. Choose a smaller photo.'; if(code==='SERVER_BUSY') return 'The receipt scanner is busy. Please try again shortly.'; if(status===0) return 'Unable to reach the receipt scanner. Check your connection and try again.'; return payload?.error?.message || 'Unable to scan this receipt. Please try again.'; }
const cents=(value:number|null|undefined)=>value==null?0:Math.round(value*100);
function diagnostic(stage:string, details:unknown) { if(import.meta.env.DEV) console.info(`[FastSplit scan] ${stage}`,details); }
function validateResponse(value:unknown): value is ScanResponse {
  if(!value || typeof value!=='object') return false;
  const p=value as ScanResponse;
  return p.success===true && Number.isFinite(p.imageWidth) && p.imageWidth>0 && Number.isFinite(p.imageHeight) && p.imageHeight>0
    && Array.isArray(p.ocrBlocks) && p.ocrBlocks.every(b=>b && typeof b.text==='string' && [b.confidence,b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width>0 && b.height>0)
    && Array.isArray(p.items) && p.items.every(i=>i && typeof i.name==='string' && [i.quantity,i.unitPrice,i.totalPrice].every(Number.isFinite));
}
export async function scanReceipt(file:File, progress:ScanProgress=()=>{}):Promise<ScannedReceipt> {
  if(!apiBase)throw new Error('The online receipt scanner is not configured yet.');
  progress('Preparing upload…'); const image=await prepareReceiptImage(file);
  progress('Waking receipt scanner…');
  diagnostic('API',{apiBase});
  // A failed wake-up probe must not prevent the actual upload request.
  try{const health=await fetch(`${apiBase}/health`,{signal:AbortSignal.timeout(15_000)});diagnostic('health',{status:health.status});}catch(error){diagnostic('health unavailable; attempting upload',String(error));}
  progress('Uploading receipt…'); const form=new FormData(); form.append('image',image,file.name.replace(/\.[^.]+$/,'')+'.jpg');
  let response:Response;
  try { response=await fetch(`${apiBase}/api/receipt/scan`,{method:'POST',body:form,signal:AbortSignal.timeout(180_000)}); } catch(error) { throw new Error(error instanceof DOMException && ['TimeoutError','AbortError'].includes(error.name)?'[OCR_TIMEOUT] Receipt scanning timed out. Please try again.':'[NETWORK_ERROR] Unable to reach the receipt scanner. The backend may be unavailable; please try again shortly.'); }
  const payload=await response.json().catch(()=>undefined) as ScanResponse|undefined;
  diagnostic('HTTP response',{status:response.status,keys:payload?Object.keys(payload):[]});
  if(!payload) throw new Error(response.status>=502?'[SERVER_UNAVAILABLE] The scanner server is temporarily unavailable. Please try again shortly.':'[INVALID_RESPONSE] The scanner did not return valid JSON.');
  if(!response.ok||!payload.success) throw new Error(`[${payload.error?.code || (response.status>=502?'SERVER_UNAVAILABLE':'INVALID_RESPONSE')}] ${errorMessage(response.status,payload)}`);
  if(!validateResponse(payload)) throw new Error('[INVALID_RESPONSE] The scanner returned invalid receipt data. Please try again.');
  diagnostic('response',{status:response.status,blocks:payload.ocrBlocks.length,items:payload.items.length,imageWidth:payload.imageWidth,imageHeight:payload.imageHeight,grandTotal:payload.grandTotal});
  if(!payload.ocrBlocks.length) throw new Error('[NO_TEXT_DETECTED] No readable text was found. Please retake the photo.');
  if(!payload.items.length) payload.warning='Text was detected, but items need manual mapping. Select the receipt text to add items.';
  progress('Organizing items…');
  const items=payload.items.map((item,index)=>({id:`server_item_${index+1}`,name:item.name,quantity:item.quantity||1,unitPriceCents:cents(item.unitPrice),totalPriceCents:cents(item.totalPrice),confidence:item.confidence,needsReview:item.needsReview}));
  const calculated=items.reduce((sum,item)=>sum+item.totalPriceCents,0)+cents(payload.serviceCharge)+cents(payload.tax)+cents(payload.rounding)-cents(payload.discount);
  const printedTotal=payload.grandTotal==null?null:cents(payload.grandTotal);
  const totalsMatch=printedTotal===null||Math.abs(calculated-printedTotal)<=2;
  const receipt:ScannedReceipt={restaurant:payload.restaurant||'',items,serviceChargeCents:cents(payload.serviceCharge),taxCents:cents(payload.tax),discountCents:cents(payload.discount),roundingCents:cents(payload.rounding),printedSubtotalCents:payload.subtotal==null?null:cents(payload.subtotal),printedTotalCents:printedTotal,receiptNeedsReview:!totalsMatch||items.some(item=>item.needsReview),scanWarning:payload.warning||(!totalsMatch?'Please check the detected items before continuing.':'OCR complete. Review and map the receipt text.'),ocrTokens:payload.ocrBlocks.map((block,index)=>({id:`token_${index+1}`,text:block.text,confidence:block.confidence,source:block.source,textType:block.textType,polygon:block.polygon,candidates:block.candidates,bbox:{x:block.x,y:block.y,width:block.width,height:block.height}})),imageWidth:payload.imageWidth,imageHeight:payload.imageHeight};
  if(!items.length) receipt.receiptNeedsReview=true;
  diagnostic('normalized mapping data',{tokens:receipt.ocrTokens.length,items:receipt.items.length,needsReview:receipt.receiptNeedsReview});
  progress('Done'); return receipt;
}
export function demoReceipt():Receipt { return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0}; }
