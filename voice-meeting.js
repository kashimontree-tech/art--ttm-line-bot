// Audio-assisted LINE group meeting: browser microphone, not LINE call audio access.
const crypto=require("crypto");
const express=require("express");
const sessions=new Map();
const ttl=2*60*60*1000;
const key=()=>crypto.randomBytes(24).toString("hex");
const now=()=>Date.now();
const root=()=>String(process.env.RENDER_EXTERNAL_URL||"https://art-ttm-line-bot.onrender.com").replace(/\/$/,"");
const pick=t=>/^(?:@?อาร์ต[\s,:-]*)?(?:เปิดบันทึกเสียงประชุม|ลิงก์บันทึกเสียงประชุม|บันทึกเสียงประชุม|เปิดไมค์ประชุม)(?:\s.*)?$/iu.test(String(t||"").trim());
const summaryInstructions="สรุปการประชุมภาษาไทย จากบันทึกถอดเสียงเท่านั้น ห้ามเดาข้อมูล ระบุหัวข้อ ประเด็นหลัก มติที่ตกลง งานที่มอบหมาย ผู้รับผิดชอบ กำหนดส่ง และเรื่องติดตาม ถ้าไม่มีข้อมูลระบุไม่ระบุ แยกความเห็นจากข้อตกลง ระบุว่าเป็นการถอดเสียงอัตโนมัติอาจมีคำผิด";
function get(token){const s=sessions.get(token);if(!s||s.expires<now())return null;return s;}
async function openForGroup(scopeId){if(!/^group:|^room:/.test(scopeId))return "ใช้คำสั่งนี้ใน LINE กลุ่มครับ";const token=key();sessions.set(token,{scopeId,expires:now()+ttl,segments:[],createdAt:new Date().toISOString(),busy:false});return "🎙️ ลิงก์บันทึกเสียงประชุม (เปิดใช้ได้ภายใน 2 ชั่วโมง)\n"+root()+"/voice-meeting/"+token+"\nกรุณาแจ้งสมาชิกทุกคนว่ามีการบันทึกเสียงและขอความยินยอมก่อนเริ่มครับ\n⚠️ ลิงก์นี้ใช้ไมโครโฟนของเครื่องที่เปิดหน้าเว็บ ไม่สามารถดึงเสียง LINE Call โดยตรงได้ ควรเปิดผ่านอุปกรณ์อีกเครื่องที่ได้ยินเสียงประชุม";
}
function setup(app,{supabaseRequest}) {
 app.get("/voice-meeting/:token",(req,res)=>{if(!get(req.params.token))return res.status(410).send("ลิงก์หมดอายุ กรุณาขอลิงก์ใหม่ใน LINE");res.set("Cache-Control","no-store").sendFile(require("path").join(__dirname,"voice-meeting.html"));});
 app.post("/api/voice-meeting/:token/segment",express.raw({type:["audio/webm","audio/mp4","audio/ogg","application/octet-stream"],limit:"18mb"}),async(req,res)=>{
  const s=get(req.params.token);if(!s)return res.status(410).json({error:"ลิงก์หมดอายุ"});
  if(s.busy)return res.status(409).json({error:"กำลังประมวลผลเสียง กรุณาลองอีกครั้ง"});
  if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:"ไม่มีเสียง"});
  if(s.segments.length>=240)return res.status(413).json({error:"ถึงจำนวนช่วงสูงสุดแล้ว กรุณาจบและสรุป"});
  s.busy=true;
  try {
   const mime=(req.headers["content-type"]||"audio/webm").split(";")[0];
   const ext=mime==="audio/mp4"?"m4a":mime==="audio/ogg"?"ogg":"webm";
   const fd=new FormData();fd.append("model",process.env.OPENAI_TRANSCRIBE_MODEL||"gpt-4o-mini-transcribe");fd.append("language","th");fd.append("file",new Blob([req.body],{type:mime}),"meeting."+ext);
   const r=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:"Bearer "+process.env.OPENAI_API_KEY},body:fd});
   if(!r.ok)throw Error("ถอดเสียงไม่สำเร็จ: "+r.status+" "+(await r.text()).slice(0,300));
   const text=String((await r.json()).text||"").trim();
   s.segments.push({text,at:new Date().toISOString()});return res.json({ok:true,count:s.segments.length,transcript:text});
  }catch(e){console.error("Voice transcribe error:",e);return res.status(502).json({error:"ส่งเสียงถอดความไม่สำเร็จ กรุณาลองส่งช่วงนี้อีกครั้ง"});}
  finally{s.busy=false;}
 });
 app.post("/api/voice-meeting/:token/finish",async(req,res)=>{
  const s=get(req.params.token);if(!s)return res.status(410).json({error:"ลิงก์หมดอายุ"});if(s.busy)return res.status(409).json({error:"ระบบกำลังรับเสียง"});
  if(!s.segments.some(x=>x.text))return res.status(400).json({error:"ยังไม่มีข้อความถอดเสียง"});
  s.busy=true;
  try {
   const transcript=s.segments.map((x,i)=>"ช่วง "+(i+1)+": "+x.text).join("\n");
   if(transcript.length>100000)return res.status(413).json({error:"ข้อความยาวเกินไป กรุณาแบ่งการประชุม"});
   const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5.4-mini",instructions:summaryInstructions,input:transcript,max_output_tokens:1600})});
   if(!r.ok)throw Error("summarize "+r.status+" "+(await r.text()).slice(0,300));
   const o=await r.json();const report=(o.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("\n").trim()||o.output_text;
   if(!report)throw Error("empty meeting summary");
   const target=s.scopeId.split(":").slice(1).join(":");
   const message="🎙️ สรุปประชุมจากเสียง\n"+report;
   const parts=message.match(/[\s\S]{1,4500}/g)||[];
   const push=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:"Bearer "+process.env.LINE_CHANNEL_ACCESS_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({to:target,messages:parts.slice(0,5).map(text=>({type:"text",text}))})});
   if(!push.ok)throw Error("LINE push "+push.status+" "+(await push.text()).slice(0,200));
   await supabaseRequest("line_messages",{method:"POST",prefer:"return=minimal",body:JSON.stringify([{scope_id:s.scopeId,message_type:"text",message_text:message,content:message,role:"assistant",display_name:"Art TTM"}])}).catch(e=>console.error("Meeting archive error:",e));
   sessions.delete(req.params.token);return res.json({ok:true,message:"ส่งสรุปประชุมเข้า LINE กลุ่มแล้ว",summary:report});
  }catch(e){console.error("Finish voice meeting error:",e);res.status(502).json({error:"สรุปหรือส่ง LINE ไม่สำเร็จ กรุณาลองอีกครั้ง"});}
  finally{s.busy=false;}
 });
}
module.exports={pick,openForGroup,setup};
