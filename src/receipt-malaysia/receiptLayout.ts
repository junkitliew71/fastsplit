import type { ReceiptItem } from '../types';
import { moneyValues } from './malaysiaCurrency';
import { isNoiseLine } from './malaysiaIgnorePatterns';
import { discountLabels, roundingLabels, serviceLabels, subtotalLabels, taxLabels, totalLabels } from './malaysiaReceiptKeywords';
import { isColumnHeader, quantityWords } from './restaurantReceiptSemantics';

export interface OcrWord { text: string; confidence: number; x: number; y: number; width: number; height: number; centerX: number; centerY: number }
export interface ReceiptRow { words: OcrWord[]; text: string; confidence: number; y: number }
export interface ReceiptLayout { words: OcrWord[]; rows: ReceiptRow[]; width: number; height: number; text: string }

const median = (values:number[]) => { const sorted=[...values].filter(Number.isFinite).sort((a,b)=>a-b); return sorted.length ? sorted[Math.floor(sorted.length/2)] : 0; };

/** Rebuild physical rows from geometry. The tolerance is deliberately derived
 * from the median glyph height; Paddle's array order is never treated as layout. */
export function layoutFromWords(input:OcrWord[],width?:number,height?:number):ReceiptLayout {
  const words=input.map(word=>({...word,centerX:Number.isFinite(word.centerX)?word.centerX:word.x+word.width/2,centerY:Number.isFinite(word.centerY)?word.centerY:word.y+word.height/2}));
  const textHeight=median(words.filter(word=>word.confidence>=35).map(word=>word.height))||16;
  const tolerance=Math.max(5,textHeight*.48),groups:OcrWord[][]=[];
  for(const word of [...words].sort((a,b)=>a.centerY-b.centerY||a.x-b.x)){
    let best:OcrWord[]|undefined,bestGap=Infinity;
    for(const group of groups){const rowCenter=median(group.map(entry=>entry.centerY)),gap=Math.abs(word.centerY-rowCenter);if(gap<=tolerance&&gap<bestGap){best=group;bestGap=gap;}}
    (best||(groups.push([]),groups.at(-1)!)).push(word);
  }
  const rows=groups.map(group=>{group.sort((a,b)=>a.x-b.x);return{words:group,text:group.map(word=>word.text).join(' '),confidence:group.reduce((sum,word)=>sum+word.confidence,0)/group.length,y:median(group.map(word=>word.y))};}).sort((a,b)=>a.y-b.y);
  return{words,rows,width:width??Math.max(0,...words.map(word=>word.x+word.width)),height:height??Math.max(0,...words.map(word=>word.y+word.height)),text:rows.map(row=>row.text).join('\n')};
}

export function layoutFromTsv(tsv: string): ReceiptLayout {
  const words: OcrWord[] = tsv.split('\n').slice(1).flatMap(row => {
    const cells = row.split('\t'); if (cells[0] !== '5' || !cells[11]?.trim()) return [];
    const x = Number(cells[6]), y = Number(cells[7]), width = Number(cells[8]), height = Number(cells[9]), confidence = Number(cells[10]);
    return [x, y, width, height, confidence].every(Number.isFinite) ? [{ text: cells.slice(11).join('\t').trim(), confidence, x, y, width, height, centerX:x+width/2, centerY:y+height/2 }] : [];
  });
  const page=tsv.split('\n').map(row=>row.split('\t')).find(cells=>cells[0]==='1');
  return layoutFromWords(words,Number(page?.[8])||undefined,Number(page?.[9])||undefined);
}

export type ReceiptColumns = { quantity?: number; description?: number; code?: number; unitPrice?: number; lineTotal?: number };
type Anchors = ReceiptColumns;
const center = (word: OcrWord) => word.centerX;
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
function repeatedAnchor(values:number[],tolerance:number){const groups:number[][]=[];for(const value of values.sort((a,b)=>a-b)){const group=groups.find(values=>Math.abs(value-values.reduce((sum,n)=>sum+n,0)/values.length)<=tolerance);(group||(groups.push([]),groups[groups.length-1])).push(value);}const best=groups.sort((a,b)=>b.length-a.length)[0];return best&&best.length>=2?best.reduce((sum,n)=>sum+n,0)/best.length:undefined;}
function inferredAnchors(layout: ReceiptLayout): Anchors {
  const header=layout.rows.find(row=>isColumnHeader(row.text)),fromHeader=header?tableAnchors(header):{},tolerance=Math.max(18,layout.width*.055);
  const moneyX=layout.rows.flatMap(row=>row.words.filter(word=>moneyValues(word.text).length).map(center));
  const quantityX=layout.rows.flatMap(row=>row.words.filter(word=>numericWord(word)!==null||/^\s*(?:\d{1,2}|\.0+)(?:\.0+)?\s*@/.test(word.text)).map(center));
  const lineTotal=fromHeader.lineTotal??clusteredAnchor(moneyX,tolerance,true),unitPrice=fromHeader.unitPrice??repeatedAnchor(moneyX.filter(value=>lineTotal===undefined||Math.abs(value-lineTotal)>tolerance),tolerance);
  const base={...fromHeader,lineTotal,unitPrice,quantity:fromHeader.quantity??clusteredAnchor(quantityX,tolerance)};
  const letters=layout.rows.flatMap(row=>row.words.filter(word=>/^[A-Z]$/.test(word.text)&&center(word)>(base.description??0)&&center(word)<(base.unitPrice??base.lineTotal??layout.width)).map(center));
  return {...base,code:repeatedAnchor(letters,Math.max(10,layout.width*.025))};
}
const summaryLine=(line:string)=>[subtotalLabels,totalLabels,serviceLabels,taxLabels,discountLabels,roundingLabels].some(pattern=>pattern.test(line)||pattern.test(line.replace(/\s/g,'')))||/\b(?:balance|cash|change|amount\s*due)\b/i.test(line);
const explicitQuantity=(line:string)=>Number(line.match(/(?:^|\b(?:qty|quantity)\s*:?)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:x|\*|@|pcs?|ea|units?)\b/i)?.slice(1).find(Boolean)||0)||null;
function buildItem(name:string,quantity:number,unitPrice:number,total:number,confidence:number,mathValid:boolean):ReceiptItem|null {const clean=name.replace(/\s+/g,' ').replace(/^[^\p{L}\p{N}]+/u,'').trim();if(!clean||/^[A-Z]$/.test(clean)||quantity<1||quantity>50)return null;const score=Math.max(0,Math.min(1,confidence/100+(mathValid?.08:-.22)));return{id:crypto.randomUUID(),name:clean.slice(0,100),quantity,unitPriceCents:unitPrice,totalPriceCents:total,confidence:score,needsReview:score<.65||!mathValid};}

export function receiptColumns(layout:ReceiptLayout):ReceiptColumns{return inferredAnchors(layout);}
export function receiptTableBounds(layout:ReceiptLayout){const header=layout.rows.find(row=>isColumnHeader(row.text));if(!header)return null;const end=layout.rows.find(row=>row.y>header.y&&summaryLine(row.text));return{left:0,top:Math.max(0,header.y-12),right:layout.width,bottom:Math.min(layout.height,(end?.y??layout.height)+12)};}
export function classifyReceiptRow(row:ReceiptRow){if(isColumnHeader(row.text))return'COLUMN_HEADER';if(summaryLine(row.text))return'TOTAL_OR_CHARGE';if(isNoiseLine(row.text))return'METADATA_OR_PAYMENT';if(row.words.some(word=>moneyValues(word.text).length))return'ITEM_CANDIDATE';if(/\p{L}/u.test(row.text))return'ITEM_CONTINUATION_OR_UNKNOWN';return'UNKNOWN';}

function legacyItemsFromLayout(layout: ReceiptLayout): ReceiptItem[] {
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
    const codeAnchor=anchors.code;let codeWord=codeAnchor===undefined?undefined:closest(row.words.filter(word=>/^[A-Z]$/.test(word.text)),codeAnchor);if(codeWord&&codeAnchor!==undefined&&Math.abs(center(codeWord)-codeAnchor)>Math.max(18,layout.width*.04))codeWord=undefined;
    const excluded=new Set<OcrWord>([...moneyWords,...numberWords.filter(word=>word===quantityWord||word===leading),...(codeWord?[codeWord]:[])]),description=row.words.filter(word=>!excluded.has(word)&&!/^(?:RM|MYR|@|x|\*|qty|quantity|pcs?|ea|unit|price|total)$/i.test(word.text)).map(word=>word.text).join(' ').trim(),name=description||pendingName;
    const confidence=(row.confidence+(pendingName?pendingConfidence:row.confidence))/2,mathValid=Math.abs(quantity*unit-total)<=2,made=buildItem(name,quantity,unit,total,confidence,mathValid);if(made)items.push(made);pendingName='';pendingQuantity=pendingUnit=null;pendingConfidence=0;
  }
  return items;
}

export type ReceiptRegionName='header'|'itemTable'|'paymentSummary';
export interface ReceiptRegions {header:ReceiptRow[];itemTable:ReceiptRow[];paymentSummary:ReceiptRow[];headerBottom:number;summaryTop:number}
export interface ReceiptSummaryFields {subtotalCents?:number;serviceChargeCents?:number;taxCents?:number;discountCents?:number;roundingCents?:number;netTotalCents?:number}

const isSummaryStart=(text:string)=>/\b(?:sub\s*total|bill\s*amount|total\s*\(?excluding\s*(?:gst|sst)|gst\s*payable|gsi\s*payable|service\s*charges?|rounding|net\s*total)\b/i.test(text);
export function receiptRegions(layout:ReceiptLayout):ReceiptRegions{
  const header=layout.rows.find(row=>isColumnHeader(row.text));
  const headerBottom=header?Math.max(...header.words.map(word=>word.y+word.height)):layout.height*.35;
  const summary=layout.rows.find(row=>row.y>headerBottom&&isSummaryStart(row.text));
  const summaryTop=summary?.y??layout.height;
  return{header:layout.rows.filter(row=>row.y<headerBottom),itemTable:layout.rows.filter(row=>row.y>=headerBottom&&row.y<summaryTop),paymentSummary:layout.rows.filter(row=>row.y>=summaryTop),headerBottom,summaryTop};
}

function signedAmount(text:string){const values=moneyValues(text);if(values.length)return (/^\s*-/.test(text)?-1:1)*values.at(-1)!;if(/^\s*-?\.\d{2}\s*$/.test(text))return Math.round(Number(text)*100);return undefined;}
function closestAmountForLabel(label:OcrWord,words:OcrWord[],height:number){return words.filter(word=>word.x>label.x&&signedAmount(word.text)!==undefined&&Math.abs(word.centerY-label.centerY)<=height*.9).sort((a,b)=>Math.abs(a.centerY-label.centerY)-Math.abs(b.centerY-label.centerY)||b.x-a.x)[0];}
export function receiptSummaryFields(layout:ReceiptLayout):ReceiptSummaryFields{
  const region=receiptRegions(layout),height=median(layout.words.map(word=>word.height))||16,result:ReceiptSummaryFields={},totalCandidates:{value:number;y:number;priority:number}[]=[];
  for(const label of region.paymentSummary.flatMap(row=>row.words)){
    const text=label.text,amountWord=closestAmountForLabel(label,region.paymentSummary.flatMap(row=>row.words),height);if(!amountWord)continue;const value=signedAmount(amountWord.text);if(value===undefined)continue;
    if(/(?:sub\s*total|bill\s*amount|total\s*\(?excluding\s*(?:gst|sst))/i.test(text))result.subtotalCents=value;
    else if(/service\s*charges?|service\s*tax/i.test(text))result.serviceChargeCents=value;
    else if(/total.*inclusive|amount\s*due|grand\s*total/i.test(text))totalCandidates.push({value,y:label.centerY,priority:1});
    else if(/(?:gst|gsi|sst)(?:\s*payable)?|tax/i.test(text)&&!/summary/i.test(text))result.taxCents=value;
    else if(/discount|rebate|voucher/i.test(text))result.discountCents=value;
    else if(/rounding/i.test(text))result.roundingCents=value;
    else if(/net\s*total/i.test(text))totalCandidates.push({value,y:label.centerY,priority:3});
    else if(/^\s*total\s*:?\s*$/i.test(text))totalCandidates.push({value,y:label.centerY,priority:2});
  }
  const best=totalCandidates.sort((a,b)=>b.priority-a.priority||b.y-a.y)[0];if(best)result.netTotalCents=best.value;
  return result;
}

type ItemAnchor={word:OcrWord;quantity:number;uncertain:boolean};
const quantityFromWord=(word:OcrWord)=>{const at=word.text.match(/^\s*(\d{1,2})(?:\.0+)?\s*@/);if(at)return{quantity:Number(at[1]),uncertain:false};if(/^\s*\.0+\s*@/.test(word.text))return{quantity:1,uncertain:true};if(/^\s*\d{1,2}\s*$/.test(word.text))return{quantity:Number(word.text),uncertain:false};return null;};
const descriptionWord=(word:OcrWord)=>signedAmount(word.text)===undefined&&/\p{L}/u.test(word.text)&&!/^(?:D|T|SR|RM|MYR)$/i.test(word.text)&&!isColumnHeader(word.text)&&!summaryLine(word.text);

/** Paddle emits one polygon per recognised text line. This parser associates
 * those polygons spatially: quantities form row anchors, amounts are read from
 * right to left, and description polygons are attached independently. */
function spatialItemsFromLayout(layout:ReceiptLayout):ReceiptItem[]{
  const regions=receiptRegions(layout),words=regions.itemTable.flatMap(row=>row.words).filter(word=>word.confidence>=20),height=median(words.map(word=>word.height))||16;
  let quantityCandidates=words.flatMap(word=>{const parsed=quantityFromWord(word);return parsed?[{word,...parsed}]:[];});
  const atCandidates=quantityCandidates.filter(candidate=>/@/.test(candidate.word.text));
  const qx=median((atCandidates.length>=2?atCandidates:quantityCandidates).map(candidate=>candidate.word.centerX));
  quantityCandidates=quantityCandidates.filter(candidate=>Math.abs(candidate.word.centerX-qx)<=Math.max(layout.width*.09,height*2)&&candidate.quantity>=1&&candidate.quantity<=50&&(!atCandidates.length||/@/.test(candidate.word.text))).sort((a,b)=>a.word.centerY-b.word.centerY);
  // If there is no reliable quantity column, the legacy strategy remains the
  // better general solution for simple one-line retail receipts.
  if(!quantityCandidates.length)return legacyItemsFromLayout({...layout,rows:regions.itemTable});
  const descriptions=words.filter(descriptionWord).sort((a,b)=>a.centerY-b.centerY||a.x-b.x);
  // Find the shared vertical offset between numeric baselines and description
  // baselines. It handles dot-matrix receipts where each logical row is emitted
  // as two staggered Paddle polygons.
  let bestOffset=0,bestScore=-Infinity;
  for(let offset=-height*1.25;offset<=height*1.25;offset+=Math.max(2,height/12)){
    const used=new Set<OcrWord>();let score=0;
    for(const anchor of quantityCandidates){const target=anchor.word.centerY+offset,candidate=descriptions.filter(word=>!used.has(word)).sort((a,b)=>Math.abs(a.centerY-target)-Math.abs(b.centerY-target))[0];if(candidate&&Math.abs(candidate.centerY-target)<=height*1.15){used.add(candidate);score+=120-Math.abs(candidate.centerY-target)/height*20+candidate.confidence/20;}}
    if(score>bestScore){bestScore=score;bestOffset=offset;}
  }
  const mainNames=new Map<ItemAnchor,OcrWord>(),claimed=new Set<OcrWord>();
  for(const anchor of quantityCandidates){const target=anchor.word.centerY+bestOffset,candidate=descriptions.filter(word=>!claimed.has(word)).sort((a,b)=>Math.abs(a.centerY-target)-Math.abs(b.centerY-target))[0];if(candidate&&Math.abs(candidate.centerY-target)<=height*1.2){mainNames.set(anchor,candidate);claimed.add(candidate);}}
  const names=new Map<ItemAnchor,OcrWord[]>();quantityCandidates.forEach(anchor=>{const main=mainNames.get(anchor);names.set(anchor,main?[main]:[]);});
  // Unclaimed text-only polygons are wrapped names. Attach them to the nearest
  // numeric row, with a strong preference for the preceding row when they sit
  // after its numeric baseline and before the next item's main description.
  for(const word of descriptions.filter(word=>!claimed.has(word))){let chosen=quantityCandidates.reduce((best,anchor)=>Math.abs(anchor.word.centerY+bestOffset-word.centerY)<Math.abs(best.word.centerY+bestOffset-word.centerY)?anchor:best);for(let i=0;i<quantityCandidates.length-1;i++){const current=quantityCandidates[i],next=quantityCandidates[i+1],nextMain=mainNames.get(next);if(word.centerY>current.word.centerY&&nextMain&&word.centerY<nextMain.centerY){chosen=current;break;}}if(Math.abs(chosen.word.centerY-word.centerY)<=height*2.4)names.get(chosen)!.push(word);}
  const summary=receiptSummaryFields(layout),items:ReceiptItem[]=[];
  quantityCandidates.forEach((anchor,index)=>{
    const previous=quantityCandidates[index-1]?.word.centerY,next=quantityCandidates[index+1]?.word.centerY,low=previous===undefined?-Infinity:(previous+anchor.word.centerY)/2-height*.15,high=next===undefined?Infinity:(next+anchor.word.centerY)/2+height*.15;
    const nearby=words.filter(word=>word.centerX>anchor.word.centerX+height&&word.centerY>=low&&word.centerY<=high&&signedAmount(word.text)!==undefined);
    const xGroups:OcrWord[][]=[];for(const word of nearby.sort((a,b)=>a.centerX-b.centerX)){const group=xGroups.find(entries=>Math.abs(word.centerX-median(entries.map(entry=>entry.centerX)))<=Math.max(height,layout.width*.06));(group||(xGroups.push([]),xGroups.at(-1)!)).push(word);}const amountWords=xGroups.map(group=>group.sort((a,b)=>Math.abs(a.centerY-anchor.word.centerY)-Math.abs(b.centerY-anchor.word.centerY))[0]).sort((a,b)=>a.centerX-b.centerX);
    const values=amountWords.map(word=>signedAmount(word.text)!);let unit:number,total:number,uncertain=anchor.uncertain;
    if(values.length>=2){total=values.at(-1)!;unit=values.at(-2)!;}else if(values.length===1){total=values[0];unit=anchor.quantity?Math.round(total/anchor.quantity):total;}else{return;}
    const nameWords=(names.get(anchor)||[]).sort((a,b)=>a.centerY-b.centerY||a.x-b.x),name=nameWords.map(word=>word.text).join(' ').trim();if(!name)return;
    // A literal '.00' in the rightmost column is zero, not an omitted leading
    // digit. Keeping it exposes row-level inconsistency while allowing the
    // printed subtotal to decide the globally consistent interpretation.
    const mathValid=Math.abs(anchor.quantity*unit-total)<=2;uncertain ||= !mathValid||amountWords.some(word=>word.confidence<60)||nameWords.some(word=>word.confidence<60);
    const confidence=[anchor.word,...amountWords,...nameWords].reduce((sum,word)=>sum+word.confidence,0)/Math.max(1,1+amountWords.length+nameWords.length);
    const made=buildItem(name,anchor.quantity,unit,total,confidence,mathValid);if(made)items.push({...made,needsReview:made.needsReview||uncertain});
  });
  // Prefer the interpretation whose item totals match the printed subtotal.
  // Missing zero-total rows remain present and reviewable instead of vanishing.
  if(summary.subtotalCents!==undefined&&Math.abs(items.reduce((sum,item)=>sum+item.totalPriceCents,0)-summary.subtotalCents)>2)items.forEach(item=>item.needsReview=true);
  return items;
}

export function itemsFromLayout(layout:ReceiptLayout):ReceiptItem[]{
  const height=median(layout.words.map(word=>word.height));
  return height>=24&&receiptRegions(layout).itemTable.length?spatialItemsFromLayout(layout):legacyItemsFromLayout(layout);
}
