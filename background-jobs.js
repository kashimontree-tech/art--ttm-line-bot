"use strict";
const {splitLineText} = require("./assistant-context");

function lineTarget(scope) {
  const match=String(scope).match(/^(?:group:(C[a-f0-9]{32})|room:(R[a-f0-9]{32})|user:(U[a-f0-9]{32}))$/i);
  if(!match)throw Error("Invalid LINE job scope");
  return match[1]||match[2]||match[3];
}

function createJobQueue({supabaseRequest,handlers,token,fetchImpl=fetch,log=console.error}) {
  let busy=false;
  const patch=(id,data)=>supabaseRequest("ttm_ai_jobs?id=eq."+encodeURIComponent(id),{method:"PATCH",prefer:"return=minimal",body:JSON.stringify(data)});
  async function enqueue({scopeId,requesterId,messageId,kind,payload}) {
    lineTarget(scopeId);
    if(!requesterId||!messageId||!handlers[kind])throw Error("Invalid job request");
    const rows=await supabaseRequest("ttm_ai_jobs?on_conflict=line_message_id",{method:"POST",prefer:"resolution=ignore-duplicates,return=representation",body:JSON.stringify([{scope_id:scopeId,requester_id:requesterId,line_message_id:String(messageId),kind,payload}])});
    return rows?.[0]||null;
  }
  async function deliver(job) {
    if(job.result?.silent){await patch(job.id,{delivery_status:"sent"});return;}
    const messages=job.result?.messages;
    if(!Array.isArray(messages)||!messages.length)throw Error("Job result has no messages");
    const response=await fetchImpl("https://api.line.me/v2/bot/message/push",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"X-Line-Retry-Key":job.id},
      body:JSON.stringify({to:lineTarget(job.scope_id),messages:messages.slice(0,5)}),signal:AbortSignal.timeout(20000)
    });
    if(response.ok || (response.status===409&&response.headers.get("x-line-accepted-request-id"))){
      await patch(job.id,{delivery_status:"sent"});return;
    }
    const retryable=response.status>=500;
    await patch(job.id,{delivery_status:retryable?"pending":"failed",delivery_attempts:(job.delivery_attempts||0)+1,
      delivery_next_at:new Date(Date.now()+60000*2**Math.min(job.delivery_attempts||0,4)).toISOString()});
    log("LINE job result delivery failed",job.id,response.status);
  }
  async function tick() {
    if(busy)return;
    busy=true;
    try {
      // Never rerun an interrupted paid operation automatically.
      await supabaseRequest("ttm_ai_jobs?status=eq.running&started_at=lt."+encodeURIComponent(new Date(Date.now()-20*60000).toISOString()),{
        method:"PATCH",prefer:"return=minimal",body:JSON.stringify({status:"needs_review",error_detail:"Worker interrupted; review before retrying",finished_at:new Date().toISOString()})});
      const pending=await supabaseRequest("ttm_ai_jobs?select=*&delivery_status=eq.pending&status=in.(completed,failed)&delivery_attempts=lt.5&delivery_next_at=lte."+encodeURIComponent(new Date().toISOString())+"&created_at=gt."+encodeURIComponent(new Date(Date.now()-23*3600000).toISOString())+"&order=created_at.asc&limit=3",{method:"GET"})||[];
      for(const job of pending){try{await deliver(job)}catch(e){log("LINE result transport unavailable",job.id,e.message);await patch(job.id,{delivery_attempts:(job.delivery_attempts||0)+1,delivery_next_at:new Date(Date.now()+60000*2**Math.min(job.delivery_attempts||0,4)).toISOString()});}}
      const rows=await supabaseRequest("rpc/ttm_claim_ai_job",{method:"POST",body:"{}"});
      const job=rows?.[0];if(!job)return;
      let result,status="completed",error_detail=null;
      try {
        lineTarget(job.scope_id);
        if(!handlers[job.kind])throw Error("Unsupported job kind");
        result=await handlers[job.kind](job);
        if(!Array.isArray(result?.messages)||!result.messages.length)throw Error("Empty job output");
        if(job.payload?.internalTest===true)result.silent=true;
      } catch(e) {
        log("AI job failed",job.id,e.message);
        status="failed";error_detail=String(e.message).slice(0,700);
        result={silent:Boolean(job.payload?.silent||job.payload?.internalTest),messages:splitLineText("งานของอาร์ตยังไม่สำเร็จครับ รหัสงาน "+job.id+"\nกรุณาพิมพ์ ‘อาร์ต งานล่าสุด’ เพื่อตรวจสถานะ ระบบจะไม่แจ้งว่าสร้างไฟล์สำเร็จเมื่อยังไม่มีผลลัพธ์ครับ")};
      }
      await patch(job.id,{status,result,error_detail,finished_at:new Date().toISOString()});
      // Output is committed before transport. A send failure must never regenerate a paid output.
      try{await deliver({...job,status,result})}catch(e){log("LINE job output retained for retry",job.id,e.message);await patch(job.id,{delivery_attempts:1,delivery_next_at:new Date(Date.now()+60000).toISOString()});}
    } catch(e){log("AI queue unavailable",e.message)} finally{busy=false;}
  }
  async function status(scopeId) {
    lineTarget(scopeId);
    const rows=await supabaseRequest("ttm_ai_jobs?select=id,kind,status,delivery_status,created_at,result&scope_id=eq."+encodeURIComponent(scopeId)+"&order=created_at.desc&limit=5",{method:"GET"})||[];
    const names={queued:"รอประมวลผล",running:"กำลังทำ",completed:"สร้างผลลัพธ์แล้ว",failed:"ไม่สำเร็จ",needs_review:"งานสะดุด ต้องตรวจสอบก่อนทำซ้ำ"};
    return rows.length?rows.map(x=>x.kind+" • "+names[x.status]+" • "+x.id+"\nสถานะส่ง LINE: "+x.delivery_status+
      (x.status==="completed"&&x.result?.fileName?"\nไฟล์: "+x.result.fileName+" — ขอไฟล์จากคลังด้วยชื่อนี้ได้ครับ":"")).join("\n\n"):"ยังไม่มีงานสร้างไฟล์หรือภาพในกลุ่มนี้ครับ";
  }
  return {enqueue,tick,status};
}
module.exports={createJobQueue,lineTarget};
