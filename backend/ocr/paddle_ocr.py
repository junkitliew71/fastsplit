import os
from functools import lru_cache

# Render's free instance has a tight memory limit. Configure Paddle before it is
# imported so its CPU allocator and BLAS runtime do not reserve large pools.
os.environ.setdefault('FLAGS_allocator_strategy','auto_growth')
os.environ.setdefault('OMP_NUM_THREADS','1')
os.environ.setdefault('MKL_NUM_THREADS','1')

from paddleocr import PaddleOCR

PRIMARY_OCR_MODEL=os.getenv('FASTSPLIT_PRIMARY_OCR','PP-OCRv4')

@lru_cache(maxsize=1)
def engine() -> PaddleOCR:
    # Constructed once at startup and reused for every request.
    # Receipt photos are orientation-normalized by the capture UI, so omitting
    # the separate angle-classifier model saves substantial server RAM.
    return PaddleOCR(use_angle_cls=False,lang='en',ocr_version=PRIMARY_OCR_MODEL,use_gpu=False,show_log=False,
                     enable_mkldnn=False,cpu_threads=1,rec_batch_num=1,
                     use_space_char=True,det_limit_side_len=1600,det_db_thresh=.25,det_db_box_thresh=.5,drop_score=.2)

def recognize(image):
    result = engine().ocr(image, cls=False)
    blocks = []
    for page in result or []:
        for line in page or []:
            points, recognized = line
            text, confidence = recognized
            xs, ys = [p[0] for p in points], [p[1] for p in points]
            x, y = int(min(xs)), int(min(ys))
            width=max(1,int(max(xs)-x)); height=max(1,int(max(ys)-y))
            score=round(float(confidence),4)
            blocks.append({'id':len(blocks),'text':text.strip(),'confidence':score,'polygon':points,'source':PRIMARY_OCR_MODEL,
                           'textType':'unknown','candidates':[{'text':text.strip(),'confidence':score,'source':PRIMARY_OCR_MODEL}],
                           'x':x,'y':y,'width':width,'height':height,'centerX':round(x+width/2,2),'centerY':round(y+height/2,2)})
    return [block for block in blocks if block['text']]
