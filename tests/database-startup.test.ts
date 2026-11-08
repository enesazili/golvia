import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retryDatabaseStartup} from '../src/server/database-startup.ts';

test('transient startup connection failures retry with bounded delays before releasing the startup gate',async t=>{
  const logs:unknown[][]=[];t.mock.method(console,'warn',(...args:unknown[])=>logs.push(args));
  let calls=0;const waits:number[]=[];
  const value=await retryDatabaseStartup(async()=>{calls++;if(calls===1)throw new Error('Connection terminated due to connection timeout');if(calls===2)throw Object.assign(new Error('reset'),{code:'ECONNRESET'});return 'recovered';},async ms=>{waits.push(ms);});
  assert.equal(value,'recovered');assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);assert.equal(logs.length,2);
});
test('startup stops after three transient failures and retains the original failure',async t=>{
  t.mock.method(console,'warn',()=>{});let calls=0;const failure=new Error('Connection terminated unexpectedly');
  await assert.rejects(retryDatabaseStartup(async()=>{calls++;throw failure;},async()=>{}),error=>error===failure);assert.equal(calls,3);
});
test('authentication, certificate, schema and SQL timeouts fail closed without retry',async()=>{
  for(const code of ['28P01','28000','42P01','57014','DEPTH_ZERO_SELF_SIGNED_CERT']){
    let calls=0;const failure=Object.assign(new Error('permanent'),{code});
    await assert.rejects(retryDatabaseStartup(async()=>{calls++;throw failure;},async()=>assert.fail('must not wait')),error=>error===failure);assert.equal(calls,1);
  }
});
test('first successful recovery runs once without a delay; nested connection causes are retried',async t=>{
  t.mock.method(console,'warn',()=>{});let calls=0;
  assert.equal(await retryDatabaseStartup(async()=>++calls,async()=>assert.fail('must not wait')),1);
  const result=await retryDatabaseStartup(async()=>{if(++calls===2)throw new Error('database unavailable',{cause:Object.assign(new Error('DNS temporary'),{code:'EAI_AGAIN'})});return 7;},async()=>{});
  assert.equal(result,7);assert.equal(calls,3);
});
test('startup diagnostics do not include connection secrets or raw database errors',async t=>{
  const logs:unknown[][]=[];t.mock.method(console,'warn',(...args:unknown[])=>logs.push(args));let calls=0;
  await retryDatabaseStartup(async()=>{if(++calls===1)throw new Error('Connection terminated unexpectedly postgresql://private:secret@example.invalid/db');},async()=>{});
  assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/secret|private|example\.invalid/);
});
