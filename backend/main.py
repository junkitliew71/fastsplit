import os
import asyncio
import logging
import subprocess
import cv2
import numpy as np
from fastapi import FastAPI,File,UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ocr.paddle_ocr import engine,recognize,OCR_ENGINE
from ocr.preprocessing import prepare
from ocr.quality import analyse
from parser.layout import reconstruct_layout
from parser.receipt_parser import parse
from parser.validation import confidence_scores,validate_and_repair

MAX_BYTES=25*1024*1024;ALLOWED={'image/jpeg','image/png','image/webp'}
origins=[origin.strip() for origin in os.getenv('CORS_ORIGINS','http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000').split(',') if origin.strip()]
app=FastAPI(title='FastSplit OCR API');app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=False,allow_methods=['POST','GET'],allow_headers=['*'])
scan_lock=asyncio.Lock();logger=logging.getLogger('fastsplit.ocr')
def failure(code,message,status=400):return JSONResponse(status_code=status,content={'success':False,'error':{'code':code,'message':message}})

@app.on_event('startup')
def load_model():
    engine()
    logger.warning('FastSplit OCR ready: engine=%s',OCR_ENGINE)
@app.get('/health')
def health():return {'status':'ok','ocr':'ready','engine':OCR_ENGINE}

def _score(blocks):return (sum(b['confidence'] for b in blocks)/len(blocks) if blocks else 0)+min(len(blocks),40)/200

def diagnostic(stage,**details):
    if os.getenv('FASTSPLIT_DIAGNOSTICS')=='1':logger.warning('[FastSplit OCR] %s %s',stage,details)

class ParserFailure(RuntimeError):pass

def understand(image,blocks,quality):
    try:return _understand(image,blocks,quality)
    except Exception as error:raise ParserFailure('Layout or receipt parsing failed') from error

def _understand(image,blocks,quality):
    height,width=image.shape[:2];layout=reconstruct_layout(blocks,int(width),int(height));parsed=parse(layout)
    validation=validate_and_repair(parsed,layout);confidence=confidence_scores(quality,blocks,parsed['items'],validation)
    return {'image':image,'blocks':blocks,'layout':layout,'parsed':parsed,'validation':validation,'confidence':confidence}

def _candidate_rank(candidate):
    parsed=candidate['parsed'];validation=candidate['validation'];confidence=candidate['confidence']
    completeness=(1 if parsed['items'] else 0)+(0.5 if parsed.get('grandTotal') is not None else 0)
    unmatched=parsed.get('diagnostics',{}).get('unmatchedPriceCount',0)
    return (4 if validation['valid'] and parsed['items'] else 0)+completeness+confidence['overallConfidence']-min(unmatched,5)*.04

def _needs_enhanced(candidate):
    parsed=candidate['parsed'];confidence=candidate['confidence'];validation=candidate['validation']
    weak_ocr=len(candidate['blocks'])<8 or _score(candidate['blocks'])<.78 or confidence['ocrConfidence']<.72
    incomplete=not parsed['items'] or parsed.get('grandTotal') is None
    return weak_ocr or (not validation['valid'] and incomplete and confidence['ocrConfidence']<.88)

@app.post('/api/receipt/scan')
async def scan(image:UploadFile=File(...)):
    diagnostic('request received',engine=OCR_ENGINE)
    if image.content_type not in ALLOWED:return failure('INVALID_IMAGE','Upload a JPG, PNG, or WebP receipt.')
    raw=await image.read()
    diagnostic('image bytes',count=len(raw))
    if not raw:return failure('INVALID_IMAGE','The image is empty.')
    if len(raw)>MAX_BYTES:return failure('IMAGE_TOO_LARGE','The image must be smaller than 25 MB.',413)
    decoded=await asyncio.to_thread(cv2.imdecode,np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
    if decoded is None:return failure('IMAGE_DECODE_FAILED','The image could not be decoded.')
    diagnostic('image dimensions',width=int(decoded.shape[1]),height=int(decoded.shape[0]))
    quality=await asyncio.to_thread(analyse,decoded)
    if quality['fatal']:
        code,message=quality['fatal'];return failure(code,message,422)
    try:
        prepared,operations=await asyncio.to_thread(prepare,decoded,quality)
        diagnostic('preprocessing complete',operations=operations)
        async with scan_lock:blocks=await asyncio.to_thread(recognize,prepared)
        diagnostic('OCR complete',tokens=len(blocks))
        primary=await asyncio.to_thread(understand,prepared,blocks,quality)
        candidates=[primary];passes=[{'name':'NORMAL','operations':operations,'blockCount':len(blocks),'averageConfidence':round(_score(blocks),4),
          'overallConfidence':primary['confidence']['overallConfidence'],'mathValid':primary['validation']['valid'],'selected':True}]
        # Escalate once only when OCR is weak or the result is structurally incomplete.
        if _needs_enhanced(primary):
            enhanced,enhanced_operations=await asyncio.to_thread(prepare,decoded,quality,True)
            async with scan_lock:enhanced_blocks=await asyncio.to_thread(recognize,enhanced)
            enhanced_result=await asyncio.to_thread(understand,enhanced,enhanced_blocks,quality);candidates.append(enhanced_result)
            passes.append({'name':'ENHANCED','operations':enhanced_operations,'blockCount':len(enhanced_blocks),'averageConfidence':round(_score(enhanced_blocks),4),
              'overallConfidence':enhanced_result['confidence']['overallConfidence'],'mathValid':enhanced_result['validation']['valid'],'selected':False})
        selected=max(candidates,key=_candidate_rank);selected_index=candidates.index(selected)
        for index,ocr_pass in enumerate(passes):ocr_pass['selected']=index==selected_index
        prepared=selected['image'];blocks=selected['blocks'];layout=selected['layout'];parsed=selected['parsed'];validation=selected['validation'];confidence=selected['confidence']
        if not blocks:return failure('NO_TEXT_DETECTED','Unable to read receipt text.',422)
        warnings=list(validation['warnings'])
        if not parsed['items']:warnings.append({'type':'ITEM_WITHOUT_PRICE','message':'Text was detected, but items could not be extracted reliably. Please map the text manually.'})
        if quality['issues']:warnings.insert(0,{'type':'LOW_IMAGE_QUALITY','message':'Image quality issues detected: '+', '.join(quality['issues']).lower().replace('_',' ')+'.'})
        if confidence['ocrConfidence']<.72:warnings.append({'type':'LOW_OCR_CONFIDENCE','message':'Some receipt text may have been read incorrectly.'})
        warning=' '.join(w['message'] for w in warnings) or 'OCR complete. Review and map the receipt text.'
        public_items=[{k:v for k,v in item.items() if k!='sourceBlockIds'} for item in parsed['items']]
        diagnostic('response success',tokens=len(blocks),lines=len(layout['rows']),items=len(public_items),grandTotal=parsed['grandTotal'])
        pipeline_stages={
          '1_IMAGE_QUALITY':quality,
          '2_RAW_OCR':'\n'.join(b['text'] for b in blocks),
          '3_OCR_BOUNDING_BOXES':blocks,
          '4_TEXT_TYPE_CLASSIFICATION':{'receiptType':'UNKNOWN','regions':[{'blockId':b['id'],'textType':b.get('textType','unknown')} for b in blocks]},
          '5_LAYOUT_RECONSTRUCTION':layout['rows'],
          '6_COLUMN_DETECTION':layout['columns'],
          '7_ITEM_PRICE_MATCHING':parsed.get('diagnostics',{}),
          '8_PARSER':{**parsed,'items':public_items},
          '9_MATHEMATICAL_VALIDATION':validation,
          '10_FINAL_RESULT':{'confidence':confidence,'warnings':warnings,'selectedPass':passes[selected_index]['name']},
        }
        if os.getenv('FASTSPLIT_DIAGNOSTICS')=='1':
            logger.warning('FastSplit scan engine=%s blocks=%s items=%s grandTotal=%s selectedPass=%s',OCR_ENGINE,len(blocks),len(public_items),parsed['grandTotal'],passes[selected_index]['name'])
        return {'success':True,'schemaVersion':1,'extractionStatus':'complete' if public_items else 'needs_manual_mapping','imageWidth':int(prepared.shape[1]),'imageHeight':int(prepared.shape[0]),'ocrBlocks':blocks,
          'restaurant':parsed['restaurant'],'items':public_items,'subtotal':parsed['subtotal'],'serviceCharge':parsed['serviceCharge'],
          'tax':parsed['tax'],'discount':parsed['discount'],'rounding':parsed['rounding'],'grandTotal':parsed['grandTotal'],
          'confidence':confidence,'warnings':warnings,'warning':warning,
          'debug':{'stage1RawOcr':'\n'.join(b['text'] for b in blocks),'stage2Blocks':blocks,'stage3Rows':layout['rows'],
                   'stage4Columns':layout['columns'],'stage5Parser':{**parsed,'items':public_items},'stage6Validation':validation,
                   'imageQuality':quality,'ocrPasses':passes,'pipelineStages':pipeline_stages}}
    except ParserFailure:
        logger.exception('Receipt parsing failed')
        return failure('PARSER_FAILED','Text recognition completed, but receipt parsing failed. Please try again or enter manually.',500)
    except subprocess.TimeoutExpired:
        logger.exception('Receipt OCR timed out')
        return failure('OCR_TIMEOUT','Receipt recognition timed out. Please try a smaller, clearer photo.',504)
    except Exception:
        logger.exception('Receipt scan failed')
        return failure('OCR_ENGINE_FAILED','Unable to scan this receipt. Please try another photo.',500)
