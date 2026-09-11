import type { Bill } from '../types';
const KEY='fastsplit-history-cache';
export function cachedHistory():Bill[]{try{const value=JSON.parse(localStorage.getItem(KEY)||'null');return value&&Date.now()-value.savedAt<72*3600000&&Array.isArray(value.records)?value.records:[];}catch{return [];}}
export function saveHistory(records:Bill[]){try{localStorage.setItem(KEY,JSON.stringify({savedAt:Date.now(),records}));}catch{/* History remains available from the cloud. */}}
