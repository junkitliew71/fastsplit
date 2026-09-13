import json,re
from pathlib import Path
from parser.layout import reconstruct_layout
from parser.receipt_parser import parse
from parser.validation import validate_and_repair

ROOT=Path(__file__).parent
def norm(value):return re.sub(r'[^a-z0-9]','',value.lower())
def compare(actual,expected):
    expected_items=expected['items'];actual_items=actual['items'];matched=set();pairs=0
    for wanted in expected_items:
        candidates=[(i,item) for i,item in enumerate(actual_items) if i not in matched and (norm(wanted['name']) in norm(item['name']) or norm(item['name']) in norm(wanted['name']))]
        if candidates:
            i,item=candidates[0];matched.add(i);pairs+=abs(item['totalPrice']-wanted['price'])<=.02
    detected=len(matched);false=max(0,len(actual_items)-detected);missing=max(0,len(expected_items)-detected)
    fields=['subtotal','tax','serviceCharge','grandTotal'];field_ok={f:abs((actual.get(f) or 0)-(expected.get(f) or 0))<=.02 for f in fields}
    return {'itemDetection':detected/len(expected_items),'pricePairing':pairs/len(expected_items),'missingRate':missing/len(expected_items),
      'falseItemRate':false/max(1,len(actual_items)),'subtotal':field_ok['subtotal'],'tax':field_ok['tax'],'grandTotal':field_ok['grandTotal'],
      'fullyCorrect':detected==pairs==len(expected_items) and not false and all(field_ok.values())}

def evaluate():
    before=[];after=[];skipped=[]
    for sample_path in sorted((ROOT/'dataset').glob('*.json')):
        sample=json.loads(sample_path.read_text(encoding='utf-8'));blocks=[]
        if sample.get('ocr'):
            ocr_path=(sample_path.parent/sample['ocr']).resolve();raw=json.loads(ocr_path.read_text(encoding='utf-8'))
            for index,token in enumerate(raw['tokens']):
                b={k:token[k] for k in ('text','x','y','width','height')};b.update(id=index,confidence=token['confidence']/100,centerX=token['x']+token['width']/2,centerY=token['y']+token['height']/2,polygon=[]);blocks.append(b)
            width=max(b['x']+b['width'] for b in blocks);height=max(b['y']+b['height'] for b in blocks)
        else:
            import cv2
            from ocr.paddle_ocr import recognize
            from ocr.preprocessing import prepare
            from ocr.quality import analyse
            image_path=(sample_path.parent/sample['image']).resolve()
            if not image_path.exists():skipped.append(sample_path.stem);continue
            image=cv2.imread(str(image_path))
            if image is None:skipped.append(sample_path.stem);continue
            prepared,_=prepare(image,analyse(image));blocks=recognize(prepared);height,width=prepared.shape[:2]
        layout=reconstruct_layout(blocks,width,height)
        parsed=parse(layout);validate_and_repair(parsed,layout)
        baseline={**sample['baseline'],'items':[{'name':i['name'],'totalPrice':i['price']} for i in sample['baseline']['items']]}
        before.append(compare(baseline,sample['expected']));after.append(compare(parsed,sample['expected']))
    def aggregate(rows):
        keys=rows[0];return {key:round(sum(float(row[key]) for row in rows)/len(rows)*100,1) for key in keys}
    print(json.dumps({'receipts':len(after),'skipped':skipped,'old':aggregate(before) if before else {},'new':aggregate(after) if after else {}},indent=2))
if __name__=='__main__':evaluate()
