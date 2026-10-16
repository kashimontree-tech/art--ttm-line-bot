// One-time, explicitly owner-authorized capability notice to already registered LINE groups.
// Only a generic list of capabilities is broadcast. No group-specific or private data.
const CAMPAIGN="art_ttm_capabilities_20261017_v1";
const NOTICE=[
"📣 แจ้งอัปเดต Art TTM",
"สวัสดีครับ อาร์ตเป็นผู้ช่วย AI ของ TTM ใน LINE กลุ่มนี้",
"",
"ตอนนี้สามารถช่วยตอบคำถาม คำนวณงาน สรุปข้อความ/ประชุมที่บอทได้รับ จดจำชื่อเล่นสมาชิกที่ยืนยันตาม LINE User ID และช่วยค้นหา/จัดทำไฟล์ PDF, Excel ตามคำสั่งที่รองรับ",
"พิมพ์ “อาร์ต ความสามารถ” เพื่อดูความสามารถ หรือ “อาร์ต รายชื่อที่จำได้” เพื่อตรวจชื่อสมาชิกที่บอทพบในกลุ่มนี้",
"",
"ทุกกลุ่มใหม่ที่เชิญ Art TTM เข้า จะใช้งานคำสั่งเดียวกันได้ทันที โดยความจำและไฟล์ของแต่ละกลุ่มแยกกันตามสิทธิ์",
"หมายเหตุ: ฐานความรู้ ChatGPT ส่วนตัวกับ LINE ยังอยู่ระหว่างพัฒนาเชื่อมต่อ ไม่ได้ซิงก์ข้อมูลทั้งหมด และไม่มีการเปิดเผยข้อมูลส่วนตัวหรือข้ามกลุ่ม",
"By Art TTM"
].join("\n");
async function broadcast({supabaseRequest,token}){
  if(!token) throw Error("LINE channel access token missing");
  const groups=(await supabaseRequest("ttm_group_registry?select=scope_id,group_name&limit=100",{method:"GET"}))||[];
  for(const g of groups){
    const scope=String(g.scope_id||"");
    if(!/^group:C[a-f0-9]{32}$/i.test(scope)) continue;
    const id=scope.slice(6);
    const filter="campaign=eq."+encodeURIComponent(CAMPAIGN)+"&scope_id=eq."+encodeURIComponent(scope);
    try{
      const existing=(await supabaseRequest("ttm_group_notice_receipts?select=status&"+filter,{method:"GET"}))||[];
      if(existing.length) {console.log("Group notice previously attempted",g.group_name,existing[0].status);continue;}
      // Reserve before sending: restart must not duplicate a message.
      await supabaseRequest("ttm_group_notice_receipts",{method:"POST",prefer:"return=minimal",body:JSON.stringify([{
        campaign:CAMPAIGN,scope_id:scope,group_name:g.group_name||"",status:"pending"
      }])});
      const response=await fetch("https://api.line.me/v2/bot/message/push",{
        method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({to:id,messages:[{type:"text",text:NOTICE}]})
      });
      const detail=response.ok?"LINE accepted push":(await response.text()).slice(0,500);
      await supabaseRequest("ttm_group_notice_receipts?"+filter,{method:"PATCH",body:JSON.stringify({
        status:response.ok?"sent":"failed",http_status:response.status,detail,updated_at:new Date().toISOString()
      })});
      console.log("Art TTM group notice result",g.group_name,response.status,response.ok);
    }catch(e){console.error("Art TTM group notice failed",g.group_name,e.message);}
  }
}
module.exports={CAMPAIGN,NOTICE,broadcast};
