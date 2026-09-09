import { api } from './api';
import type { Receipt } from '../types';
export function validateReceiptImage(file: File) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP receipt. For HEIC photos, export as JPG first.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  if (!file.size) throw new Error('This image is empty. Choose another photo.');
}
export async function prepareReceiptImage(file: File): Promise<Blob> {
  validateReceiptImage(file);
  if (file.size <= 4 * 1024 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('This image cannot be opened. Export it as JPG and try again.'); }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.92, 0.85, 0.75]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 4 * 1024 * 1024) return blob;
    }
    throw new Error('The photo is still too large. Crop the background around the receipt and retry.');
  } finally { URL.revokeObjectURL(url); }
}
export async function scanReceipt(file: File): Promise<Receipt> {
  const prepared = await prepareReceiptImage(file);
  const image = await new Promise<string>((resolve,reject) => {const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error('Unable to read image.')); reader.readAsDataURL(prepared);});
  return api.scan(image,prepared.type);
}
export function demoReceipt(): Receipt {
  return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0};
}
