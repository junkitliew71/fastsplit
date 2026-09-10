import type { ReceiptItem } from '../types';
import { moneyValues } from './malaysiaCurrency';
import { isColumnHeader } from './restaurantReceiptSemantics';

export interface OcrWord { text: string; confidence: number; x: number; y: number; width: number; height: number }
export interface ReceiptRow { words: OcrWord[]; text: string; confidence: number; y: number }
export interface ReceiptLayout { words: OcrWord[]; rows: ReceiptRow[]; width: number; height: number; text: string }

export function layoutFromTsv(tsv: string): ReceiptLayout {
  const words: OcrWord[] = tsv.split('\n').slice(1).flatMap(row => {
    const cells = row.split('\t'); if (cells[0] !== '5' || !cells[11]?.trim()) return [];
    const x = Number(cells[6]), y = Number(cells[7]), width = Number(cells[8]), height = Number(cells[9]), confidence = Number(cells[10]);
    return [x, y, width, height, confidence].every(Number.isFinite) ? [{ text: cells.slice(11).join('\t').trim(), confidence, x, y, width, height }] : [];
  });
  const groups: OcrWord[][] = [];
  for (const word of words.sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x)) {
    const center = word.y + word.height / 2; let best: OcrWord[] | undefined, distance = Infinity;
    for (const row of groups) { const rowCenter = row.reduce((sum, entry) => sum + entry.y + entry.height / 2, 0) / row.length; const gap = Math.abs(center - rowCenter); if (gap < distance && gap <= Math.max(8, word.height * .9)) { best = row; distance = gap; } }
    (best || (groups.push([]), groups[groups.length - 1])).push(word);
  }
  const rows = groups.map(row => { row.sort((a, b) => a.x - b.x); return { words: row, text: row.map(word => word.text).join(' '), confidence: row.reduce((sum, word) => sum + word.confidence, 0) / row.length, y: row.reduce((sum, word) => sum + word.y, 0) / row.length }; }).sort((a, b) => a.y - b.y);
  return { words, rows, width: Math.max(0, ...words.map(word => word.x + word.width)), height: Math.max(0, ...words.map(word => word.y + word.height)), text: rows.map(row => row.text).join('\n') };
}

type Anchors = { quantity?: number; description?: number; unitPrice?: number; lineTotal?: number };
const center = (word: OcrWord) => word.x + word.width / 2;
function tableAnchors(row: ReceiptRow): Anchors {
  const anchors: Anchors = {};
  row.words.forEach(word => { const label = word.text.replace(/[^a-z]/gi, '').toLowerCase(); if (/^(qty|quantity)$/.test(label)) anchors.quantity = center(word); else if (/^(item|description|product|menu|details)$/.test(label)) anchors.description = center(word); else if (/^(price|rate)$/.test(label)) anchors.unitPrice = center(word); else if (/^(total|amount)$/.test(label)) anchors.lineTotal = center(word); });
  if (anchors.unitPrice !== undefined && anchors.lineTotal === undefined) anchors.lineTotal = anchors.unitPrice;
  return anchors;
}
function numericWord(word: OcrWord) { return /^\d{1,2}$/.test(word.text) ? Number(word.text) : null; }
function closest<T extends OcrWord>(words: T[], x: number | undefined) { return x === undefined || !words.length ? undefined : words.reduce((best, word) => Math.abs(center(word) - x) < Math.abs(center(best) - x) ? word : best); }

export function itemsFromLayout(layout: ReceiptLayout): ReceiptItem[] {
  const headerIndex = layout.rows.findIndex(row => isColumnHeader(row.text)); if (headerIndex < 0) return [];
  const anchors = tableAnchors(layout.rows[headerIndex]); const tolerance = Math.max(45, layout.width * .15); const items: ReceiptItem[] = [];
  for (const row of layout.rows.slice(headerIndex + 1)) {
    if (/\b(?:sub\s*total|total\s*amount|grand\s*total|bill\s*rounding|balance|cash|change)\b/i.test(row.text)) break;
    const numberWords = row.words.filter(word => numericWord(word) !== null); const moneyWords = row.words.filter(word => moneyValues(word.text).length);
    if (!moneyWords.length) continue;
    let quantityWord = closest(numberWords, anchors.quantity); if (quantityWord && anchors.quantity !== undefined && Math.abs(center(quantityWord) - anchors.quantity) > tolerance) quantityWord = undefined;
    if (!quantityWord && anchors.quantity === undefined) quantityWord = numberWords[0];
    const totalWord = closest(moneyWords, anchors.lineTotal) || moneyWords[moneyWords.length - 1];
    const unitWord = closest(moneyWords.filter(word => word !== totalWord), anchors.unitPrice);
    const quantity = quantityWord ? numericWord(quantityWord)! : 1, total = moneyValues(totalWord.text).at(-1)!;
    const unitPrice = unitWord ? moneyValues(unitWord.text).at(-1)! : (total % quantity === 0 ? total / quantity : total);
    const descriptionStart = anchors.description ?? (quantityWord ? center(quantityWord) : 0);
    const firstNumericColumn = Math.min(...[anchors.unitPrice, anchors.quantity !== undefined && anchors.quantity > descriptionStart ? anchors.quantity : undefined, anchors.lineTotal].filter((value): value is number => value !== undefined && value > descriptionStart));
    const description = row.words.filter(word => center(word) >= descriptionStart - tolerance * .5 && center(word) < firstNumericColumn - 8 && word !== quantityWord && !moneyWords.includes(word)).map(word => word.text).join(' ').replace(/\s+[TD]$/i, '').trim();
    if (!description || quantity < 1 || quantity > 50) continue;
    const confidence = Math.max(0, Math.min(1, row.words.reduce((sum, word) => sum + word.confidence, 0) / row.words.length / 100));
    const mathValid = Math.abs(quantity * unitPrice - total) <= 2;
    items.push({ id: crypto.randomUUID(), name: description.slice(0, 100), quantity, unitPriceCents: unitPrice, totalPriceCents: total, confidence, needsReview: confidence < .6 || !mathValid });
  }
  return items;
}
