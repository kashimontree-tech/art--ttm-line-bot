function isSearchRequest(text) {
 return /(?:ค้นหา|ค้น|หา(?:ข้อมูล|เอกสาร|รูป|สลิป|ราคา|ข้อความ|ประวัติ)|ย้อนหลัง|สรุปข้อมูล(?:ทั้งหมด)?(?:ของ|โครงการ)|มีข้อมูลอะไร)/i.test(String(text||""));
}
function extractSearchTerms(text) {
 return String(text||"").replace(/(?:อาร์ต|art ttm|ช่วย|กรุณา|ค้นหา|ค้น|ย้อนหลัง|ให้หน่อย|ส่งกลับ|ข้อมูลทั้งหมด|ข้อมูล|ไฟล์|รูปภาพ|รูป|สลิป|เอกสาร|ข้อความ|ของโครงการ|โครงการ|ราคา|ที่เคยบันทึก|ที่บันทึกไว้|ในไลน์กลุ่ม|ในกลุ่ม|ทั้งหมด|และ|ด้วย|ครับ|ค่ะ)/gi," ").replace(/[\s,]+/g," ").trim();
}
function matchSearch(record,terms) {
 const hay=[record.file_name,record.text_content,record.memory_text,record.message_text,record.content,record.display_name,record.metadata?.album_name].filter(v=>typeof v==="string").join(" ").toLocaleLowerCase();
 return terms.every(term=>hay.includes(term));
}
function formatDate(value) {const d=new Date(value);return Number.isNaN(d.getTime())?"":d.toLocaleDateString("th-TH",{timeZone:"Asia/Bangkok"});}
async function searchArchive({text,scopeId,displayName,supabaseRequest,createSupabaseSignedUrl}) {
 const raw=extractSearchTerms(text);
 if(!raw || raw.length<2) return `${displayName||"พี่"}ครับ ระบุชื่อไฟล์ โครงการ หรือคำค้นที่ต้องการด้วยครับ เช่น “อาร์ต ค้นหา BOQ เจมาร์ทพังงา”`;
 const terms=raw.toLocaleLowerCase().split(/\s+/).filter(x=>x.length>1).slice(0,8);
 const enc=encodeURIComponent(scopeId);
 let files=[],messages=[],errors=[];
 try{files=await supabaseRequest(`line_memories?select=file_name,text_content,memory_text,display_name,mime_type,metadata,storage_bucket,storage_path,created_at&scope_id=eq.${enc}&order=created_at.desc&limit=500`,{method:"GET"})||[];}catch(e){errors.push("ไฟล์");console.error("Archive files search:",e);}
 try{messages=await supabaseRequest(`line_messages?select=message_text,content,display_name,role,created_at&scope_id=eq.${enc}&order=created_at.desc&limit=500`,{method:"GET"})||[];}catch(e){errors.push("ข้อความ");console.error("Archive messages search:",e);}
 const fileHits=files.filter(x=>matchSearch(x,terms));
 const norm=x=>String(x||"").replace(/\s+/g,"").toLowerCase();
 const input=norm(text);
 const msgHits=messages.filter(x=>{
   if(x.role==="assistant")return false;
   const body=String(x.message_text||x.content||"");
   if(norm(body)===input)return false;
   if(/^(?:อาร์ต|art ttm)[,\s]*(?:ค้นหา|ค้น|หาไฟล์)/i.test(body))return false;
   return matchSearch(x,terms);
 });
 const lines=[`ค้นหา “${raw}” ใน LINE กลุ่มนี้`,`พบไฟล์/รูป ${fileHits.length} รายการ และข้อความ ${msgHits.length} รายการ (ค้นจาก 500 รายการล่าสุดต่อประเภท)`];
 for(const f of fileHits.slice(0,5)){
  lines.push(`📎 ${f.file_name||"ไฟล์"} • ${formatDate(f.created_at)}`);
  if(f.storage_bucket&&f.storage_path){try{const url=await createSupabaseSignedUrl(f.storage_bucket,f.storage_path,3600);lines.push(`ดาวน์โหลด: ${url}`)}catch(e){console.error("Search signed link:",e)}}
 }
 for(const m of msgHits.slice(0,5)){const excerpt=String(m.message_text||m.content||"").replace(/\s+/g," ").slice(0,220);lines.push(`💬 ${formatDate(m.created_at)} ${m.display_name||""}: ${excerpt}`)}
 if(!fileHits.length&&!msgHits.length)lines.push("ไม่พบข้อมูลโครงการจากข้อความหรือไฟล์ที่บันทึกไว้ในกลุ่มนี้ (ไม่นับข้อความคำสั่งค้นหาของตัวเอง) โปรดลองคำค้นสั้นลง เช่น เจมาร์ท หรือ พังงา");
 if(errors.length)lines.push("หมายเหตุ: ค้นหาบางประเภทไม่สำเร็จ ("+errors.join(", ")+")");
 lines.push("หากต้องการค้นจากกลุ่มอื่น ให้ส่งคำสั่งในกลุ่มนั้นเพื่อรักษาความเป็นส่วนตัว");
 return lines.join("\n").slice(0,4800);
}
module.exports={isSearchRequest,searchArchive,extractSearchTerms};
