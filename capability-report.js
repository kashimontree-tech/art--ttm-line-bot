"use strict";
async function report({scopeId,supabaseRequest,version}) {
 const kinds=[['docx','Word'],['pptx','PowerPoint'],['xlsx','Excel'],['pdf','PDF'],['image','ภาพ'],['audio','ถอดเสียง'],['video','คลิปภาพนิ่งพร้อมเสียง'],['web','ค้นเว็บ']];
 const lines=["🤖 Art TTM — ความสามารถและผลตรวจ", "เวอร์ชัน: "+version,
  "รองรับการตอบคำถาม คำนวณ อ่านรูป/เอกสาร จำชื่อสมาชิก และสร้างผลลัพธ์ตามคำสั่งด้านล่าง",
  "ข้อมูลข้อความ/ไฟล์ใหม่ใน LINE บันทึกตามที่ได้รับ และปรับสรุปหลังอ่านสำเร็จ",
  "ผลการสร้างและส่งจากกลุ่มนี้ (ไม่รวมการทดสอบภายใน):"];
 try {
  const rows=await supabaseRequest("ttm_ai_jobs?select=scope_id,kind,status,delivery_status,payload,result&scope_id=eq."+encodeURIComponent(scopeId)+"&order=created_at.desc&limit=100",{method:"GET"})||[];
  const sent=rows.filter(x=>x.scope_id===scopeId&&x.status==="completed"&&x.delivery_status==="sent"&&!x.payload?.internalTest&&!x.result?.silent&&x.result?.messages?.length);
  for(const [kind,label] of kinds){
   const found=sent.some(x=>(x.kind==="document"?x.payload?.format:x.kind)===kind && (x.kind==="web"||Boolean(x.result?.fileName)));
   lines.push((found?"✅ ":"⚪ ")+label+": "+(found?"มีผลลัพธ์ และ LINE รับคำขอส่งแล้ว":"มีระบบ ยังไม่มีหลักฐานส่งผลสำเร็จจากกลุ่มนี้"));
  }
 }catch(e){console.error("Capability evidence unavailable",e.message);lines.push("⚠️ อ่านผลทดสอบของกลุ่มนี้ไม่สำเร็จ จึงยังยืนยันสถานะส่งผลไม่ได้");}
 lines.push("", "ข้อที่ยังไม่เทียบเท่า ChatGPT: เชื่อม Gmail/Drive/GitHub/Render, ซิงก์ทุกแชตอัตโนมัติ, ตั้งเตือนตามเวลา, แปลง Excel เป็น PDF คงรูปแบบเดิม และวิดีโอเคลื่อนไหวเต็มรูปแบบ",
  "LINE รับคำขอส่ง ไม่ได้ยืนยันว่าผู้รับเปิดไฟล์หรือเนื้อหาถูกต้องครบแล้ว",
  "คำสั่ง: อาร์ต ทำ Word… / อาร์ต ทำ PowerPoint… / อาร์ต สร้างภาพ… / อาร์ต ค้นเว็บ… / อาร์ต งานล่าสุด",
  "อ่านย้อนหลังได้เฉพาะข้อมูลที่บอตเก็บไว้ และไฟล์ของแต่ละกลุ่มแยกตามสิทธิ์");
 return lines.join("\n");
}
module.exports={report};
