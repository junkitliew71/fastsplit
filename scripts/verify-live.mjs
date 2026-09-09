import { readFileSync } from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const url=process.env.VITE_FASTSPLIT_API_URL||readFileSync('.env.local','utf8').trim().split('=')[1];
const session='fs_'+randomBytes(32).toString('hex'),other='fs_'+randomBytes(32).toString('hex');
async function call(action,payload={},sessionId=session){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,sessionId,...payload}),redirect:'follow'});assert(response.ok,'HTTP request failed');return response.json();}
const data={requestId:randomUUID(),restaurant:'FastSplit verification — disposable',participants:[{id:'a',name:'Test A'},{id:'b',name:'Test B'}],items:[{id:'i',name:'Shared test item',quantity:1,unitPriceCents:1001}],itemUnits:[{id:'i:0',itemId:'i',name:'Shared test item',priceCents:1001,participantIds:['a','b']}],serviceChargeCents:100,taxCents:60,discountCents:10};
const created=await call('createReceipt',{data});assert(created.ok,created.error);const bill=created.data;console.log('PASS create receipt');
try{
assert.equal(bill.totalCents,1151);assert.equal(bill.settlements.reduce((s,p)=>s+p.finalTotalCents,0),1151);assert.equal(Date.parse(bill.expiresAt)-Date.parse(bill.createdAt),259200000);console.log('PASS exact cents and 72-hour server timestamps');
assert.equal((await call('createReceipt',{data})).data.id,bill.id);console.log('PASS idempotent retry');
const history=await call('history');assert(history.ok);assert.equal(history.data.length,1);assert.equal((await call('getReceipt',{receiptId:bill.id})).data.id,bill.id);console.log('PASS history and details');
assert.equal((await call('getReceipt',{receiptId:bill.id},other)).ok,false);assert.equal((await call('deleteReceipt',{receiptId:bill.id},other)).ok,false);assert.equal((await call('history',{},other)).data.length,0);console.log('PASS cross-session read/delete denial');
}finally{assert.equal((await call('deleteReceipt',{receiptId:bill.id})).ok,true);assert.equal((await call('history')).data.length,0);console.log('PASS deletion and refreshed empty history');}
