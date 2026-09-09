import type { Bill, Receipt } from '../types';
import { getSessionId } from './sessionService';
export const apiUrl = import.meta.env.VITE_FASTSPLIT_API_URL || '';
export async function request<T>(action: string, payload: object = {}): Promise<T> {
  if (!apiUrl) throw new Error('Cloud history is not connected yet. Your draft is kept on this device.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), action === 'scanReceipt' ? 120000 : 60000);
  try {
    const response = await fetch(apiUrl, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,sessionId:getSessionId(),...payload}),redirect:'follow',signal:controller.signal,credentials:'omit'});
    if (!response.ok) throw new Error('The server is unavailable. Please try again.');
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Request failed. Please retry.');
    return result.data as T;
  } catch(error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Request timed out. Retry safely; your bill will not be saved twice.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export const api = {create:(bill: Bill) => request<Bill>('createReceipt',{data:bill}),history:() => request<Bill[]>('history'),get:(receiptId:string) => request<Bill>('getReceipt',{receiptId}),delete:(receiptId:string) => request<boolean>('deleteReceipt',{receiptId}),scan:(image:string,mimeType:string) => request<Receipt>('scanReceipt',{image,mimeType})};
