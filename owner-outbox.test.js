const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOutbox}=require('./owner-outbox');
const scope='group:C'+'a'.repeat(32),id='12345678-1234-1234-1234-123456789abc';
function fixture(change={},options={}){
 const job={id,scope_id:scope,kind:'text',payload:{text:'พี่โจ พี่หัต ถึงบ้านกันหรือยังครับ'},authorized_by:'owner_explicit_chatgpt',authorization_note:'Explicit owner request',status:'pending',expires_at:new Date(Date.now()+60000).toISOString(),...change};
 let sends=0;const patches=[];
 const deps={supabaseRequest:async(path,o={})=>{
  if(o.method==='PATCH'){
   const data=JSON.parse(o.body);patches.push(data);
   if(path.includes('status=eq.pending')){if(job.status!=='pending')return [];job.status='sending';return [{...job}];}
   if(options.receiptFailure&&data.status==='accepted')throw Error('receipt unavailable');
   Object.assign(job,data);return [];
  }
  if(path.startsWith('ttm_group_registry'))return options.unregistered?[]:[{scope_id:scope}];
  return job.status==='pending'?[{...job}]:[];
 },fetch:async(url,o)=>{
  if(url.endsWith('/summary'))return {ok:!options.preflightFailure,status:403,json:async()=>({groupId:scope.slice(6)})};
  sends++;assert.equal(o.headers['X-Line-Retry-Key'],id);
  return {ok:!options.sendFailure,status:options.sendFailure?429:200};
 }};
 return {job,patches,get sends(){return sends},outbox:createOutbox(deps,{LINE_CHANNEL_ACCESS_TOKEN:'test-token'})};
}
test('explicit text reaches only registered exact group; terminal receipt stops resend',async()=>{
 const f=fixture();await f.outbox.tick();await f.outbox.tick();assert.equal(f.sends,1);assert.equal(f.job.status,'accepted');assert.equal(f.job.result.delivery_confirmed,false);
});
test('expired, unauthorized and unregistered requests never send',async()=>{
 for(const f of [fixture({expires_at:'2020-01-01'}),fixture({authorized_by:'other'}),fixture({}, {unregistered:true})]){
  await f.outbox.tick();assert.equal(f.sends,0);assert.equal(f.job.status,'failed');
 }
});
test('preflight or LINE rejection records failure and never auto retries',async()=>{
 for(const options of [{preflightFailure:true},{sendFailure:true}]){
  const f=fixture({},options);await f.outbox.tick();await f.outbox.tick();assert.equal(f.job.status,'failed');assert.equal(f.sends,options.sendFailure?1:0);
 }
});
test('accepted push with receipt failure stays sending, without second push',async()=>{
 const f=fixture({}, {receiptFailure:true});await assert.rejects(f.outbox.tick(),/reconciliation/);assert.equal(f.job.status,'sending');await f.outbox.tick();assert.equal(f.sends,1);
});
test('concurrent worker calls cannot claim and send twice',async()=>{
 const f=fixture();await Promise.all([f.outbox.tick(),f.outbox.tick()]);assert.equal(f.sends,1);
});
