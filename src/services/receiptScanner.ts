import type { Receipt, ReceiptItem } from '../types';

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
    const cropWidth = right - left, cropHeight = bottom - top; const scale = Math.min(3, 3000 / Math.max(cropWidth, cropHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(cropWidth * scale)); canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height); const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) { const lum = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114; const value = Math.max(0, Math.min(255, (lum - 128) * 1.65 + 128)); pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value; }
    context.putImageData(pixels, 0, 0); return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to prepare this photo.')), 'image/jpeg', .9));
  } finally { URL.revokeObjectURL(url); }
}
// Do not extract a price from the tail end of an identifier such as `1.108.00`.
const amount = /(?:RM|MYR)?\s*((?<![\d.,])[0-9]{1,5}(?:[,.][0-9]{2})(?![\d.,]))/ig;
// Totals, payment, and receipt metadata sometimes appear as normal price rows.
// Keep these out of the item list, including common OCR variants and non-English labels.
const summary = /(sub\s*(?:total|ttl)|subtotale|grand\s*total|total\s*(?:sales|qty|gst)?|amount\s*due|cash|change|balance|rounding|visa|mastercard|card|tng|thank\s*you|tel(?:ephone)?|table|receipt|invoice)|小计|合计|总计|总额|应收|实收|金额/i;
const printedTotalLine = /(grand\s*total|total(?:e|\s*(?:eur|sales))?|amount\s*due|balance)|合计|总计|总额|应收|实收|实收金额/i;
const charge = /(service(?:\s*charge)?|svc|sst|tax|gst|discount|rebate|sconto)|服务费|税|优惠|折扣/i;
const toCents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
function receiptItem(name: string, quantity: number, total: number): ReceiptItem | null { const clean = name.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim().slice(0, 100); if (!clean || !Number.isSafeInteger(total) || total < 0 || quantity < 1 || quantity > 50) return null; if (total % quantity) return { id: crypto.randomUUID(), name: clean, quantity: 1, unitPriceCents: total, totalPriceCents: total }; return { id: crypto.randomUUID(), name: clean, quantity, unitPriceCents: total / quantity, totalPriceCents: total }; }
/** Conservative parser: only lines with both a readable name and amount become items. */
export function parseReceiptText(text: string): Receipt {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean); const items: ReceiptItem[] = []; let serviceChargeCents = 0, taxCents = 0, discountCents = 0, printedTotal: number | null = null, restaurant = '';
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ''); const values = [...line.matchAll(amount)].map(match => toCents(match[1])); if (!restaurant && /\p{L}{3,}/u.test(line) && !values.length && line.length <= 70 && !summary.test(normalized)) restaurant = line; if (!values.length) continue;
    const total = values[values.length - 1]; if (printedTotalLine.test(normalized)) { printedTotal = total; continue; }
    if (charge.test(normalized)) { if (/discount|rebate|sconto|优惠|折扣/i.test(normalized)) discountCents += total; else if (/service|svc|服务费/i.test(normalized)) serviceChargeCents += total; else taxCents += total; continue; }
    if (summary.test(normalized)) continue; let name = line.slice(0, line.search(amount)).replace(/^\s*\d{1,2}\s*[x×]\s*/i, '').trim(); const leadingQuantity = line.match(/^\s*(\d{1,2})\s*[x×]\s*/i); const columnQuantity = !leadingQuantity && values.length > 1 ? line.match(/^\s*(\d{1,2})(?:\.0+)?\s+(?=\p{L})/u) : null; const atQuantity = !leadingQuantity && values.length > 1 ? line.match(/\s(\d{1,2})(?:\.0+)?\s*@/) : null; const trailingQuantity = !leadingQuantity && !columnQuantity && !atQuantity && values.length > 1 ? name.match(/\s(\d{1,2})$/) : null; if (columnQuantity) name = name.replace(/^\s*\d{1,2}(?:\.0+)?\s+/, ''); if (atQuantity) name = name.replace(/\s\d{1,2}(?:\.0+)?\s*@\s*$/, ''); if (trailingQuantity) name = name.slice(0, -trailingQuantity[0].length).trim(); const quantity = leadingQuantity || columnQuantity || atQuantity || trailingQuantity; const parsed = receiptItem(name, quantity ? Number(quantity[1]) : 1, total); if (parsed) items.push(parsed);
  }
  const calculated = items.reduce((sum, value) => sum + value.totalPriceCents, 0) + serviceChargeCents + taxCents - discountCents; const warnings = ['Please check the detected items before continuing.']; if (!items.length) warnings.push('No priced item lines were certain enough to add. Enter the receipt manually.'); if (printedTotal !== null && calculated !== printedTotal) warnings.push(`Detected entries add up to ${(calculated / 100).toFixed(2)}, while the printed total is ${(printedTotal / 100).toFixed(2)}. Check every amount.`);
  return { restaurant: restaurant || 'Receipt', items, serviceChargeCents, taxCents, discountCents, scanWarning: warnings.join(' ') };
}
// Resolve from the document URL so Vite's relative base (`./`) remains inside
// the GitHub Pages project path (for example, `/fastsplit/ocr/...`).
const asset = (path: string) => new URL(`${import.meta.env.BASE_URL}ocr/${path}`, document.baseURI).toString();
export async function scanReceipt(file: File, progress: ScanProgress = () => {}): Promise<Receipt> {
  progress('Preparing image locally…'); const prepared = await prepareReceiptImage(file); progress('Loading local OCR…'); const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { workerPath: asset('worker.min.js'), corePath: asset('tesseract-core-simd-lstm.wasm.js'), langPath: asset('data'), logger: message => { if (message.status === 'recognizing text') progress(`Reading receipt locally… ${Math.round((message.progress || 0) * 100)}%`); } });
  try { await worker.setParameters({ tessedit_pageseg_mode: '4' }); progress('Extracting receipt text…'); const result = await worker.recognize(prepared); return parseReceiptText(result.data.text); } finally { await worker.terminate(); }
}
export function demoReceipt(): Receipt { return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0}; }
