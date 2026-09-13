from statistics import mean
from parser.layout import ALL_MONEY,MONEY,SUMMARY,money_value

def validate_and_repair(parsed,layout):
    items=parsed['items'];warnings=[];subtotal=parsed.get('subtotal');grand=parsed.get('grandTotal')
    if not items:warnings.append({'type':'ITEM_WITHOUT_PRICE','message':'No reliable item and price pairs were found.'})
    unmatched=parsed.get('diagnostics',{}).get('unmatchedPriceCount',0)
    if unmatched:warnings.append({'type':'UNMATCHED_PRICE','message':f'{unmatched} price candidate(s) could not be matched to an item row.'})
    item_sum=round(sum(item['totalPrice'] for item in items),2)
    target=subtotal if subtotal is not None else (round(grand-(parsed.get('serviceCharge') or 0)-(parsed.get('tax') or 0)-(parsed.get('rounding') or 0)+(parsed.get('discount') or 0),2) if grand is not None else None)
    difference=round((target-item_sum),2) if target is not None else None
    # Use an exact subtotal difference only when an unused price has nearby text.
    if difference is not None and difference>.02:
        candidates=[];money_pattern=ALL_MONEY if layout.get('integerMoney',False) else MONEY
        for block in layout['blocks']:
            if block['id'] in parsed['usedBlockIds'] or SUMMARY.search(block['text']):continue
            values=[]
            for match in money_pattern.finditer(block['text']):
                try:values.append(money_value(match.group(0)))
                except ValueError:pass
            if any(abs(value-difference)<=.02 for value in values):
                names=[b for b in layout['blocks'] if b['id'] not in parsed['usedBlockIds'] and b['centerX']<block['centerX'] and abs(b['centerY']-block['centerY'])<=layout['medianTextHeight']*1.2 and any(c.isalpha() for c in b['text']) and b['text'].strip().upper() not in {'D','SR','ZRL'}]
                candidates.append((block,min(names,key=lambda b:abs(b['centerY']-block['centerY']),default=None)))
        if len(candidates)==1:
            price,name=candidates[0];label=name['text'][:100] if name else 'Unidentified item (check receipt)';score=round(min(price['confidence'],name['confidence'] if name else .55)*.8,4)
            source_ids=[price['id']]+([name['id']] if name else [])
            recovered_value=difference
            items.append({'name':label,'quantity':1,'unitPrice':recovered_value,'totalPrice':recovered_value,'confidence':score,'needsReview':True,'matchReason':'mathematical_recovery','sourceBlockIds':source_ids})
            parsed['usedBlockIds'] += source_ids;item_sum=round(item_sum+difference,2);difference=round(target-item_sum,2)
            warnings.append({'type':'POSSIBLE_MISSING_ITEM','message':f'Recovered a possible missing RM{recovered_value:.2f} item; its printed name is unreadable.' if not name else f'Recovered possible missing item {name["text"]} at RM{price["text"]}.'})
    service=parsed.get('serviceCharge') or 0;tax=parsed.get('tax') or 0;discount=parsed.get('discount') or 0;rounding=parsed.get('rounding') or 0
    calculated=round(item_sum-discount+service+tax+rounding,2);total_difference=round((grand-calculated),2) if grand is not None else None
    valid=(difference is None or abs(difference)<=.02) and (total_difference is None or abs(total_difference)<=.02)
    if difference is not None and abs(difference)>.02:warnings.append({'type':'POSSIBLE_MISSING_ITEM' if difference>0 else 'TOTAL_MISMATCH','message':f'Items differ from subtotal by RM{abs(difference):.2f}.'})
    if total_difference is not None and abs(total_difference)>.02:warnings.append({'type':'TOTAL_MISMATCH','message':f'Calculated total differs from printed total by RM{abs(total_difference):.2f}.'})
    for item in items:
        if item['needsReview']:warnings.append({'type':'LOW_CONFIDENCE_ITEM','message':f'Check the price mapping for {item["name"]}.'})
    validation_confidence=1.0 if valid else max(0,.65-min(abs(total_difference or difference or 0)/max(grand or target or 1,1),.65))
    return {'valid':valid,'itemSum':item_sum,'calculatedTotal':calculated,'subtotalDifference':difference,'grandTotalDifference':total_difference,
            'confidence':round(validation_confidence,4),'warnings':warnings}

def confidence_scores(quality,blocks,items,validation):
    ocr=mean([b['confidence'] for b in blocks]) if blocks else 0
    layout=mean([item['confidence'] for item in items]) if items else 0
    parser=max(0,min(1,layout*(1-min(1,len(validation['warnings'])/max(3,len(items)+1))*.25)))
    values={'ocrConfidence':round(ocr,4),'layoutConfidence':round(layout,4),'parserConfidence':round(parser,4),
            'validationConfidence':validation['confidence'],'imageQualityConfidence':quality['qualityScore']}
    values['overallConfidence']=round(values['ocrConfidence']*.2+values['layoutConfidence']*.2+values['parserConfidence']*.2+values['validationConfidence']*.3+values['imageQualityConfidence']*.1,4)
    return values
