import os
import csv
import io
import subprocess
from functools import lru_cache

# Render's free instance has a tight memory limit. Configure Paddle before it is
# imported so its CPU allocator and BLAS runtime do not reserve large pools.
os.environ.setdefault('FLAGS_allocator_strategy','auto_growth')
os.environ.setdefault('OMP_NUM_THREADS','1')
os.environ.setdefault('MKL_NUM_THREADS','1')

PRIMARY_OCR_MODEL=os.getenv('FASTSPLIT_PRIMARY_OCR','PP-OCRv4')
OCR_ENGINE=os.getenv('FASTSPLIT_OCR_ENGINE','paddle').lower()

@lru_cache(maxsize=1)
def engine():
    # Constructed once at startup and reused for every request.
    # Receipt photos are orientation-normalized by the capture UI, so omitting
    # the separate angle-classifier model saves substantial server RAM.
    if OCR_ENGINE == 'tesseract':
        subprocess.run(['tesseract', '--version'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            ['tesseract', 'stdin', 'stdout', '--psm', '6', 'tsv'],
            input=encoded.tobytes(), stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, check=True,
        )
        rows = csv.DictReader(io.StringIO(completed.stdout.decode('utf-8', errors='replace')), delimiter='\t')
        lines = {}
        for row in rows:
            text = (row.get('text') or '').strip()
            try:
                confidence = float(row.get('conf', '-1'))
            except ValueError:
                continue
            if not text or confidence < 0:
                continue
            key = (row.get('page_num'), row.get('block_num'), row.get('par_num'), row.get('line_num'))
            x, y = int(row['left']), int(row['top'])
            width, height = int(row['width']), int(row['height'])
            entry = lines.setdefault(key, {'words': [], 'scores': [], 'x1': x, 'y1': y, 'x2': x + width, 'y2': y + height})
            entry['words'].append(text); entry['scores'].append(confidence / 100)
            entry['x1'] = min(entry['x1'], x); entry['y1'] = min(entry['y1'], y)
            entry['x2'] = max(entry['x2'], x + width); entry['y2'] = max(entry['y2'], y + height)
        blocks = []
        for entry in lines.values():
            x, y = entry['x1'], entry['y1']; width = max(1, entry['x2'] - x); height = max(1, entry['y2'] - y)
            text = ' '.join(entry['words']); score = round(sum(entry['scores']) / len(entry['scores']), 4)
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
