import type { Receipt } from '../types';
import { parseMalaysiaReceiptText } from '../receipt-malaysia/receiptParser';
import { classifyReceiptRow, itemsFromLayout, layoutFromTsv, receiptColumns } from '../receipt-malaysia/receiptLayout';
import { validateReceiptTotal } from '../receipt-malaysia/receiptValidator';

export type ScanProgress = (message: string) => void;
export function validateReceiptImage(file: File) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP receipt. For HEIC photos, export as JPG first.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  if (!file.size) throw new Error('This image is empty. Choose another photo.');
}
/** Enlarge and improve contrast entirely on-device before OCR. */
export async function prepareReceiptImage(file: File): Promise<Blob> {
  validateReceiptImage(file);
  // Keep tiny images untouched (and avoid decoding placeholder/test files), but
  // upscale ordinary phone photos so narrow receipt lettering survives OCR.
  if (file.size <= 100 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('This image cannot be opened. Export it as JPG and try again.'); }
    const source = document.createElement('canvas'); source.width = image.naturalWidth; source.height = image.naturalHeight; const sourceContext = source.getContext('2d', { willReadFrequently: true }); if (!sourceContext) throw new Error('Image processing is unavailable in this browser.'); sourceContext.drawImage(image, 0, 0);
    const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height).data; const isLight = (x: number, y: number) => { const index = (y * source.width + x) * 4; return sourcePixels[index] * .299 + sourcePixels[index + 1] * .587 + sourcePixels[index + 2] * .114 > 190; };
    let left = 0, right = source.width, top = 0, bottom = source.height; const minimumColumn = Math.max(8, Math.floor(source.height * .25)), minimumRow = Math.max(8, Math.floor(source.width * .12)); const columnLight = (x: number) => { let count = 0; for (let y = 0; y < source.height; y += 4) if (isLight(x, y)) count++; return count * 4; }; const rowLight = (y: number) => { let count = 0; for (let x = 0; x < source.width; x += 4) if (isLight(x, y)) count++; return count * 4; };
    while (left < source.width && columnLight(left) < minimumColumn) left += 4; while (right > left && columnLight(right - 1) < minimumColumn) right -= 4; while (top < source.height && rowLight(top) < minimumRow) top += 4; while (bottom > top && rowLight(bottom - 1) < minimumRow) bottom -= 4; const padding = 16; left = Math.max(0, left - padding); right = Math.min(source.width, right + padding); top = Math.max(0, top - padding); bottom = Math.min(source.height, bottom + padding);
    const cropWidth = right - left, cropHeight = bottom - top;
    // Estimate paper edges on many scanlines. Median filtering rejects hands,
    // cutlery and highlights; interpolating the edge pairs rectifies the common
    // trapezoid perspective created by phone cameras.
    const spans: { y:number; left:number; right:number; width:number }[] = [];
    for (let y=top;y<bottom;y+=Math.max(2,Math.floor(cropHeight/180))) {let run=-1,bestLeft=-1,bestRight=-1;for(let x=left;x<right;x+=2){if(isLight(x,y)){if(run<0)run=x;}else if(run>=0){if(x-run>bestRight-bestLeft){bestLeft=run;bestRight=x;}run=-1;}}if(run>=0&&right-run>bestRight-bestLeft){bestLeft=run;bestRight=right;}if(bestRight-bestLeft>cropWidth*.25)spans.push({y,left:bestLeft,right:bestRight,width:bestRight-bestLeft});}
    const median=(numbers:number[])=>{const sorted=[...numbers].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0;},medianWidth=median(spans.map(span=>span.width)),paper=spans.filter(span=>span.width>medianWidth*.72&&span.width<medianWidth*1.28),split=top+cropHeight/2,upper=paper.filter(span=>span.y<split),lower=paper.filter(span=>span.y>=split),upperLeft=median(upper.map(span=>span.left))||left,upperRight=median(upper.map(span=>span.right))||right,lowerLeft=median(lower.map(span=>span.left))||left,lowerRight=median(lower.map(span=>span.right))||right;
    const rectifiedWidth=Math.max(1,Math.round(((upperRight-upperLeft)+(lowerRight-lowerLeft))/2)),scale=Math.min(3,3000/Math.max(rectifiedWidth,cropHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(rectifiedWidth * scale)); canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Image processing is unavailable in this browser.');
    for(let dy=0;dy<canvas.height;dy++){const ratio=dy/Math.max(1,canvas.height-1),sy=top+ratio*cropHeight,sourceLeft=upperLeft+(lowerLeft-upperLeft)*ratio,sourceRight=upperRight+(lowerRight-upperRight)*ratio;context.drawImage(source,sourceLeft,sy,Math.max(1,sourceRight-sourceLeft),1,0,dy,canvas.width,1);}
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) { const lum = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114; const value = Math.max(0, Math.min(255, (lum - 128) * 1.65 + 128)); pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value; }
    context.putImageData(pixels, 0, 0); return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to prepare this photo.')), 'image/jpeg', .9));
  } finally { URL.revokeObjectURL(url); }
}
export const parseReceiptText = parseMalaysiaReceiptText;
/** PSM 11 finds receipt columns well, but emits each cell on a separate text
 * line. Rebuild visual rows from TSV word coordinates before semantic parsing. */
export function receiptRowsFromTsv(tsv: string): string {
  return layoutFromTsv(tsv).text;
}
export function parseReceiptTsv(tsv: string): Receipt {
  const layout = layoutFromTsv(tsv), semantic = parseReceiptText(layout.text), layoutItems = itemsFromLayout(layout);
  const items = layoutItems.length ? layoutItems : semantic.items;
  const calculated = items.reduce((sum, item) => sum + item.totalPriceCents, 0) + semantic.serviceChargeCents + semantic.taxCents - semantic.discountCents;
  const totalsMatch = validateReceiptTotal(calculated, semantic.printedTotalCents ?? null);
  const reviewedItems = totalsMatch ? items : items.map(item => ({ ...item, needsReview: true }));
  const warnings = ['Please check the detected items before continuing.'];
  if (!reviewedItems.length) warnings.push('No priced item rows were certain enough to add. Enter the receipt manually.');
  if (!totalsMatch) warnings.push(`Detected entries add up to ${(calculated / 100).toFixed(2)}, while the printed total is ${((semantic.printedTotalCents || 0) / 100).toFixed(2)}. Low-confidence entries are marked for review.`);
  return { ...semantic, items: reviewedItems, receiptNeedsReview: !totalsMatch || reviewedItems.some(item => item.needsReview), scanWarning: warnings.join(' ') };
}
function scanQuality(receipt: Receipt) {
  const calculated=receipt.items.reduce((sum,item)=>sum+item.totalPriceCents,0)+receipt.serviceChargeCents+receipt.taxCents-receipt.discountCents;
  const difference=receipt.printedTotalCents===null||receipt.printedTotalCents===undefined?null:Math.abs(calculated-receipt.printedTotalCents)/100;
  const average=receipt.items.reduce((sum,item)=>sum+(item.confidence??.5),0)/Math.max(1,receipt.items.length),review=receipt.items.filter(item=>item.needsReview).length;
  return receipt.items.length*4+average*10-review*2-(difference??0)*4+(difference!==null&&difference<=.02?30:0)-(receipt.items.length?0:100);
}
export interface OcrDebugPass { mode:string; rawText:string; words:ReturnType<typeof layoutFromTsv>['words']; rows:ReturnType<typeof layoutFromTsv>['rows']; imageWidth:number; imageHeight:number; columns:ReturnType<typeof receiptColumns>; classifications:string[]; items:Receipt['items']; score:number }
export interface OcrDebugSnapshot { originalImageUrl:string; preprocessedImageUrl:string; passes:OcrDebugPass[]; finalItems:Receipt['items']; finalReceipt:Receipt }
declare global { interface Window { __fastSplitOcrDebug?:OcrDebugSnapshot } }
const debugEnabled=()=>typeof location!=='undefined'&&new URLSearchParams(location.search).get('ocrDebug')==='1';
function debugPass(mode:string,rawText:string,tsv:string,receipt:Receipt):OcrDebugPass {const layout=layoutFromTsv(tsv),page=tsv.split('\n').map(row=>row.split('\t')).find(cells=>cells[0]==='1');return{mode,rawText,words:layout.words,rows:layout.rows,imageWidth:Number(page?.[8])||layout.width,imageHeight:Number(page?.[9])||layout.height,columns:receiptColumns(layout),classifications:layout.rows.map(classifyReceiptRow),items:receipt.items,score:scanQuality(receipt)};}
// Resolve from the document URL so Vite's relative base (`./`) remains inside
// the GitHub Pages project path (for example, `/fastsplit/ocr/...`).
const asset = (path: string) => new URL(`${import.meta.env.BASE_URL}ocr/${path}`, document.baseURI).toString();
export async function scanReceipt(file: File, progress: ScanProgress = () => {}): Promise<Receipt> {
  progress('Preparing image locally…'); const prepared = await prepareReceiptImage(file); progress('Loading local OCR…'); const { createWorker } = await import('tesseract.js');
  const debug=debugEnabled(),passes:OcrDebugPass[]=[],originalImageUrl=debug?URL.createObjectURL(file):'',preprocessedImageUrl=debug?URL.createObjectURL(prepared):'';
  const worker = await createWorker(['eng','chi_sim','chi_tra'], 1, { workerPath: asset('worker.min.js'), corePath: asset('tesseract-core-simd-lstm.wasm.js'), langPath: asset('data'), logger: message => { if (message.status === 'recognizing text') progress(`Reading receipt locally… ${Math.round((message.progress || 0) * 100)}%`); } });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' as Tesseract.PSM, preserve_interword_spaces: '1' }); progress('Extracting receipt rows…');
    const sparse = await worker.recognize(prepared, {}, { text: true, tsv: true });
    const primary = sparse.data.tsv ? parseReceiptTsv(sparse.data.tsv) : parseReceiptText(sparse.data.text);
    if(debug&&sparse.data.tsv)passes.push(debugPass('PSM 11 sparse',sparse.data.text,sparse.data.tsv,primary));let selected=primary;
    if(primary.items.length<2||primary.scanWarning?.includes('while the printed total')){progress('Checking receipt table…');await worker.setParameters({tessedit_pageseg_mode:'6' as Tesseract.PSM,preserve_interword_spaces:'1'});const blockResult=await worker.recognize(prepared,{},{text:true,tsv:true}),block=blockResult.data.tsv?parseReceiptTsv(blockResult.data.tsv):parseReceiptText(blockResult.data.text);if(debug&&blockResult.data.tsv)passes.push(debugPass('PSM 6 block',blockResult.data.text,blockResult.data.tsv,block));if(scanQuality(block)>scanQuality(primary))selected=block;}
    if(debug){window.__fastSplitOcrDebug={originalImageUrl,preprocessedImageUrl,passes,finalItems:selected.items,finalReceipt:selected};console.info('FastSplit OCR debug: window.__fastSplitOcrDebug',window.__fastSplitOcrDebug);const{renderOcrDebugPanel}=await import('./ocrDebugPanel');renderOcrDebugPanel(window.__fastSplitOcrDebug);}
    return selected;
  } finally { await worker.terminate(); }
}
export function demoReceipt(): Receipt { return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0}; }
