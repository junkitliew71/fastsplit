import type { Receipt, ReceiptItem } from '../types';

export type ScanProgress = (message: string) => void;
export function validateReceiptImage(file: File) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP receipt. For HEIC photos, export as JPG first.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  if (!file.size) throw new Error('This image is empty. Choose another photo.');
}
/** Resize and improve contrast entirely on-device before OCR. */
export async function prepareReceiptImage(file: File): Promise<Blob> {
  validateReceiptImage(file); if (file.size <= 4 * 1024 * 1024) return file; const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('This image cannot be opened. Export it as JPG and try again.'); }
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height); const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) { const lum = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114; const value = Math.max(0, Math.min(255, (lum - 128) * 1.25 + 128)); pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value; }
    context.putImageData(pixels, 0, 0); return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to prepare this photo.')), 'image/jpeg', .9));
  } finally { URL.revokeObjectURL(url); }
}
const amount = /(?:RM|MYR)?\s*([0-9]{1,5}(?:[,.][0-9]{2}))/ig;
const ignored = /\b(sub\s*(?:total|ttl)|grand\s*total|total|amount\s*due|cash|change|balance|rounding|visa|mastercard|card|tng|thank\s*you|tel(?:ephone)?|table|receipt|invoice)\b/i;
const charge = /\b(service(?:\s*charge)?|svc|sst|tax|gst|discount|rebate)\b/i;
const toCents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
function receiptItem(name: string, quantity: number, total: number): ReceiptItem | null { const clean = name.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+/, '').trim().slice(0, 100); if (!clean || !Number.isSafeInteger(total) || total < 0 || quantity < 1 || quantity > 50) return null; if (total % quantity) return { id: crypto.randomUUID(), name: clean, quantity: 1, unitPriceCents: total, totalPriceCents: total }; return { id: crypto.randomUUID(), name: clean, quantity, unitPriceCents: total / quantity, totalPriceCents: total }; }
/** Conservative parser: only lines with both a readable name and amount become items. */
export function parseReceiptText(text: string): Receipt {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean); const items: ReceiptItem[] = []; let serviceChargeCents = 0, taxCents = 0, discountCents = 0, printedTotal: number | null = null, restaurant = '';
  for (const line of lines) {
    const values = [...line.matchAll(amount)].map(match => toCents(match[1])); if (!restaurant && /[A-Za-z]{3,}/.test(line) && !values.length && line.length <= 70 && !ignored.test(line)) restaurant = line; if (!values.length) continue;
    const total = values[values.length - 1]; if (/\b(grand\s*total|total|amount\s*due|balance)\b/i.test(line)) { printedTotal = total; continue; }
    if (charge.test(line)) { if (/discount|rebate/i.test(line)) discountCents += total; else if (/service|svc/i.test(line)) serviceChargeCents += total; else taxCents += total; continue; }
    if (ignored.test(line)) continue; const name = line.slice(0, line.search(amount)).replace(/^\s*\d{1,2}\s*[x×]\s*/i, '').trim(); const q = line.match(/^\s*(\d{1,2})\s*[x×]\s*/i); const parsed = receiptItem(name, q ? Number(q[1]) : 1, total); if (parsed) items.push(parsed);
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
  try { progress('Extracting receipt text…'); const result = await worker.recognize(prepared); return parseReceiptText(result.data.text); } finally { await worker.terminate(); }
}
export function demoReceipt(): Receipt { return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0}; }
