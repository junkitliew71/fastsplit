import type { Bill } from '../types';
const KEY = 'fastsplit-pending-receipts';
export type PendingBill = Bill & { syncStatus: 'pending' };
function read(): PendingBill[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function pendingReceipts() { return read().filter(bill => Date.parse(bill.expiresAt || new Date(Date.now() + 72 * 3600000).toISOString()) > Date.now()); }
export function queueReceipt(bill: Bill) { const next = read().filter(entry => entry.requestId !== bill.requestId); next.push({ ...bill, syncStatus: 'pending' }); localStorage.setItem(KEY, JSON.stringify(next)); }
export function removePending(requestId: string) { localStorage.setItem(KEY, JSON.stringify(read().filter(entry => entry.requestId !== requestId))); }
