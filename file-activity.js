// Called only for signature-verified LINE webhook events. No public write route.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function fileOf(deps,scope,id){
 if(!/^group:C[a-f0-9]{32}$/i.test(scope)||!uuid.test(id))throw Error('Invalid file activity scope');
 const rows=await deps.supabaseRequest('line_memories?select=id,file_name,scope_id,storage_bucket,storage_path&id=eq.'+id+'&scope_id=eq.'+encodeURIComponent(scope)+'&limit=1',{method:'GET'});
 const f=rows?.[0];if(!f?.storage_path||!f.storage_bucket||f.scope_id!==scope)throw Error('Stored original not found in this group');return f;
}
function buttons(id){
 return {type:'template',altText:'ติดตามการขอลิงก์และยืนยันอ่านไฟล์ (ไม่ใช่สถานะอ่าน LINE)',template:{type:'buttons',text:'ปุ่มขอลิงก์จะบันทึกชื่อบัญชี LINE ผู้กด ส่วนยืนยันอ่านแล้วเป็นคำยืนยันของผู้กด ไม่ใช่การตรวจอ่านอัตโนมัติ',actions:[
 {type:'postback',label:'ขอลิงก์และบันทึกชื่อ',data:'ttmfile:request:'+id},
 {type:'postback',label:'ยืนยันอ่านแล้ว',data:'ttmfile:ack:'+id},
 {type:'postback',label:'ดูรายชื่อและจำนวน',data:'ttmfile:report:'+id}
 ]}};
}
async function report(deps,scope,id){
 const f=await fileOf(deps,scope,id);
 const rows=await deps.supabaseRequest('line_memories?select=line_user_id,display_name,created_at,metadata&scope_id=eq.'+encodeURIComponent(scope)+'&metadata->>kind=eq.file_activity_v1&metadata->>file_id=eq.'+id+'&order=created_at.asc&limit=1000',{method:'GET'});
 const requested=new Map(),acknowledged=new Map();
 for(const r of rows||[]){if(!r.line_user_id)continue;const m=r.metadata?.action==='request'?requested:r.metadata?.action==='ack'?acknowledged:null;if(m&&!m.has(r.line_user_id))m.set(r.line_user_id,{user_id:r.line_user_id,name:r.display_name||'ไม่ทราบชื่อ',at:r.created_at});}
 return {file_id:id,name:f.file_name,requested:[...requested.values()],acknowledged:[...acknowledged.values()],limited:(rows||[]).length>=1000,note:'Requested link is not proof of download or reading; acknowledgment is user-reported, not a LINE read receipt.'};
}
async function handle(event,deps){
 if(event.type!=='postback'||!String(event.postback?.data||'').startsWith('ttmfile:'))return false;
 const match=String(event.postback.data).match(/^ttmfile:(request|ack|report):([a-f0-9-]{36})$/i);
 const src=event.source||{};
 if(!match||src.type!=='group'||!/^U[a-f0-9]{32}$/i.test(src.userId||'')||!event.replyToken)throw Error('Invalid file activity event');
 const scope='group:'+src.groupId,action=match[1],id=match[2],f=await fileOf(deps,scope,id);
 if(action==='report'){
  const r=await report(deps,scope,id),names=a=>a.slice(0,15).map(x=>x.name).join(', ')||'ยังไม่มี';
  await deps.replyMessage(event.replyToken,'ไฟล์ '+String(f.file_name).slice(0,160)+'\nกดขอลิงก์ '+r.requested.length+' คน: '+names(r.requested)+'\nยืนยันอ่านแล้ว '+r.acknowledged.length+' คน: '+names(r.acknowledged)+'\nรายชื่อแสดงสูงสุดสถานะละ 15 คน'+'\nเป็นข้อมูลการกดปุ่ม ไม่ใช่สถานะอ่านข้อความ LINE'+(r.limited?'\nข้อมูลจำกัด 1,000 เหตุการณ์ล่าสุด':'') );return true;
 }
 const profile=await deps.getLineProfile(src,src.userId);
 const name=String(profile?.displayName||'ไม่ทราบชื่อ').slice(0,100);
 // Never count historical messages, previews, or bot fetches as readers.
 await deps.supabaseRequest('line_memories',{method:'POST',prefer:'return=minimal',body:JSON.stringify([{scope_id:scope,source_type:'group',group_id:src.groupId,line_user_id:src.userId,user_id:src.userId,display_name:name,message_type:'memory',text_content:action==='request'?'กดขอลิงก์ไฟล์':'ผู้ใช้ยืนยันอ่านไฟล์แล้ว',metadata:{kind:'file_activity_v1',file_id:id,action,webhook_event_id:event.webhookEventId||null}}])});
 if(action==='request'){
  const url=await deps.createSupabaseSignedUrl(f.storage_bucket,f.storage_path,3600);
  await deps.replyMessage(event.replyToken,name+' กดขอลิงก์ไฟล์ '+String(f.file_name).slice(0,160)+'\n'+url+'\nลิงก์ใช้ได้ 1 ชั่วโมง การขอลิงก์ยังไม่ยืนยันว่าเปิดหรืออ่านไฟล์แล้ว');
 }else await deps.replyMessage(event.replyToken,'บันทึกคำยืนยันของ '+name+' ว่าอ่านไฟล์ '+String(f.file_name).slice(0,160)+' แล้ว');
 return true;
}
module.exports={buttons,handle,report};
