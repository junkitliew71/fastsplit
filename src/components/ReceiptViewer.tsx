import {memo,useCallback,useMemo}from'react';
import type{OcrToken}from'../types';

const Token=memo(function Token({token,maxX,maxY,selected,assigned,onTap}:{token:OcrToken;maxX:number;maxY:number;selected:boolean;assigned:boolean;onTap:(id:string)=>void}){
 return <button draggable onDragStart={e=>{e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',token.id);}} className={`ocr-box ${selected?'selected':''} ${assigned?'assigned':''} ${token.confidence<.7?'low':''}`} style={{left:`${token.bbox.x/maxX*100}%`,top:`${token.bbox.y/maxY*100}%`,width:`${token.bbox.width/maxX*100}%`,height:`${token.bbox.height/maxY*100}%`}} onClick={()=>onTap(token.id)} title={`Drag “${token.text}” to a field`}>{token.text}</button>;
});
export function ReceiptViewer({imageUrl,tokens,selected,assigned,onTokenTap}:{imageUrl:string;tokens:OcrToken[];selected:string[];assigned:Set<string>;onTokenTap:(id:string)=>void}){
 const maxX=useMemo(()=>Math.max(...tokens.map(t=>t.bbox.x+t.bbox.width),1),[tokens]),maxY=useMemo(()=>Math.max(...tokens.map(t=>t.bbox.y+t.bbox.height),1),[tokens]),tap=useCallback((id:string)=>onTokenTap(id),[onTokenTap]);
 return <div className="receipt-pan receipt-drag-source"><div className="receipt-transform-layer"><img draggable={false} src={imageUrl} alt="Your receipt"/>{tokens.map(t=><Token key={t.id} token={t} maxX={maxX} maxY={maxY} selected={selected.includes(t.id)} assigned={assigned.has(t.id)} onTap={tap}/>)}</div></div>;
}
