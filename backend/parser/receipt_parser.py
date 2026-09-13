import re
from statistics import median
from parser.layout import ALL_MONEY,MONEY,SUMMARY,money_value

META=re.compile(r'(?:invoice|receipt|table|pax|cashier|date|time|printed|tel|phone|address|sdn\s*bhd|registration|order|bill\b|email|@\w+\.com)',re.I)
HEADER=re.compile(r'^(?:qty|quantity|description|item|unit(?:\s*price)?|price|amount(?:\s*\(rm\))?|total)$',re.I)
NON_ITEM=re.compile(r'(?:disc(?:ount)?\s*item|promo(?:tion)?|amount\s*$|total\s+items?|items?\s+count)',re.I)
def _clean(text):
    # Strip debug/print row numbers only when glued to a known summary label;
    # values such as "3X" are real quantities and must remain intact.
    return re.sub(r'^\d{1,2}(?=(?:service|discount|sub|total|rounding|bill|sst|gst|tax|cash|change))','',text,flags=re.I).strip()
def _values(text,integer_money=False):
    if re.search(r'\d+(?:\.\d+)?\s*%',text):return []
    result=[]
    for match in (ALL_MONEY if integer_money else MONEY).finditer(text):
        try:result.append(money_value(match.group(0)))
        except ValueError:pass
    return result
def _quantity(text):
    match=re.search(r'(\d{0,2})(?:\.0+)?\s*@',text)
    if not match:match=re.search(r'\b(\d{1,2})\s*(?:x|\*)\b',text,re.I)
    if not match:return 1
    value=match.group(1);return max(1,min(50,int(value))) if value else 1
def _is_description(block,quantity_x):
    text=_clean(block['text'])
    return block['centerX']<(quantity_x or float('inf')) and bool(re.search(r'[A-Za-z\u4e00-\u9fff]',text)) and not SUMMARY.search(text) and not META.search(text) and not HEADER.match(text)
def _near_column(block,x,width):return x is not None and abs(block['centerX']-x)<=max(30,width*.075)

def _block_values(block,layout):
    values=_values(block['text'],layout.get('integerMoney',False))
    if values:return values
    # In integer-currency receipts a short value such as "9" or "0" is a
    # plausible amount only when geometry places it in a detected price column.
    text=block['text'].strip().replace(',','')
    columns=layout['columns'];width=layout['width']
    in_price_column=_near_column(block,columns.get('lineTotal'),width) or _near_column(block,columns.get('unitPrice'),width)
    if layout.get('integerMoney') and in_price_column and re.fullmatch(r'-?\d{1,2}',text):
        return [float(text)]
    return []

def _summary(rows,integer_money=False):
    result={'subtotal':None,'serviceCharge':None,'tax':None,'discount':None,'rounding':None,'grandTotal':None};totals=[]
    for row in rows:
        text=_clean(row['text']);values=_values(text,integer_money)
        if not values:continue
        value=values[-1];normal=re.sub(r'[^a-z]','',text.lower().replace('tota1','total'))
        if re.search(r'(?:subtotal|subtota1|totalexcludinggst|totalexcludingsst)',normal):result['subtotal']=value
        elif re.search(r'(?:servicecharge|servicecharges|servicechg|svccharge)',normal):result['serviceCharge']=value
        elif re.search(r'(?:discount|voucher|rebate)',normal):result['discount']=abs(value)
        elif 'rounding' in normal:result['rounding']=-value if re.search(r'-\s*(?:RM\s*)?\d',text,re.I) else value
        elif re.search(r'(?:gstpayable|sstpayable|servicetax|^sst|^gst|^tax)',normal) and not re.search(r'(?:id|no|summary)',normal):result['tax']=value
        elif re.search(r'(?:nettotal|netttotal|netto|grandtotal|grandttl|amountdue|billamount|totaldue|totalbayar)',normal):totals.append((3,row['centerY'],value))
        elif re.search(r'(?:totalinclusiveofgst|totalinclusiveofsst)',normal):totals.append((1,row['centerY'],value))
        elif 'total' in normal and not re.search(r'(?:totalitems?|totalqty|totalgst|totalsst|totaltax|totaldiscount|totalchange|totalcash)',normal):totals.append((2,row['centerY'],value))
    if totals:result['grandTotal']=max(totals,key=lambda x:(x[0],x[1]))[2]
    if result['tax'] is None and result['subtotal'] is not None and result['grandTotal'] is not None and result['serviceCharge'] is None:
        inferred=round(result['grandTotal']-result['subtotal']-(result['rounding'] or 0),2)
        if 0<=inferred<=result['subtotal']*.2:result['tax']=inferred
    return result

def _anchor_items(layout):
    blocks=[b for b in layout['blocks'] if layout['tableTop']<=b['centerY']<layout['summaryTop']]
    qx=layout['columns']['quantity'];ux=layout['columns']['unitPrice'];tx=layout['columns']['lineTotal'];h=layout['medianTextHeight'];width=layout['width']
    anchors=sorted([b for b in blocks if '@' in b['text'] and (qx is None or abs(b['centerX']-qx)<max(width*.1,h*2))],key=lambda b:b['centerY'])
    if len(anchors)<2:return [],set()
    descriptions=[b for b in blocks if _is_description(b,qx)];used=set();main=[]
    for anchor in anchors:
        candidates=[b for b in descriptions if b['id'] not in used and abs(b['centerY']-anchor['centerY'])<=h*1.35]
        chosen=min(candidates,key=lambda b:abs(b['centerY']-anchor['centerY']),default=None)
        if chosen:used.add(chosen['id']);main.append((anchor,chosen))
    items=[];used_ids=set()
    for index,(anchor,name_block) in enumerate(main):
        next_y=main[index+1][1]['centerY'] if index+1<len(main) else layout['summaryTop'];parts=[name_block]
        for block in descriptions:
            if block['id'] in used or block['centerY']<=name_block['centerY'] or block['centerY']>=next_y:continue
            if block['centerY']-name_block['centerY']<=h*1.35:parts.append(block);used.add(block['id'])
        nearby=[b for b in blocks if _values(b['text'],layout.get('integerMoney',False)) and abs(b['centerY']-anchor['centerY'])<=h*1.25]
        total_block=min((b for b in nearby if _near_column(b,tx,width)),key=lambda b:abs(b['centerY']-anchor['centerY']),default=None)
        unit_block=min((b for b in nearby if _near_column(b,ux,width) and b is not total_block),key=lambda b:abs(b['centerY']-anchor['centerY']),default=None)
        quantity=_quantity(anchor['text']);unit=(_values(unit_block['text'],layout.get('integerMoney',False))[-1] if unit_block else None);total=(_values(total_block['text'],layout.get('integerMoney',False))[-1] if total_block else None)
        if total is None and unit is not None:total=round(unit*quantity,2)
        if unit is None and total is not None:unit=round(total/quantity,2)
        if total is None:continue
        name=' '.join(_clean(b['text']) for b in sorted(parts,key=lambda b:b['centerY'])).strip()
        confidence=median([b['confidence'] for b in parts+[anchor]+([unit_block] if unit_block else [])+([total_block] if total_block else [])])
        layout_score=max(0,min(1,1-abs(name_block['centerY']-anchor['centerY'])/(h*2.4)))
        score=round(confidence*.65+layout_score*.35,4)
        ids={b['id'] for b in parts+[anchor]+([unit_block] if unit_block else [])+([total_block] if total_block else [])};used_ids|=ids
        items.append({'name':name[:100],'quantity':quantity,'unitPrice':unit,'totalPrice':total,'confidence':score,'needsReview':score<.72,'matchReason':'quantity_anchor','sourceBlockIds':sorted(ids)})
    return items,used_ids

def _row_items(layout):
    items=[];used=set();pending=[];pending_y=None
    h=layout['medianTextHeight'];width=layout['width'];columns=layout['columns'];tx=columns.get('lineTotal');ux=columns.get('unitPrice')
    for row in layout['rows']:
        if not layout['tableTop']<=row['centerY']<layout['summaryTop']:continue
        text=_clean(row['text'])
        if pending_y is not None and row['centerY']-pending_y>h*2.2:pending=[];pending_y=None
        if SUMMARY.search(text) or META.search(text) or HEADER.match(text) or NON_ITEM.search(text):pending=[];pending_y=None;continue
        priced=[block for block in row['blocks'] if _block_values(block,layout) and '%' not in block['text']]
        words=[block for block in row['blocks'] if not _block_values(block,layout) and re.search(r'[A-Za-z\u4e00-\u9fff]',block['text']) and not re.fullmatch(r'\s*(?:\d{1,2}\s*[xX*]|D|SR|ZRL|x)\s*',block['text'],re.I)]
        if not priced:
            if words:pending.extend(words);pending_y=row['centerY']
            continue
        total_block=min(priced,key=lambda block:(abs(block['centerX']-(tx if tx is not None else width)), -block['centerX']))
        # Text to the right of the selected total is normally a tax code or payment marker.
        words=[block for block in words if block['centerX']<total_block['centerX']]
        name_blocks=pending+words;pending=[];pending_y=None
        if not name_blocks:continue
        quantity=_quantity(text)
        if quantity==1:
            left_edge=min(block['centerX'] for block in name_blocks)
            quantity_blocks=[block for block in row['blocks'] if block['centerX']<left_edge and re.fullmatch(r'\s*\d{1,2}\s*',block['text'])]
            if quantity_blocks:quantity=max(1,min(50,int(quantity_blocks[-1]['text'].strip())))
        total=_block_values(total_block,layout)[-1]
        unit_block=min((block for block in priced if block is not total_block and _near_column(block,ux,width)),key=lambda block:abs(block['centerX']-(ux or 0)),default=None)
        unit=_block_values(unit_block,layout)[-1] if unit_block else round(total/quantity,2)
        ids={b['id'] for b in name_blocks+row['blocks']};used|=ids
        alignment=max(0,1-abs(total_block['centerY']-row['centerY'])/max(h*1.5,1));score=round((sum(b['confidence'] for b in name_blocks+[total_block])/len(name_blocks+[total_block]))*.75+alignment*.25,4)
        items.append({'name':' '.join(_clean(b['text']) for b in name_blocks)[:100],'quantity':quantity,'unitPrice':unit,'totalPrice':total,
                      'confidence':score,'needsReview':score<.72,'matchReason':'price_column_geometry','unitPriceInferred':unit_block is None,
                      'sourceBlockIds':sorted(ids)})
    return items,used

def _recover_quantity_outliers(items):
    # A standalone thermal-print "1" is commonly read as "7". Repair only
    # when the rest of the receipt strongly establishes quantity 1 and the
    # inferred cent price cannot reproduce the printed row total.
    if len(items)<3 or sum(item['quantity']==1 for item in items)<len(items)-1:return
    for item in items:
        quantity=item['quantity'];total_cents=round(item['totalPrice']*100)
        if quantity!=7 or not item.get('unitPriceInferred') or total_cents%quantity==0:continue
        item['quantityCandidates']=[{'value':7,'reason':'ocr'},{'value':1,'reason':'receipt_quantity_pattern'}]
        item['quantity']=1;item['unitPrice']=item['totalPrice'];item['needsReview']=True
        item['recoveryReason']='QUANTITY_1_VS_7_CONTEXT';item['matchReason']='quantity_context_recovery'

def parse(layout):
    summary=_summary(layout['rows'],layout.get('integerMoney',False));items,used=_anchor_items(layout)
    if not items:items,used=_row_items(layout)
    _recover_quantity_outliers(items)
    restaurant=next((_clean(r['text']) for r in layout['rows'][:6] if len(_clean(r['text']))>2 and not META.search(_clean(r['text'])) and not _values(r['text'],layout.get('integerMoney',False))), '')[:100]
    total_x=layout['columns'].get('lineTotal');width=layout['width']
    unmatched=[]
    for block in layout['blocks']:
        if block['id'] in used or not layout['tableTop']<=block['centerY']<layout['summaryTop']:continue
        if _block_values(block,layout) and _near_column(block,total_x,width):unmatched.append(block['id'])
    diagnostics={'strategy':'quantity_anchor' if items and items[0].get('matchReason')=='quantity_anchor' else 'price_column_geometry',
                 'unmatchedPriceBlockIds':unmatched,'unmatchedPriceCount':len(unmatched),'itemCount':len(items)}
    return {'restaurant':restaurant,'items':items,**summary,'usedBlockIds':sorted(used),'diagnostics':diagnostics}
