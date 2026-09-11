const LABELS = ['ITEM_NAME','QUANTITY','UNIT_PRICE','LINE_TOTAL','SUBTOTAL','SERVICE_CHARGE','TAX','DISCOUNT','ROUNDING','GRAND_TOTAL','OTHER'];
const ITEM_LABELS = new Set(['ITEM_NAME','QUANTITY','UNIT_PRICE','LINE_TOTAL']);
const state = { receipts: [], statuses: {}, index: 0, payload: null, assignments: [], items: [], selected: new Set(), status: 'draft', dirty: false };
const $ = selector => document.querySelector(selector);
const labelSelect = $('#labelSelect');
LABELS.forEach(label => labelSelect.append(new Option(label.replaceAll('_',' '), label)));

function toast(message) { const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2200); }
function assignmentFor(tokenId) { return state.assignments.find(assignment => assignment.tokenIds.includes(tokenId)); }
function itemName(itemId) { return state.items.find(item => item.id===itemId)?.id || ''; }
function setDirty(value=true) { state.dirty=value; }
function updateSelected() { $('#selectedCount').textContent=`${state.selected.size} selected`; }
function updateStatus() { const badge=$('#statusBadge');badge.textContent=state.status.toUpperCase();badge.className=`status ${state.status}`; }

function renderItems() {
  const select=$('#itemSelect'),current=select.value;select.innerHTML='<option value="">Not an item field</option>';
  state.items.forEach(item=>select.append(new Option(item.id,item.id)));if([...select.options].some(option=>option.value===current))select.value=current;
  $('#groupCount').textContent=`${state.items.length} groups`;
  const list=$('#groupList');list.replaceChildren();
  state.items.forEach(item=>{
    const card=document.createElement('div');card.className='group-card';
    const fields=state.assignments.filter(a=>a.itemId===item.id).map(a=>`${a.label}: ${a.text}`).join(' · ')||'No fields assigned yet';
    card.innerHTML=`<strong>${item.id}</strong><div></div>`;card.querySelector('div').textContent=fields;list.append(card);
  });
}

function renderTokens() {
  const list=$('#tokenList'),overlay=$('#boxOverlay');list.replaceChildren();overlay.replaceChildren();
  const tokens=state.payload.tokens,maxX=Math.max(1,...tokens.flatMap(token=>token.polygon.map(point=>point[0]))),maxY=Math.max(1,...tokens.flatMap(token=>token.polygon.map(point=>point[1])));
  overlay.setAttribute('viewBox',`0 0 ${maxX} ${maxY}`);overlay.setAttribute('preserveAspectRatio','none');
  for(const token of tokens){
    const assignment=assignmentFor(token.id),selected=state.selected.has(token.id);
    const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('points',token.polygon.map(point=>point.join(',')).join(' '));polygon.dataset.tokenId=token.id;polygon.classList.toggle('selected',selected);polygon.classList.toggle('labeled',Boolean(assignment));polygon.addEventListener('click',()=>toggleToken(token.id));const title=document.createElementNS(polygon.namespaceURI,'title');title.textContent=`${token.id} · ${token.text} · ${assignment?.label||'UNLABELED'}`;polygon.append(title);overlay.append(polygon);
    const row=document.createElement('label');row.className=`token${selected?' selected':''}`;row.dataset.tokenId=token.id;
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected;checkbox.addEventListener('change',()=>toggleToken(token.id));
    const text=document.createElement('span'),code=document.createElement('code'),meta=document.createElement('small'),badge=document.createElement('span');code.textContent=token.text;meta.textContent=`${token.id} · x ${token.bbox.x}, y ${token.bbox.y}, w ${token.bbox.width}, h ${token.bbox.height}`;text.append(code,meta);badge.className=`label${assignment?'':' unlabeled'}`;badge.textContent=assignment?`${assignment.label}${assignment.itemId?` · ${assignment.itemId}`:''}`:'UNLABELED';row.append(checkbox,text,badge);list.append(row);
  }
  $('#labeledCount').textContent=`${state.payload.tokens.filter(token=>assignmentFor(token.id)).length} labeled`;
  updateSelected();renderItems();
}

function toggleToken(tokenId) { state.selected.has(tokenId)?state.selected.delete(tokenId):state.selected.add(tokenId);renderTokens(); }
function nextItemId(){let number=1;while(state.items.some(item=>item.id===`item-${String(number).padStart(3,'0')}`))number++;return `item-${String(number).padStart(3,'0')}`;}
function createItem(){const id=nextItemId();state.items.push({id,assignmentIds:[]});renderItems();$('#itemSelect').value=id;setDirty();toast(`Created ${id}`);return id;}

function removeTokensFromAssignments(tokenIds) {
  const remove=new Set(tokenIds);state.assignments=state.assignments.map(assignment=>({...assignment,tokenIds:assignment.tokenIds.filter(id=>!remove.has(id))})).filter(assignment=>assignment.tokenIds.length);
}
function nextAssignmentId(){let number=1;while(state.assignments.some(a=>a.id===`a${String(number).padStart(3,'0')}`))number++;return `a${String(number).padStart(3,'0')}`;}
function assignSelected(){
  const tokenIds=state.payload.tokens.filter(token=>state.selected.has(token.id)).map(token=>token.id);if(!tokenIds.length)return toast('Select at least one original OCR token.');
  const label=labelSelect.value;let itemId='';
  if(ITEM_LABELS.has(label)){itemId=$('#itemSelect').value;if(!itemId){$('#hint').textContent=`${label} requires an item group. Create or select one first.`;$('#hint').classList.add('error');return;}}
  removeTokensFromAssignments(tokenIds);const same=state.assignments.find(a=>a.label===label&&(a.itemId||'')===itemId);
  if(same){same.tokenIds=[...new Set([...same.tokenIds,...tokenIds])];same.text=same.tokenIds.map(id=>state.payload.tokens.find(token=>token.id===id)?.text||'').join(' ');}else state.assignments.push({id:nextAssignmentId(),label,tokenIds,text:tokenIds.map(id=>state.payload.tokens.find(token=>token.id===id)?.text||'').join(' '),...(itemId?{itemId}:{})});
  state.selected.clear();setDirty();$('#hint').textContent='Assignment updated locally. Save when this receipt is complete.';$('#hint').classList.remove('error');renderTokens();
}
function unassignSelected(){if(!state.selected.size)return toast('Select tokens to clear.');removeTokensFromAssignments([...state.selected]);state.selected.clear();setDirty();renderTokens();}

async function save(status='complete') {
  if(status==='complete'&&!state.assignments.length)return toast('Assign at least one field, or use Skip / Mark Unclear.');
  const key=state.receipts[state.index].key;
  const response=await fetch(`/api/annotation?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,assignments:state.assignments,items:state.items,notes:$('#notes').value})});
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Unable to save.');
  state.assignments=body.assignments;state.items=body.items;state.status=body.status;state.statuses[key]=body.status;setDirty(false);updateStatus();renderReceiptOptions();renderTokens();toast(status==='complete'?'Annotation saved.':status==='unclear'?'Marked unclear.':'Receipt skipped.');
}

function renderReceiptOptions(){const select=$('#receiptSelect'),current=state.receipts[state.index]?.key;select.replaceChildren();state.receipts.forEach((receipt,index)=>{const mark={complete:'✓',unclear:'?',skipped:'–'}[state.statuses[receipt.key]]||'○';select.append(new Option(`${mark} ${receipt.split}/${receipt.id}`,String(index)))});select.value=String(state.index);if(current){const values=Object.values(state.statuses),complete=values.filter(value=>value==='complete').length,unclear=values.filter(value=>value==='unclear').length,processed=values.filter(value=>value!=='unlabeled').length;$('#datasetSummary').textContent=`${processed} processed · ${complete} complete · ${unclear} unclear · ${state.receipts.length} receipts`;}}
async function navigate(index){
  if(state.dirty&&!confirm('Discard unsaved changes for this receipt?'))return;
  state.index=Math.max(0,Math.min(state.receipts.length-1,index));const receipt=state.receipts[state.index];
  const response=await fetch(`/api/receipt?key=${encodeURIComponent(receipt.key)}`);if(!response.ok)throw new Error('Unable to load receipt.');state.payload=await response.json();
  const saved=state.payload.annotation;state.assignments=saved?.assignments?structuredClone(saved.assignments):[];state.items=saved?.items?structuredClone(saved.items):[];state.status=saved?.status||'draft';state.selected.clear();state.dirty=false;
  $('#position').textContent=`${state.index+1} / ${state.receipts.length}`;$('#receiptTitle').textContent=`${receipt.split.toUpperCase()} · ${receipt.id}`;$('#entities').textContent=JSON.stringify(state.payload.entities,null,2);$('#notes').value=saved?.notes||'';$('#receiptImage').src=state.payload.imageUrl;$('#previous').disabled=state.index===0;$('#next').disabled=state.index===state.receipts.length-1;renderReceiptOptions();updateStatus();renderTokens();
}

$('#newItem').addEventListener('click',createItem);$('#assign').addEventListener('click',assignSelected);$('#unassign').addEventListener('click',unassignSelected);$('#save').addEventListener('click',()=>save('complete').catch(error=>toast(error.message)));$('#skip').addEventListener('click',()=>save('skipped').catch(error=>toast(error.message)));$('#unclear').addEventListener('click',()=>save('unclear').catch(error=>toast(error.message)));$('#previous').addEventListener('click',()=>navigate(state.index-1));$('#next').addEventListener('click',()=>navigate(state.index+1));$('#receiptSelect').addEventListener('change',event=>navigate(Number(event.target.value)));$('#notes').addEventListener('input',()=>setDirty());window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});

try { const response=await fetch('/api/index');const index=await response.json();if(!response.ok)throw new Error(index.error||'Unable to index dataset.');state.receipts=index.receipts;state.statuses=index.statuses;renderReceiptOptions();await navigate(0); } catch(error){ $('#datasetSummary').textContent='Dataset unavailable';$('#receiptTitle').textContent=error.message;console.error(error); }
