const {test}=require('node:test');
const assert=require('node:assert/strict');
const {run}=require('./bridge-smoke-test');
const scope='group:C'+'a'.repeat(32),testId='abcd1234-1234-1234-1234-123456789abc',fileId='bbbb1234-1234-1234-1234-123456789abc';
test('opt-in smoke test sends one labeled image and persists acceptance across restarts',async()=>{
 let receipt=null,pushes=[];
 const deps={
  supabaseRequest:async(path,options)=>{
   if(options.method==='POST'){receipt={...JSON.parse(options.body)[0],created_at:new Date().toISOString()};return [];}
   if(options.method==='PATCH'){receipt.metadata=JSON.parse(options.body).metadata;return [];}
   if(path.includes('id=eq.'+testId))return receipt?[receipt]:[];
   return [{id:fileId,scope_id:scope,mime_type:'image/png',file_name:'test.png',storage_bucket:'bucket',storage_path:'test'}];
  },
  createTestImage:async()=>Buffer.from('image'),
  uploadSupabaseFile:async()=>({bucket:'bucket',storagePath:'test'}),
  downloadSupabaseFile:async()=>Buffer.from('image'),
  saveFileMemory:async()=>{},
  createSupabaseSignedUrl:async()=> 'https://storage.example/test',
  fetch:async(url,options)=>{pushes.push(JSON.parse(options.body));return {ok:true,status:200};}
 };
 const config={TTM_BRIDGE_SMOKE_TEST_ID:testId,TTM_BRIDGE_SMOKE_TEST_SCOPE:scope,LINE_CHANNEL_ACCESS_TOKEN:'test'};
 assert.equal((await run(deps,config)).accepted,true);
 assert.equal(receipt.metadata.state,'accepted');
 assert.equal((await run(deps,config)).reason,'already_accepted');
 assert.equal(pushes.length,1);
 assert.equal(pushes[0].to,scope.slice(6));
 assert.match(pushes[0].messages[0].text,/ทดสอบระบบ Art TTM/);
 assert.equal(pushes[0].messages[1].type,'image');
});
test('no configured test does nothing; expired unfinished receipt cannot resend',async()=>{
 assert.deepEqual(await run({},{}),{skipped:true});
 let pushed=false;
 await assert.rejects(run({supabaseRequest:async()=>[{metadata:{kind:'chatgpt_bridge_smoke_test',state:'prepared'},created_at:'2026-01-01T00:00:00Z'}],fetch:async()=>{pushed=true;}},{TTM_BRIDGE_SMOKE_TEST_ID:testId,TTM_BRIDGE_SMOKE_TEST_SCOPE:scope}),/manual review/);
 assert.equal(pushed,false);
});
