const {test}=require('node:test');const assert=require('node:assert/strict');
const {handle,report,buttons}=require('./file-activity');
const scope='group:C'+'a'.repeat(32),uid='U'+'b'.repeat(32),id='12345678-1234-1234-1234-123456789abc';
function fixture(){const rows=[],replies=[];const deps={supabaseRequest:async(p,o={})=>{if(o.method==='POST'){rows.push(...JSON.parse(o.body));return [];}if(p.includes('metadata->>kind'))return rows;return [{id,scope_id:scope,file_name:'cost.xlsx',storage_bucket:'private',storage_path:'file'}];},getLineProfile:async()=>({displayName:'ปาน'}),createSupabaseSignedUrl:async()=> 'https://example.com/signed',replyMessage:async(t,s)=>{replies.push(s);}};return {deps,rows,replies};}
const event=action=>({type:'postback',webhookEventId:'event1',replyToken:'reply',source:{type:'group',groupId:scope.slice(6),userId:uid},postback:{data:'ttmfile:'+action+':'+id}});
test('only explicit same-group postbacks record user identity, never ordinary messages',async()=>{
 const f=fixture();assert.equal(await handle({type:'message'},f.deps),false);await handle(event('request'),f.deps);assert.equal(f.rows.length,1);assert.equal(f.rows[0].metadata.action,'request');assert.equal(f.rows[0].line_user_id,uid);assert.match(f.replies[0],/https:\/\/example/);
});
test('request and user acknowledgment remain separate; duplicate clicks count one person',async()=>{
 const f=fixture();await handle(event('request'),f.deps);await handle(event('request'),f.deps);let r=await report(f.deps,scope,id);assert.equal(r.requested.length,1);assert.equal(r.acknowledged.length,0);
 await handle(event('ack'),f.deps);r=await report(f.deps,scope,id);assert.equal(r.acknowledged.length,1);assert.equal(r.acknowledged[0].name,'ปาน');
});
test('cross-group, missing identity and malformed payload cannot record or disclose a file',async()=>{
 const f=fixture();const e=event('request');e.source.groupId='C'+'c'.repeat(32);await assert.rejects(handle(e,f.deps),/not found/);assert.equal(f.rows.length,0);
 const missing=event('ack');delete missing.source.userId;await assert.rejects(handle(missing,f.deps),/Invalid/);
});
test('persistence failure never acknowledges a reader or returns a download link',async()=>{
 const f=fixture();const original=f.deps.supabaseRequest;f.deps.supabaseRequest=async(p,o)=>{if(o?.method==='POST')throw Error('unavailable');return original(p,o);};await assert.rejects(handle(event('request'),f.deps),/unavailable/);assert.equal(f.replies.length,0);
});
test('report is scoped and says activity, not automatic read status',async()=>{const f=fixture();await handle(event('ack'),f.deps);await handle(event('report'),f.deps);assert.match(f.replies.at(-1),/ไม่ใช่สถานะอ่านข้อความ LINE/);const b=buttons(id);assert.equal(b.template.actions.length,3);for(const a of b.template.actions)assert.ok(a.label.length<=20);assert.ok(b.template.text.length<=160);});
