"use strict";

function shouldRemember(text) {
  const value=String(text||"").trim();
  if(!value || /(?:เท่าไหร่|เท่าไร|อะไรบ้าง|คืออะไร|ทำไม|หรือยัง|ใช่ไหม|ได้ไหม|ได้มั้ย|หรือเปล่า|ไหม|มั้ย|หรือไม่|\?)/u.test(value))return false;
  if(/จำไว้|จำว่า|บันทึก(?:ไว้|ข้อมูล|ราคา)|ชื่อ.{1,50}คือ|เรียกว่า|เป็นแฟน|เป็นภรรยา|เป็นสามี|เป็นลูก|เป็นพี่|เป็นน้อง|ตำแหน่ง|โครงการ.{1,50}ชื่อ/u.test(value))return true;
  // Preserve explicit work corrections and facts, rather than treating questions as facts.
  return /(?:อัปเดต|อัพเดท|แก้ไข|แก้เป็น|เปลี่ยนเป็น|ราคาใหม่|ต้นทุน|ยอดรับ|ยอดจ่าย|ยอดรวม|ค่าเช่า|ค่าน้ำ|ค่าไฟ|ค่าแรง|เงินเดือน|ส่วนลด|กำไร|จ่ายแล้ว|รับแล้ว|กำหนดส่ง|วันส่งงาน)/u.test(value) &&
    /(?:\d|[๐-๙]|บาท|พรุ่งนี้|วันนี้|เรียบร้อย|เสร็จแล้ว)/u.test(value);
}

async function updateAttachmentSummary({scopeId,messageId,summary,supabaseRequest}) {
  if(!scopeId||scopeId==="unknown"||!messageId||!String(summary||"").trim())return false;
  const text=String(summary).trim().slice(0,40000);
  const rows=await supabaseRequest("line_memories?scope_id=eq."+encodeURIComponent(scopeId)+
    "&line_message_id=eq."+encodeURIComponent(messageId)+"&message_type=eq.file&select=id",{
    method:"PATCH",prefer:"return=representation",body:JSON.stringify({
      text_content:text,
      memory_text:"สรุปจาก AI ของไฟล์ต้นฉบับในกลุ่มนี้ (ต้องเทียบต้นฉบับก่อนใช้ตัวเลข):\n"+text
    })
  });
  return Array.isArray(rows)&&rows.length>0;
}

function newestKnowledge(rows) {
  const chosen=new Map();
  for(const row of rows||[]){
    const key=row.source_reference||row.id||row.title;
    if(!key)continue;
    const prior=chosen.get(key);
    if(!prior||Number(row.version||0)>Number(prior.version||0)||
      (Number(row.version||0)===Number(prior.version||0)&&Date.parse(row.updated_at)>Date.parse(prior.updated_at)))chosen.set(key,row);
  }
  return [...chosen.values()];
}
module.exports={shouldRemember,updateAttachmentSummary,newestKnowledge};
