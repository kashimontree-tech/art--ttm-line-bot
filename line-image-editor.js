"use strict";
// Edit an already archived LINE image with the OpenAI Images Edit API.
// Intentionally scoped to the current chat; do not expose images from other groups.
module.exports = async function editLastLineImage({scopeId,instruction,displayName,liveFileCache,supabaseRequest,downloadSupabaseFile,uploadSupabaseFile,saveFileMemory,createSupabaseSignedUrl,openaiKey}) {
  if (!openaiKey) throw new Error("OPENAI_API_KEY missing");
  const cache=liveFileCache.get(String(scopeId))||[];
  let source=cache.find(x=>/^image\/(png|jpeg|webp)$/.test(x.mime||"") && x.bytes);
  if (!source) {
    const rows=await supabaseRequest("line_memories?select=file_name,mime_type,storage_bucket,storage_path,created_at"+
      "&scope_id=eq."+encodeURIComponent(scopeId)+"&storage_path=not.is.null&order=created_at.desc&limit=60",{method:"GET"});
    const item=(rows||[]).find(x=>/^image\/(png|jpeg|webp)$/.test(x.mime_type||"")&&x.storage_bucket&&x.storage_path);
    if (item) source={fileName:item.file_name,mime:item.mime_type,bytes:await downloadSupabaseFile(item.storage_bucket,item.storage_path)};
  }
  if (!source) return {text:(displayName||"พี่")+"ครับ ยังไม่พบรูปต้นฉบับที่เก็บไว้ใน LINE กลุ่มนี้ กรุณาส่งรูปเข้ากลุ่มก่อนครับ"};
  if (source.bytes.length>20*1024*1024) return {text:(displayName||"พี่")+"ครับ รูปต้นฉบับมีขนาดเกิน 20 MB กรุณาส่งรูปที่เล็กลงครับ"};
  const prompt=String(instruction||"").replace(/(?:^|\s)@?อาร์ต(?:\s*TTM)?/gi,"").trim().slice(0,3000);
  // Do not pretend to know a precise brand mark when it has not been provided.
  if (/โลโก้|logo/i.test(prompt) && !/ไม่(?:ต้อง)?ใส่โลโก้|ตัดโลโก้|ลบโลโก้/.test(prompt)) {
    return {text:(displayName||"พี่")+"ครับ พบรูปต้นฉบับแล้ว แต่ยังไม่ได้ผูกไฟล์โลโก้ TTM ที่ยืนยันเป็นทางการไว้กับระบบแก้ภาพ กรุณาส่งโลโก้ TTM ลงในกลุ่มเพื่อยืนยันก่อนครับ"};
  }
  const fd=new FormData();
  fd.append("model",process.env.OPENAI_IMAGE_EDIT_MODEL||"gpt-image-1.5");
  fd.append("prompt","Edit the uploaded original image as the user requests, preserving essential dimensions, labels, objects, and legible text as much as possible. Never invent official logos, seals or construction measurements. User request (Thai): "+prompt);
  fd.append("size","auto");
  fd.append("quality","medium");
  fd.append("image",new Blob([source.bytes],{type:source.mime||"image/png"}),source.fileName||"source.png");
  const resp=await fetch("https://api.openai.com/v1/images/edits",{method:"POST",headers:{Authorization:"Bearer "+openaiKey},body:fd});
  if (!resp.ok) throw new Error("Image edits API "+resp.status+": "+(await resp.text()).slice(0,300));
  const data=await resp.json();
  const b64=data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image edits API returned no image");
  const bytes=Buffer.from(b64,"base64");
  const filename="Art_TTM_edited_"+Date.now()+".png";
  const stored=await uploadSupabaseFile(bytes,scopeId,"ai-image-edit",filename,"image/png");
  await saveFileMemory({scopeId,userId:null,displayName:"Art TTM",source:{type:"bot"},fileName:filename,lineMessageId:null,openaiFileId:null,mime:"image/png",summary:"Edited from "+source.fileName+"; "+prompt,storageBucket:stored.bucket,storagePath:stored.storagePath});
  const url=await createSupabaseSignedUrl(stored.bucket,stored.storagePath,3600);
  return {url,text:(displayName||"พี่")+"ครับ แก้ภาพจากต้นฉบับในกลุ่มนี้เสร็จแล้วครับ\n"+filename+"\n"+url+"\nลิงก์ใช้ได้ 1 ชั่วโมงครับ"};
};
