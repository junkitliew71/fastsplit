import { api } from './api';
import type { Receipt } from '../types';
export async function scanReceipt(file: File): Promise<Receipt> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP receipt.');
  if (file.size > 4 * 1024 * 1024) throw new Error('Choose an image smaller than 4 MB.');
  const image = await new Promise<string>((resolve,reject) => {const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error('Unable to read image.')); reader.readAsDataURL(file);});
  return api.scan(image,file.type);
}
export function demoReceipt(): Receipt {
  return {restaurant:'Sushi House · Demo',items:[{id:crypto.randomUUID(),name:'Salmon sushi',quantity:2,unitPriceCents:800,totalPriceCents:1600},{id:crypto.randomUUID(),name:'Chicken ramen',quantity:1,unitPriceCents:1800,totalPriceCents:1800},{id:crypto.randomUUID(),name:'Iced green tea',quantity:3,unitPriceCents:300,totalPriceCents:900}],serviceChargeCents:430,taxCents:258,discountCents:0};
}
