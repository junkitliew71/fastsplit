import re
from statistics import median

MONEY=re.compile(r'(?<![\d/])(?:(?:RM|MYR)\s*|\$\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d*[.,]\d{2})(?!\d|\s*%)',re.I)
ALL_MONEY=re.compile(r'(?<![\d/])(?:(?:RM|MYR)\s*|\$\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d*[.,]\d{2}|\d{3,})(?!\d|\s*%)',re.I)
SUMMARY=re.compile(r'(?:sub\s*total|subtotal|nett?\s*total|netto|grand\s*(?:total|ttl)|amount\s*due|bill\s*amount|(?:^|\s)total(?:\s|$)|total\s*(?:sales|belanja|bayar|amount|due)|service\s*(?:charge|chg|tax)|svc\s*charge|sst|gst|tax|discount|voucher|rounding|cash|change|paid|payment|visa|mastercard|credit\s*card|debit\s*card|touch\s*n\s*go|tng|duitnow)',re.I)

def money_value(value):
    raw=re.sub(r'(?i)(?:RM|MYR)|\$|\s','',value)
    if re.fullmatch(r'\d{1,3}(?:[.,]\d{3})+',raw):raw=raw.replace(',','').replace('.','')
    elif ',' in raw:raw=raw.replace(',','.') if re.search(r',\d{2}$',raw) else raw.replace(',','')
    return round(float(raw),2)

def _overlap(a,b):
    top=max(a['y'],b['y']); bottom=min(a['y']+a['height'],b['y']+b['height'])
    return max(0,bottom-top)/max(1,min(a['height'],b['height']))

def reconstruct_rows(blocks):
    if not blocks:return []
    typical=median([b['height'] for b in blocks if b['confidence']>=.35])
    rows=[]
    for block in sorted(blocks,key=lambda b:(b['centerY'],b['x'])):
        choices=[]
        for row in rows:
            gap=abs(row['centerY']-block['centerY']); overlap=max((_overlap(block,other) for other in row['blocks']),default=0)
            row_height=median([other['height'] for other in row['blocks']])
            # A loose overlap-only rule creates transitive chains that can merge
            # several neighbouring receipt lines into one giant row.
            close_centres=gap<=max(typical*.48,min(block['height'],row_height)*.55)
            strong_overlap=overlap>=.65 and gap<=typical*.75
            if close_centres or strong_overlap:choices.append((gap-overlap*typical*.25,row))
        if choices:row=min(choices,key=lambda value:value[0])[1]
        else:row={'blocks':[],'centerY':block['centerY']};rows.append(row)
        row['blocks'].append(block);row['centerY']=median([b['centerY'] for b in row['blocks']])
    result=[]
    for index,row in enumerate(sorted(rows,key=lambda r:r['centerY'])):
        words=sorted(row['blocks'],key=lambda b:b['x']);top=min(b['y'] for b in words)
        result.append({'index':index,'blocks':words,'centerY':round(row['centerY'],2),'y':top,
          'height':max(b['y']+b['height'] for b in words)-top,'text':' '.join(b['text'] for b in words),
          'confidence':round(sum(b['confidence'] for b in words)/len(words),4)})
    return result

def _cluster(values,tolerance):
    groups=[]
    for value in sorted(values):
        group=min(groups,key=lambda g:abs(sum(g)/len(g)-value),default=None)
        if group is not None and abs(sum(group)/len(group)-value)<=tolerance:group.append(value)
        else:groups.append([value])
    return sorted(({'x':round(sum(g)/len(g),2),'count':len(g)} for g in groups),key=lambda g:g['x'])

def reconstruct_layout(blocks,width=0,height=0):
    rows=reconstruct_rows(blocks);typical=median([b['height'] for b in blocks]) if blocks else 16
    grouped_amounts=sum(bool(re.search(r'(?<!\d)\d{1,3}(?:[.,]\d{3})+(?!\d)',b['text'])) for b in blocks)
    integer_money=grouped_amounts>=2
    money_pattern=ALL_MONEY if integer_money else MONEY
    money=[b for b in blocks if money_pattern.search(b['text']) and '%' not in b['text']];at=[b for b in blocks if '@' in b['text']]
    clusters=_cluster([b['centerX'] for b in money],max(18,width*.04));repeated=[c for c in clusters if c['count']>=2]
    total=max(repeated,key=lambda c:c['x'],default=max(clusters,key=lambda c:c['x'],default=None))
    unit=max((c for c in repeated if not total or c['x']<total['x']-width*.06),key=lambda c:c['x'],default=None)
    columns={'quantity':round(median([b['centerX'] for b in at]),2) if at else None,'unitPrice':unit['x'] if unit else None,
             'lineTotal':total['x'] if total else None,'priceClusters':clusters}
    header_rows=[]
    for row in rows:
        text=row['text'].lower();signals=sum(bool(re.search(pattern,text)) for pattern in (r'\b(?:qty|quantity)\b',r'\b(?:description|item)\b',r'\b(?:unit\s*)?price\b|\brsp\b',r'\b(?:amount|total)\b'))
        if signals>=2:header_rows.append(row)
    if header_rows:
        table_top=min(header_rows,key=lambda row:row['centerY'])['centerY']+typical*.08
    else:table_top=height*.3
    # Do not mistake a column header such as "Qty Description Total TAX" for
    # the payment summary. A real summary begins after at least one item row.
    summary=next((r for r in rows if r['centerY']>table_top+typical*1.5 and SUMMARY.search(r['text'])),None)
    return {'blocks':blocks,'rows':rows,'columns':columns,'medianTextHeight':round(typical,2),'width':width,'height':height,'integerMoney':integer_money,
            'tableTop':table_top,'summaryTop':summary['centerY'] if summary else height}
