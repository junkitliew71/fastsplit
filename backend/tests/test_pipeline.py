import json
import unittest
from pathlib import Path
import cv2
import numpy as np
from ocr.quality import analyse
from parser.layout import reconstruct_layout,reconstruct_rows
from parser.receipt_parser import parse
from parser.validation import validate_and_repair
from parser.receipt_parser import _recover_quantity_outliers,_values

ROOT=Path(__file__).resolve().parents[1]
def block(index,text,x,y,width=80,height=20):
    return {'id':index,'text':text,'confidence':.95,'x':x,'y':y,'width':width,'height':height,
      'centerX':x+width/2,'centerY':y+height/2,'polygon':[]}

class PipelineTests(unittest.TestCase):
    def test_accepts_decimal_integer_and_thousands_amounts(self):
        self.assertEqual(_values('RM 16.50'),[16.5])
        self.assertEqual(_values('16,500'),[16500.0])
        self.assertEqual(_values('TOTAL 45500',integer_money=True),[45500.0])

    def test_rejects_unusable_blur(self):
        quality=analyse(np.full((800,600,3),220,dtype=np.uint8))
        self.assertEqual(quality['fatal'][0],'LOW_IMAGE_QUALITY')

    def test_row_reconstruction_does_not_chain_neighbouring_lines(self):
        rows=reconstruct_rows([block(0,'FIRST',10,50,100,80),block(1,'SECOND',10,105,100,80),block(2,'THIRD',10,160,100,80)])
        self.assertEqual([row['text'] for row in rows],['FIRST','SECOND','THIRD'])

    def test_integer_currency_receipt_uses_price_geometry_and_excludes_total(self):
        blocks=[block(0,'QTY',30,40),block(1,'ITEM',160,40),block(2,'TOTAL',500,40),
          block(3,'1',35,100,20),block(4,'REAL GANACHE',150,100,180),block(5,'16,500',500,100),
          block(6,'1',35,140,20),block(7,'EGG TART',150,140,150),block(8,'13,000',500,140),
          block(9,'TOTAL',150,210,120),block(10,'29,500',500,210)]
        parsed=parse(reconstruct_layout(blocks,650,300))
        self.assertEqual([(item['name'],item['quantity'],item['totalPrice']) for item in parsed['items']],
          [('REAL GANACHE',1,16500.0),('EGG TART',1,13000.0)])
        self.assertEqual(parsed['grandTotal'],29500.0)

    def test_context_repairs_thermal_print_one_read_as_seven(self):
        items=[{'name':'Chicken','quantity':1,'unitPrice':4.0,'totalPrice':4.0,'unitPriceInferred':True,'needsReview':False},
          {'name':'White Rice','quantity':7,'unitPrice':2.57,'totalPrice':18.0,'unitPriceInferred':True,'needsReview':False},
          {'name':'Vege','quantity':1,'unitPrice':8.0,'totalPrice':8.0,'unitPriceInferred':True,'needsReview':False},
          {'name':'Drink','quantity':1,'unitPrice':5.0,'totalPrice':5.0,'unitPriceInferred':True,'needsReview':False}]
        _recover_quantity_outliers(items);rice=items[1]
        self.assertEqual(rice['quantity'],1);self.assertEqual(rice['unitPrice'],18.0)
        self.assertTrue(rice['needsReview']);self.assertEqual(rice['recoveryReason'],'QUANTITY_1_VS_7_CONTEXT')

    def test_real_receipt_layout_and_math(self):
        fixture=ROOT.parent/'debug'/'raw_ocr.json'
        if not fixture.exists():self.skipTest('Local OCR fixture is intentionally excluded from source control.')
        raw=json.loads(fixture.read_text(encoding='utf-8'));blocks=[]
        for index,t in enumerate(raw['tokens']):
            blocks.append({'id':index,'text':t['text'],'confidence':t['confidence']/100,'x':t['x'],'y':t['y'],'width':t['width'],'height':t['height'],
              'centerX':t['x']+t['width']/2,'centerY':t['y']+t['height']/2,'polygon':[]})
        layout=reconstruct_layout(blocks,max(b['x']+b['width'] for b in blocks),max(b['y']+b['height'] for b in blocks));parsed=parse(layout);validation=validate_and_repair(parsed,layout)
        self.assertEqual(len(parsed['items']),10);self.assertEqual(sum(i['totalPrice'] for i in parsed['items']),208)
        self.assertEqual(parsed['serviceCharge'],20.8);self.assertEqual(parsed['tax'],13.73);self.assertEqual(parsed['grandTotal'],242.55);self.assertTrue(validation['valid'])
        self.assertFalse(any('Service' in item['name'] or 'Total' in item['name'] for item in parsed['items']))

if __name__=='__main__':unittest.main()
