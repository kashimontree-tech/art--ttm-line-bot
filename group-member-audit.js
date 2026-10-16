// Enumerate accessible group members using LINE group members API.
const cmd=t=>/(?:อาร์ต|Art\s*TTM)\s*(?:ตรวจ|เช็ค|สรุป|ดึง|แสดง|ขอ)\s*(?:รายชื่อ|สมาชิก)(?:ทั้งหมด)?/iu.test(String(t||""));
async function run({event,scopeId,supabaseRequest}){
 if(event.source?.type!=="group"||!event.source?.groupId)return "คำสั่งตรวจรายชื่อใช้ใน LINE กลุ่มเท่านั้นครับ";
 const groupId=event.source.groupId,token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();
 let cursor="",ids=[],loops=0;
 try{
 do {
  const url="https://api.line.me/v2/bot/group/"+encodeURIComponent(groupId)+"/members/ids"+(cursor?"?start="+encodeURIComponent(cursor):"");
  const r=await fetch(url,{headers:{Authorization:"Bearer "+token}});
  if(!r.ok){
   const err=await r.text();
   if(r.status===403||r.status===404)return "LINE ไม่อนุญาตให้ดึงรายชื่อสมาชิกทั้งหมดของกลุ่มนี้ครับ ใช้วิธีให้สมาชิกส่งข้อความหรือ @แท็กเพื่อบันทึกชื่อแทนได้";
   throw Error("LINE members "+r.status+": "+err.slice(0,160));
  }
  const data=await r.json();ids.push(...(data.memberIds||[]));cursor=data.next||"";
  loops++;
 }while(cursor&&loops<8);
 const names=[];
 for(const id of [...new Set(ids)].slice(0,250)){
  const r=await fetch("https://api.line.me/v2/bot/group/"+encodeURIComponent(groupId)+"/member/"+encodeURIComponent(id),{headers:{Authorization:"Bearer "+token}});
  if(!r.ok)continue;
  const p=await r.json();const name=String(p.displayName||"").trim();if(!name)continue;
  // Preserve manually entered nickname; only refresh current profile fields.
  const existing=await supabaseRequest("line_members?select=ttm_name&line_user_id=eq."+encodeURIComponent(id)+"&limit=1",{method:"GET"});
  const now=new Date().toISOString();
  await supabaseRequest("line_members?on_conflict=line_user_id",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:JSON.stringify([{
   line_user_id:id,user_id:id,scope_id:scopeId,display_name:name,picture_url:p.pictureUrl||null,
   ...(existing?.[0]?.ttm_name?{ttm_name:existing[0].ttm_name}:{}),
   source_type:"group",group_id:groupId,last_seen_at:now,updated_at:now
  }])});
  names.push({name,alias:existing?.[0]?.ttm_name||null});
 }
 const missing=names.filter(x=>!x.alias);
 const listed=missing.slice(0,65).map((x,i)=>(i+1)+". "+x.name).join("\n");
 return "📇 ตรวจสมาชิก LINE กลุ่มแล้ว\nพบ "+names.length+" บัญชีที่ LINE เปิดให้เข้าถึง / ยังไม่มีชื่อเล่น "+missing.length+" บัญชี\n\n"+(listed||"สมาชิกที่พบมีชื่อเล่นแล้วทั้งหมด")+" \n\nให้แต่ละคนส่ง ‘อาร์ต เรียกพี่ว่า[ชื่อเล่น]’ หรือให้ผู้ดูแลแท็กบัญชีจริงพร้อมกำหนดชื่อเล่นครับ"+(cursor?"\nรายชื่ออาจยังไม่ครบ เพราะ LINE ส่งมาหลายหน้า":"");
 }catch(e){console.error("Member enumeration error:",e);return "ตรวจสมาชิกไม่สำเร็จครับ กรุณาลองอีกครั้งหรือตรวจสิทธิ์ LINE ของบอท";}
}
module.exports={cmd,run};