import type { Receipt } from '../types';
import { parseMalaysiaReceiptText } from '../receipt-malaysia/receiptParser';

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
export const parseReceiptText = parseMalaysiaReceiptText;
type OcrWord = { text: string; left: number; top: number; width: number; height: number };
/** PSM 11 finds receipt columns well, but emits each cell on a separate text
 * line. Rebuild visual rows from TSV word coordinates before semantic parsing. */
export function receiptRowsFromTsv(tsv: string): string {
  const words: OcrWord[] = tsv.split('\n').slice(1).flatMap(row => {
    const cells = row.split('\t');
    if (cells[0] !== '5' || !cells[11]?.trim()) return [];
    const left = Number(cells[6]), top = Number(cells[7]), width = Number(cells[8]), height = Number(cells[9]);
    return Number.isFinite(left + top + width + height) ? [{ text: cells.slice(11).join('\t').trim(), left, top, width, height }] : [];
  });
  const rows: OcrWord[][] = [];
  for (const word of words.sort((a, b) => (a.top + a.height / 2) - (b.top + b.height / 2) || a.left - b.left)) {
    const center = word.top + word.height / 2;
    let best: OcrWord[] | undefined, distance = Infinity;
    for (const row of rows) { const rowCenter = row.reduce((sum, entry) => sum + entry.top + entry.height / 2, 0) / row.length; const gap = Math.abs(center - rowCenter); if (gap < distance && gap <= Math.max(8, word.height * .9)) { best = row; distance = gap; } }
    (best || (rows.push([]), rows[rows.length - 1])).push(word);
  }
  return rows.sort((a, b) => Math.min(...a.map(word => word.top)) - Math.min(...b.map(word => word.top))).map(row => row.sort((a, b) => a.left - b.left).map(word => word.text).join(' ')).join('\n');
}
function scanQuality(receipt: Receipt) {
  const mismatch = receipt.scanWarning?.match(/add up to ([\d.]+), while the printed total is ([\d.]+)/);
  const difference = mismatch ? Math.abs(Number(mismatch[1]) - Number(mismatch[2])) : 0;
  return receipt.items.length * 10 - difference - (receipt.items.length ? 0 : 100);
}
// Resolve from the document URL so Vite's relative base (`./`) remains inside
// the GitHub Pages project path (for example, `/fastsplit/ocr/...`).
const asset = (path: string) => new URL(`${import.meta.env.BASE_URL}ocr/${path}`, document.baseURI).toString();
export async function scanReceipt(file: File, progress: ScanProgress = () => {}): Promise<Receipt> {
  progress('Preparing image locally…'); const prepared = await prepareReceiptImage(file); progress('Loading local OCR…'); const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { workerPath: asset('worker.min.js'), corePath: asset('tesseract-core-simd-lstm.wasm.js'), langPath: asset('data'), logger: message => { if (message.status === 'recognizing text') progress(`Reading receipt locally… ${Math.round((message.progress || 0) * 100)}%`); } });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' as Tesseract.PSM, preserve_interword_spaces: '1' }); progress('Extracting receipt rows…');
    const sparse = await worker.recognize(prepared, {}, { text: true, tsv: true });
    const reconstructed = receiptRowsFromTsv(sparse.data.tsv || ''); const primary = parseReceiptText(reconstructed || sparse.data.text);
    if (primary.items.length >= 2 && !primary.scanWarning?.includes('while the printed total')) return primary;
    progress('Checking receipt table…'); await worker.setParameters({ tessedit_pageseg_mode: '6' as Tesseract.PSM, preserve_interword_spaces: '1' });
    const block = parseReceiptText((await worker.recognize(prepared)).data.text);
    return scanQuality(block) > scanQuality(primary) ? block : primary;
  } finally { await worker.terminate(); }
}
export function demoReceipt(): Receipt { return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0}; }
