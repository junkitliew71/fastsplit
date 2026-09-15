import os
import csv
import io
import subprocess
import logging
from functools import lru_cache

# Render's free instance has a tight memory limit. Configure Paddle before it is
# imported so its CPU allocator and BLAS runtime do not reserve large pools.
os.environ.setdefault('FLAGS_allocator_strategy','auto_growth')
os.environ.setdefault('OMP_NUM_THREADS','1')
os.environ.setdefault('MKL_NUM_THREADS','1')

PRIMARY_OCR_MODEL=os.getenv('FASTSPLIT_PRIMARY_OCR','PP-OCRv4')
OCR_ENGINE=os.getenv('FASTSPLIT_OCR_ENGINE','paddle').lower()
logger=logging.getLogger('fastsplit.ocr')

@lru_cache(maxsize=1)
def engine():
    # Constructed once at startup and reused for every request.
    # Receipt photos are orientation-normalized by the capture UI, so omitting
    # the separate angle-classifier model saves substantial server RAM.
    if OCR_ENGINE == 'tesseract':
        subprocess.run(['tesseract', '--version'], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        languages=subprocess.run(['tesseract','--list-langs'],check=True,capture_output=True,text=True,timeout=10)
        if 'eng' not in languages.stdout.split():
            raise RuntimeError('Tesseract English language data is unavailable')
        return 'tesseract'
    if OCR_ENGINE == 'rapidocr':
        from rapidocr_onnxruntime import RapidOCR
        return RapidOCR(det_limit_side_len=960, det_thresh=.25, box_thresh=.5,
                        intra_op_num_threads=1, inter_op_num_threads=1)

    # Keep PaddleOCR as the full primary engine for local development and
    # servers with enough RAM. Import lazily so low-memory deployments do not
    # load Paddle's runtime alongside the lightweight ONNX engine.
    from paddleocr import PaddleOCR
    return PaddleOCR(use_angle_cls=False,lang='en',ocr_version=PRIMARY_OCR_MODEL,use_gpu=False,show_log=False,
                     enable_mkldnn=False,cpu_threads=1,rec_batch_num=1,
                     use_space_char=True,det_limit_side_len=1600,det_db_thresh=.25,det_db_box_thresh=.5,drop_score=.2)

def recognize(image):
    if OCR_ENGINE == 'tesseract':
        import cv2
        ok, encoded = cv2.imencode('.png', image)
        if not ok:
            return []
        completed = subprocess.run(
            ['tesseract', 'stdin', 'stdout', '-l', 'eng', '--psm', '6', 'tsv'],
            input=encoded.tobytes(), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False, timeout=90,
        )
        if completed.returncode:
            logger.error('[FastSplit OCR] Tesseract returncode=%s stderr=%s',completed.returncode,completed.stderr.decode('utf-8',errors='replace')[:500])
            raise RuntimeError('Tesseract execution failed')
        if completed.stderr and os.getenv('FASTSPLIT_DIAGNOSTICS')=='1':
            logger.info('[FastSplit OCR] Tesseract stderr=%s',completed.stderr.decode('utf-8',errors='replace')[:500])
        rows = csv.DictReader(io.StringIO(completed.stdout.decode('utf-8', errors='replace')), delimiter='\t')
        blocks = []
        for row in rows:
            text = (row.get('text') or '').strip()
            try:
                confidence = float(row.get('conf', '-1'))
            except ValueError:
                continue
            if not text or confidence < 0:
                continue
            x, y = int(row['left']), int(row['top'])
            width, height = int(row['width']), int(row['height'])
            width=max(1,width); height=max(1,height)
            score = round(confidence / 100, 4)
            points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
            blocks.append({'id':len(blocks),'text':text,'confidence':score,'polygon':points,'source':'Tesseract',
                           'textType':'printed','candidates':[{'text':text,'confidence':score,'source':'Tesseract'}],
                           'x':x,'y':y,'width':width,'height':height,'centerX':round(x+width/2,2),'centerY':round(y+height/2,2)})
        return blocks
    if OCR_ENGINE == 'rapidocr':
        result, _ = engine()(image)
        pages = [result or []]
        source = 'RapidOCR-ONNX'
    else:
        pages = engine().ocr(image, cls=False) or []
        source = PRIMARY_OCR_MODEL
    blocks = []
    for page in pages:
        for line in page or []:
            if OCR_ENGINE == 'rapidocr':
                points, text, confidence = line
            else:
                points, recognized = line
                text, confidence = recognized
            xs, ys = [p[0] for p in points], [p[1] for p in points]
            x, y = int(min(xs)), int(min(ys))
            width=max(1,int(max(xs)-x)); height=max(1,int(max(ys)-y))
            score=round(float(confidence),4)
            blocks.append({'id':len(blocks),'text':text.strip(),'confidence':score,'polygon':points,'source':source,
                           'textType':'unknown','candidates':[{'text':text.strip(),'confidence':score,'source':source}],
                           'x':x,'y':y,'width':width,'height':height,'centerX':round(x+width/2,2),'centerY':round(y+height/2,2)})
    return [block for block in blocks if block['text']]
