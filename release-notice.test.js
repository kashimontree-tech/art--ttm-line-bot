const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {broadcast,RELEASE}=require('./release-notice');
const id='C'+'a'.repeat(32);
function fixture({quota=1000,member=true,health=true,pushStatus=200}={}){
 let state='pending',detail='owner_authorized_queued',pushes=0;
 const supabaseRequest=async(p,o)=>{
  if(o.method==='GET')return state==='pending'&&detail==='owner_authorized_queued'?[{scope_id:'group:'+id,group_name:'mock'}]:[];
  const b=JSON.parse(o.body);state=b.status;detail=b.detail;
  return [{scope_id:'group:'+id}];
 };
 const fetchImpl=async(url,o={})=>{
  if(url.includes('/health'))return {ok:true,json:async()=>({release:health?RELEASE:'old'})};
  if(url.endsWith('/summary'))return {ok:member,status:404,json:async()=>({groupId:id})};
  if(url.endsWith('/members/count'))return {ok:true,json:async()=>({count:5})};
  if(url.endsWith('/consumption'))return {ok:true,json:async()=>({totalUsage:100})};
  if(url.endsWith('/quota'))return {ok:true,json:async()=>({type:'limited',value:quota})};
  if(url.endsWith('/push')){pushes++;return {ok:pushStatus===200,status:pushStatus};}
  throw Error('unexpected URL');
 };
 return {args:{supabaseRequest,fetchImpl,wait:async()=>{},token:'mock'},get pushes(){return pushes},get state(){return state}};
}
test('send once; restart never repeats',async()=>{const f=fixture();assert.equal((await broadcast(f.args)).sent,1);await broadcast(f.args);assert.equal(f.pushes,1);assert.equal(f.state,'sent')});
test('not currently a member: no push',async()=>{const f=fixture({member:false});await broadcast(f.args);assert.equal(f.pushes,0);assert.equal(f.state,'failed')});
test('insufficient quota: no push',async()=>{const f=fixture({quota:100});await broadcast(f.args);assert.equal(f.pushes,0)});
test('old public release: no push',async()=>{const f=fixture({health:false});await assert.rejects(broadcast(f.args),/not publicly verified/);assert.equal(f.pushes,0)});
test('429 is recorded, not retried',async()=>{const f=fixture({pushStatus:429});await broadcast(f.args);await broadcast(f.args);assert.equal(f.pushes,1);assert.equal(f.state,'failed')});
test('generic audio/video never call OpenAI; documents record read or failed',async()=>{
 const src=fs.readFileSync(__dirname+'/server.js','utf8');
 const start=src.indexOf('async function processFileEvent('),end=src.indexOf('\nasync function saveFileMemory',start);
 for(const [name,mime,ok,expected,calls] of [['x.MP4','application/octet-stream',true,'failed',0],['x.bin','audio/wav',true,'failed',0],['x.pdf','application/pdf',true,'read',1],['x.pdf','application/pdf',false,'failed',1]]){
  let ai=0,audit,archived=0;
  const context={console:{error(){}},process:{env:{}},CLEAN_OPENAI_KEY:'mock',getScopeId:()=> 'group:mock',getLineDisplayName:async()=> 'mock',honorificName:x=>x,downloadLineContent:async()=>({bytes:Buffer.from('test'),mime}),cacheLiveFile(){},uploadSupabaseFile:async()=>({bucket:'mock',storagePath:'mock'}),saveFileMemory:async()=>{archived++},markAttachment:async()=>{},markImageAnalysis:async(e,s)=>{audit=s},uploadOpenAIFile:async()=>{ai++;return {id:'mock'}},fetch:async()=>({ok,status:503,text:async()=> 'mock upstream failure',json:async()=>({})}),extractOutputText:()=> 'mock summary',knowledgeUpdates:{updateAttachmentSummary:async()=>{}},supabaseRequest:async()=>{},saveMessage:async()=>{},replyMessage:async()=>{throw Error('No LINE sends in internal tests')}};
  vm.createContext(context);vm.runInContext(src.slice(start,end)+';globalThis.run=processFileEvent;',context);
  await context.run({source:{},message:{id:'mock',fileName:name}},true);
  assert.equal(ai,calls);assert.equal(audit,expected);assert.equal(archived,1);
 }
});
