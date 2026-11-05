const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createBridge,setup} = require('./chatgpt-file-bridge');
const scope = 'group:C' + 'a'.repeat(32), other = 'group:C' + 'b'.repeat(32);
const id = '12345678-1234-1234-1234-123456789abc';
const request_id = 'abcdef12-1234-1234-1234-123456789abc';
function fixture(overrides = {}, configuration = {}) {
  const calls = [], pushes = [];
  const file = {id,scope_id:scope,file_name:'cost.pdf',mime_type:'application/pdf',storage_bucket:'private',storage_path:'object'};
  const deps = {
    supabaseRequest:async path => {calls.push(path); return path.startsWith('ttm_group_registry') ? [{scope_id:scope,group_name:'TTM'},{scope_id:other,group_name:'Other'}] : [file];},
    createSupabaseSignedUrl:async () => 'https://storage.example/signed',
    uploadSupabaseFile:async () => ({bucket:'private',storagePath:'object'}),
    downloadSupabaseFile:async () => Buffer.from('hello'),
    saveFileMemory:async () => {},
    fetch:async (url,options) => {pushes.push({url,...options});return {ok:true,status:200};},
    ...overrides
  };
  const config = {TTM_CHATGPT_BRIDGE_TOKEN:'t'.repeat(40),TTM_CHATGPT_BRIDGE_SCOPES:JSON.stringify([scope]),LINE_CHANNEL_ACCESS_TOKEN:'test-token',...configuration};
  return {bridge:createBridge(deps,config),deps,config,calls,pushes,file};
}
test('bridge fails closed without token or valid explicit scopes', () => {
  for (const config of [{TTM_CHATGPT_BRIDGE_TOKEN:''},{TTM_CHATGPT_BRIDGE_SCOPES:'["*"]'},{TTM_CHATGPT_BRIDGE_SCOPES:'null'},{TTM_CHATGPT_BRIDGE_SCOPES:'invalid'}]) {
    const {bridge} = fixture({},config);
    assert.equal(bridge.enabled,false);
    assert.equal(bridge.authorize('Bearer ' + 't'.repeat(40)),false);
  }
  const {bridge} = fixture();
  assert.equal(bridge.authorize('Bearer ' + 't'.repeat(40)),true);
  assert.equal(bridge.authorize('Bearer incorrect'),false);
});
test('list exposes only allowed groups; denied file access makes no query', async () => {
  const {bridge,calls} = fixture();
  assert.deepEqual((await bridge.call('list_groups')).groups,[{scope_id:scope,group_name:'TTM'}]);
  calls.length = 0;
  await assert.rejects(bridge.call('get_file',{scope:other,id}),/allowlist/);
  assert.equal(calls.length,0);
});
test('paginated search escapes literal wildcards and rejects bad limits', async () => {
  const {bridge,calls} = fixture();
  await bridge.call('list_files',{scope,query:'25%_test*',offset:100,limit:20});
  assert.match(calls[0],/limit=20&offset=100/);
  assert.match(decodeURIComponent(calls[0]),/file_name=ilike\.%25\\%\\_test\\\*%/);
  await assert.rejects(bridge.call('list_files',{scope,limit:1000}),/pagination/);
});
test('download is group-bound, temporary, and never claims Library saved', async () => {
  const {bridge,calls} = fixture();
  const result = await bridge.call('get_file',{scope,id});
  assert.equal(result.expires_in,900);
  assert.equal(result.chatgpt_library_saved,false);
  assert.match(calls[0],/scope_id=eq.group%3A/);
  await assert.rejects(fixture({supabaseRequest:async()=>[{scope_id:other}]}).bridge.call('get_file',{scope,id}),/not found/);
});
test('import verifies stored bytes then indexes and returns a retrievable ID', async () => {
  const sequence=[];
  const {bridge} = fixture({uploadSupabaseFile:async()=>{sequence.push('upload');return {bucket:'private',storagePath:'object'};},downloadSupabaseFile:async()=>{sequence.push('readback');return Buffer.from('hello');},saveFileMemory:async()=>{sequence.push('index');}});
  const result = await bridge.call('import_file',{scope,name:'ต้นทุน.xlsx',base64:Buffer.from('hello').toString('base64')});
  assert.deepEqual(sequence,['upload','readback','index']);
  assert.deepEqual(result,{id,name:'ต้นทุน.xlsx',size:5,archive_saved:true,line_sent:false});
});
test('import refuses bad names, malformed base64, mismatched bytes, and missing index', async () => {
  const args={scope,name:'cost.pdf',base64:Buffer.from('hello').toString('base64')};
  await assert.rejects(fixture().bridge.call('import_file',{...args,name:'../cost.pdf'}),/filename/);
  await assert.rejects(fixture().bridge.call('import_file',{...args,base64:'????'}),/base64/);
  await assert.rejects(fixture().bridge.call('import_file',{...args,base64:'Zh=='}),/base64/);
  let indexed=false;
  await assert.rejects(fixture({downloadSupabaseFile:async()=>Buffer.from('corrupt'),saveFileMemory:async()=>{indexed=true;}}).bridge.call('import_file',args),/verification failed/);
  assert.equal(indexed,false);
  await assert.rejects(fixture({supabaseRequest:async()=>[]}).bridge.call('import_file',args),/index is unavailable/);
});
test('PDF sends a link to the exact group with a retry key, without claiming delivery', async () => {
  const {bridge,pushes} = fixture();
  const result=await bridge.call('send_file',{scope,id,request_id});
  assert.equal(result.mode,'download_link');
  assert.equal(result.delivery_confirmed,false);
  assert.equal(pushes[0].headers['X-Line-Retry-Key'],request_id);
  const body=JSON.parse(pushes[0].body);
  assert.equal(body.to,scope.slice(6));
  assert.equal(body.messages[0].type,'text');
});
test('small images send as native images; larger images use download links', async () => {
  for (const size of [100,1024*1024+1]) {
    const f=fixture({downloadSupabaseFile:async()=>Buffer.alloc(size)});
    f.file.mime_type='image/png';
    const result=await f.bridge.call('send_file',{scope,id,request_id});
    assert.equal(result.mode,size<=1024*1024?'image':'download_link');
  }
});
test('send errors never report success and rejected scope never reaches LINE', async () => {
  const f=fixture({fetch:async()=>({ok:false,status:429})});
  await assert.rejects(f.bridge.call('send_file',{scope,id,request_id}),/HTTP 429/);
  await assert.rejects(f.bridge.call('send_file',{scope:other,id,request_id}),/allowlist/);
  assert.equal(f.pushes.length,0);
  const retried=await fixture({fetch:async()=>({ok:false,status:409})}).bridge.call('send_file',{scope,id,request_id});
  assert.equal(retried.previously_accepted,true);
  assert.equal(retried.delivery_confirmed,false);
});
test('MCP transport authenticates, initializes, lists tools and sanitizes errors', async () => {
  const routes={};
  const app={post:(path,...handlers)=>{routes[path]=handlers;},get:()=>{},delete:()=>{}};
  const f=fixture({supabaseRequest:async()=>{throw Error('private-provider-secret');}});
  setup(app,{...f.deps,json:()=>function parser(){}},f.config);
  const [auth,,handler]=routes['/mcp/ttm-files'];
  const response=()=>({code:200,set(){return this;},status(c){this.code=c;return this;},json(v){this.value=v;return this;},sendStatus(c){this.code=c;return this;}});
  const denied=response();auth({get:()=>''},denied,()=>assert.fail('must not authorize'));
  assert.equal(denied.code,401);
  const r=response();await handler({body:{jsonrpc:'2.0',id:1,method:'initialize'}},r);
  assert.equal(r.value.result.serverInfo.name,'art-ttm-files');
  const list=response();await handler({body:{jsonrpc:'2.0',id:2,method:'tools/list'}},list);
  assert.equal(list.value.result.tools.length,7);
  const error=response();await handler({body:{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_groups'}}},error);
  assert.equal(error.value.result.isError,true);
  assert.doesNotMatch(JSON.stringify(error.value),/private-provider-secret/);
});
test('text-only sends resolve the exact group, validate text and reuse retry key',async()=>{
  const f=fixture();
  assert.equal((await f.bridge.call('send_text',{scope,text:'พี่แอ๋มครับ เป็นการทดสอบส่งรูปครับ',request_id})).accepted,true);
  const sent=JSON.parse(f.pushes[0].body);
  assert.deepEqual(sent,{to:scope.slice(6),messages:[{type:'text',text:'พี่แอ๋มครับ เป็นการทดสอบส่งรูปครับ'}]});
  assert.equal(f.pushes[0].headers['X-Line-Retry-Key'],request_id);
  await assert.rejects(f.bridge.call('send_text',{scope:other,text:'test',request_id}),/allowlist/);
  await assert.rejects(f.bridge.call('send_text',{scope,text:' ',request_id}),/message text/);
  assert.equal(f.pushes.length,1);
});
const mentionUser='U'+'c'.repeat(32);
test('mentions use textV2 after exact-group live member verification',async()=>{
 const f=fixture({fetch:async(url,o)=>{
  f.pushes.push({url,...o});
  return url.includes('/member/')?{ok:true,json:async()=>({userId:mentionUser})}:{ok:true,status:200};
 }});
 const args={scope,text:'{pan} อาร์ตแยกไฟล์แล้วค่ะ',request_id,mentions:[{key:'pan',user_id:mentionUser}]};
 assert.equal((await f.bridge.call('send_text',args)).accepted,true);
 assert.equal(f.pushes.length,2);assert.match(f.pushes[0].url,new RegExp('/group/'+scope.slice(6)+'/member/'+mentionUser+'$'));
 const body=JSON.parse(f.pushes[1].body);
 assert.equal(body.messages[0].type,'textV2');assert.deepEqual(body.messages[0].substitution.pan,{type:'mention',mentionee:{type:'user',userId:mentionUser}});
});
test('invalid, missing, repeated and all-members mention targets never push',async()=>{
 for(const [text,mentions] of [['{pan}',[]],['{pan}',[{key:'pan',user_id:'all'}]],['{other}',[{key:'pan',user_id:mentionUser}]],['{pan} {pan}',[{key:'pan',user_id:mentionUser}]],['{pan}',[{key:'pan',user_id:mentionUser},{key:'pan',user_id:mentionUser}]],['{broken',[{key:'pan',user_id:mentionUser}]]]){
  const f=fixture();await assert.rejects(f.bridge.call('send_text',{scope,text,request_id,mentions}),/Invalid mention/);assert.equal(f.pushes.length,0);
 }
});
test('inaccessible or mismatched member fails closed before push',async()=>{
 for(const response of [{ok:false,status:404},{ok:true,json:async()=>({userId:'U'+'d'.repeat(32)})}]){
  let pushed=false;const f=fixture({fetch:async(url)=>{if(url.endsWith('/push'))pushed=true;return response;}});
  await assert.rejects(f.bridge.call('send_text',{scope,text:'{pan}',request_id,mentions:[{key:'pan',user_id:mentionUser}]}),/LINE mention member/);assert.equal(pushed,false);
 }
});
