// Explicit owner-authorized, queued release notice. No AI calls or send retries.
const CAMPAIGN="art_ttm_release_20261103_v1", RELEASE="20261103-media-guard";
const NOTICE=[
"แจ้งอัปเดต Art TTM ตามคำอนุญาตพี่เบนซ์ (3 พ.ย. 2569)",
"รอบนี้แก้ไม่ให้ไฟล์เสียง/วิดีโอที่ส่งแบบไฟล์ถูกส่งผิดเข้าเครื่องมืออ่านเอกสาร และเพิ่มบันทึกสถานะอ่านเอกสารสำเร็จ/ล้มเหลว เก็บไฟล์เดิมไว้ ไม่สั่ง AI ทำซ้ำอัตโนมัติ",
"ความสามารถเดิมที่มีคำสั่งรองรับ: ตอบ คำนวณ แปล สรุปข้อความ รูปและไฟล์ที่อ่านได้ ค้นไฟล์ในห้อง สร้าง Word/Excel/PowerPoint/PDF ถอดเสียง สร้างหรือแก้ภาพ และคลิปภาพนิ่งพร้อมเสียง ทั้งนี้ขึ้นกับชนิดไฟล์ ขนาด สิทธิ์และโควตา API",
"พิมพ์ อาร์ต ความสามารถ เพื่อดูหลักฐานและข้อจำกัดของห้องนี้ หรือ อาร์ต งานล่าสุด เพื่อตรวจสถานะงาน",
"ยังไม่เท่า ChatGPT ทุกด้าน ไม่ซิงก์แชตส่วนตัว ไม่ดึงประวัติก่อนบอตเข้ากลุ่ม ไม่รับรองการอ่านทุกไฟล์หรือความถูกต้องโดยไม่ตรวจทาน การค้นเว็บอัตโนมัติในการคุยทั่วไปยังไม่เปิดเพิ่มค่าใช้จ่าย",
"การแก้รอบนี้ผ่านการทดสอบภายในและตรวจรุ่นเซิร์ฟเวอร์ ไม่ใช่การทดสอบคำสั่งทุกชนิดผ่าน LINE จริง จะตรวจและพัฒนาต่อทุกวันศุกร์"
].join("\n\n");
async function broadcast({supabaseRequest,token,fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!token)throw Error("LINE token missing");
 const path="ttm_group_notice_receipts?campaign=eq."+CAMPAIGN;
 const queue=await supabaseRequest(path+"&status=eq.pending&detail=eq.owner_authorized_queued&select=scope_id,group_name",{method:"GET"});
 if(!queue?.length)return {sent:0};
 let live=false;
 for(let i=0;i<8;i++){
  await wait(15000);
  try{const r=await fetchImpl("https://art-ttm-line-bot.onrender.com/health",{signal:AbortSignal.timeout(10000)});
   if(r.ok&&(await r.json()).release===RELEASE){live=true;break;}
  }catch(_){}
 }
 if(!live)throw Error("Release not publicly verified; no notices sent");
 console.log("Release public health verified",RELEASE);
 const api=async endpoint=>{
  const r=await fetchImpl("https://api.line.me/v2/bot/"+endpoint,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error("LINE preflight "+r.status);
  return r.json();
 };
 let sent=0;
 for(const g of queue){
  if(!/^group:C[a-f0-9]{32}$/i.test(g.scope_id))continue;
  const id=g.scope_id.slice(6), row=path+"&scope_id=eq."+encodeURIComponent(g.scope_id);
  let claimed=false;
  try{
   const summary=await api("group/"+id+"/summary");
   if(summary.groupId!==id)throw Error("Group identity mismatch");
   const members=await api("group/"+id+"/members/count");
   const quota=await api("message/quota"), used=await api("message/quota/consumption");
   if(quota.type!=="limited"||!Number.isSafeInteger(quota.value)||!Number.isSafeInteger(used.totalUsage)||!Number.isSafeInteger(members.count)||members.count<1||quota.value-used.totalUsage<members.count+10)throw Error("Quota safety check failed; no send");
   const claim=await supabaseRequest(row+"&status=eq.pending&detail=eq.owner_authorized_queued",{method:"PATCH",prefer:"return=representation",body:JSON.stringify({status:"pending",detail:"claimed_no_automatic_retry",updated_at:new Date().toISOString()})});
   if(!claim?.length)continue;
   claimed=true;
   const r=await fetchImpl("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({to:id,messages:[{type:"text",text:NOTICE}]}),signal:AbortSignal.timeout(15000)});
   await supabaseRequest(row,{method:"PATCH",body:JSON.stringify({status:r.ok?"sent":"failed",http_status:r.status,detail:r.ok?"LINE accepted push; not proof of opening or capability test":"LINE rejected push; no automatic retry",updated_at:new Date().toISOString()})});
   if(r.ok)sent++;
   console.log("Release notice result",g.group_name,r.status);
  }catch(e){
   await supabaseRequest(row,{method:"PATCH",body:JSON.stringify({status:"failed",detail:String(e.message).slice(0,500),updated_at:new Date().toISOString()})});
   console.error("Release notice stopped",g.group_name,e.message);
  }
 }
 return {sent};
}
module.exports={CAMPAIGN,RELEASE,NOTICE,broadcast};
