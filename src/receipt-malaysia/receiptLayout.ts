import type { ReceiptItem } from '../types';
import { moneyValues } from './malaysiaCurrency';
import { isNoiseLine } from './malaysiaIgnorePatterns';
import { discountLabels, roundingLabels, serviceLabels, subtotalLabels, taxLabels, totalLabels } from './malaysiaReceiptKeywords';
import { isColumnHeader, quantityWords } from './restaurantReceiptSemantics';

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

function clusteredAnchor(values: number[], tolerance: number, preferRight = false) {
  const clusters: number[][] = []; for (const value of values.sort((a,b)=>a-b)) { const cluster=clusters.find(group=>Math.abs(value-group.reduce((sum,n)=>sum+n,0)/group.length)<=tolerance); (cluster||(clusters.push([]),clusters[clusters.length-1])).push(value); }
  const candidates=clusters.sort((a,b)=>b.length-a.length||(preferRight?b[0]-a[0]:a[0]-b[0])),best=candidates[0]; return best?best.reduce((sum,n)=>sum+n,0)/best.length:undefined;
}
function inferredAnchors(layout: ReceiptLayout): Anchors {
  const header=layout.rows.find(row=>isColumnHeader(row.text)),fromHeader=header?tableAnchors(header):{},tolerance=Math.max(18,layout.width*.055);
  const moneyX=layout.rows.flatMap(row=>row.words.filter(word=>moneyValues(word.text).length).map(center));
  const quantityX=layout.rows.flatMap(row=>row.words.filter(word=>numericWord(word)!==null).map(center));
  return {...fromHeader,lineTotal:fromHeader.lineTotal??clusteredAnchor(moneyX,tolerance,true),quantity:fromHeader.quantity??clusteredAnchor(quantityX,tolerance)};
}
const summaryLine=(line:string)=>[subtotalLabels,totalLabels,serviceLabels,taxLabels,discountLabels,roundingLabels].some(pattern=>pattern.test(line)||pattern.test(line.replace(/\s/g,'')))||/\b(?:balance|cash|change|amount\s*due)\b/i.test(line);
const explicitQuantity=(line:string)=>Number(line.match(/(?:^|\b(?:qty|quantity)\s*:?)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:x|\*|@|pcs?|ea|units?)\b/i)?.slice(1).find(Boolean)||0)||null;
function buildItem(name:string,quantity:number,unitPrice:number,total:number,confidence:number,mathValid:boolean):ReceiptItem|null {const clean=name.replace(/\s+/g,' ').replace(/^[^\p{L}\p{N}]+/u,'').replace(/\s+[TD]$/i,'').trim();if(!clean||quantity<1||quantity>50)return null;const score=Math.max(0,Math.min(1,confidence/100+(mathValid?.08:-.22)));return{id:crypto.randomUUID(),name:clean.slice(0,100),quantity,unitPriceCents:unitPrice,totalPriceCents:total,confidence:score,needsReview:score<.65||!mathValid};}

export function itemsFromLayout(layout: ReceiptLayout): ReceiptItem[] {
  const anchors=inferredAnchors(layout),tolerance=Math.max(35,layout.width*.12),items:ReceiptItem[]=[];let pendingName='',pendingQuantity:number|null=null,pendingUnit:number|null=null,pendingConfidence=0;
  for(const row of layout.rows){const line=row.text.trim(),moneyWords=row.words.filter(word=>moneyValues(word.text).length),numberWords=row.words.filter(word=>numericWord(word)!==null);
    if(isColumnHeader(line)){continue;} if(summaryLine(line)){if(pendingName&&/^\s*(?:line\s*)?total\b/i.test(line)&&moneyWords.length){const total=moneyValues(moneyWords.at(-1)!.text).at(-1)!,quantity=pendingQuantity||1,unit=pendingUnit??(total%quantity===0?total/quantity:total),made=buildItem(pendingName,quantity,unit,total,(pendingConfidence+row.confidence)/2,Math.abs(quantity*unit-total)<=2);if(made)items.push(made);}pendingName='';pendingQuantity=pendingUnit=null;continue;}
    if(isNoiseLine(line))continue; const statedQuantity=explicitQuantity(line);if(statedQuantity&&!moneyWords.length&&!/\p{L}{3,}/u.test(line.replace(quantityWords,''))){pendingQuantity=statedQuantity;continue;}if(!moneyWords.length){if(/^\s*\d{1,2}\s*$/.test(line)){pendingQuantity=Number(line);continue;}if(/\p{L}/u.test(line)&&line.length<=120){pendingName=pendingName?`${pendingName} ${line}`:line;pendingConfidence=pendingConfidence?(pendingConfidence+row.confidence)/2:row.confidence;}continue;}
    if(/^\s*(?:unit(?:\s*price)?|rate)\b/i.test(line)&&pendingName){pendingUnit=moneyValues(moneyWords.at(-1)!.text).at(-1)!;continue;}
    let quantityWord=closest(numberWords,anchors.quantity);if(quantityWord&&anchors.quantity!==undefined&&Math.abs(center(quantityWord)-anchors.quantity)>tolerance)quantityWord=undefined;
    const leading=numberWords.find(word=>row.words.indexOf(word)===0&&numericWord(word)!==null),quantity=statedQuantity||(quantityWord?numericWord(quantityWord):null)||(leading?numericWord(leading):null)||pendingQuantity||1;
    const totalWord=closest(moneyWords,anchors.lineTotal)||moneyWords.at(-1)!,totalCandidate=moneyValues(totalWord.text).at(-1)!;
    const otherAmounts=moneyWords.filter(word=>word!==totalWord).map(word=>moneyValues(word.text).at(-1)!);let unit=pendingUnit??otherAmounts.find(value=>Math.abs(value*quantity-totalCandidate)<=2)??otherAmounts[0];let total=totalCandidate;
    if(unit===undefined&&moneyWords.length===1&&/(?:@|\/\s*(?:ea|unit)|\beach\b|\bper\s+(?:item|unit))/i.test(line)){unit=totalCandidate;total=quantity*unit;}if(unit===undefined)unit=total%quantity===0?total/quantity:total;
    const excluded=new Set<OcrWord>([...moneyWords,...numberWords.filter(word=>word===quantityWord||word===leading)]),description=row.words.filter(word=>!excluded.has(word)&&!/^(?:RM|MYR|@|x|\*|qty|quantity|pcs?|ea|unit|price|total|[TD])$/i.test(word.text)).map(word=>word.text).join(' ').trim(),name=description||pendingName;
    const confidence=(row.confidence+(pendingName?pendingConfidence:row.confidence))/2,mathValid=Math.abs(quantity*unit-total)<=2,made=buildItem(name,quantity,unit,total,confidence,mathValid);if(made)items.push(made);pendingName='';pendingQuantity=pendingUnit=null;pendingConfidence=0;
  }
  return items;
}
