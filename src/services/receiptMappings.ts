import type { ReceiptMapping } from '../types';
const key='fastsplit-receipt-mappings';
export function saveReceiptMapping(mapping:ReceiptMapping) { const all=loadReceiptMappings().filter(item=>item.receiptId!==mapping.receiptId); all.unshift(mapping); localStorage.setItem(key,JSON.stringify(all.slice(0,100))); }
export function loadReceiptMappings():ReceiptMapping[] { try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];} }
export function exportReceiptMappings() { return JSON.stringify(loadReceiptMappings(),null,2); }
