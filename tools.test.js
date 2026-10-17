"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs/promises"),os=require("os"),path=require("path");
const JSZip=require("jszip"),XLSX=require("xlsx"),sharp=require("sharp");
const {execFile}=require("child_process"),{promisify}=require("util");
const run=promisify(execFile);
const docs=require("./document-tools"),gen=require("./generation-handlers"),{createJobQueue,lineTarget}=require("./background-jobs");
const scope="group:C"+"a".repeat(32),user="U"+"b".repeat(32);
const spec={title:"รายงาน TTM ภาษาไทย",fileName:"../ทดสอบ",sections:[{heading:"สรุป",text:"งานปูกระเบื้อง 12 ตารางเมตร\nราคาได้รับอนุมัติแล้ว"}],sheets:[{name:"ค่าใช้จ่าย",rows:[["รายการ","จำนวนเงิน"],["กระเบื้อง",24000],["ประปา",5000]]}],slides:[{title:"รายงาน TTM",bullets:["งานปูกระเบื้อง 12 ตารางเมตร","งานประปา 5,000 บาท"]}]};

test("document routing distinguishes new files from conversion",()=>{
 assert.equal(docs.requestedDocument("อาร์ตทำ PowerPoint สรุปงาน"),"pptx");assert.equal(docs.requestedDocument("อาร์ตทำไฟล์ word"),"docx");
 assert.equal(docs.requestedDocument("อาร์ตแปลง Excel เป็น PDF"),null);
});
test("document schema rejects oversized or executable cell objects",()=>{
 assert.throws(()=>docs.validateSpec({...spec,sheets:[{name:"bad",rows:[[{formula:"1+1"}]]}]}));
 assert.ok(!docs.safeName("../a/b.docx","pdf").includes("/"));
});
test("generated DOCX contains Thai text and table values",async()=>{
 const doc=await docs.renderDocument(spec,"docx");const zip=await JSZip.loadAsync(doc.bytes);const xml=await zip.file("word/document.xml").async("string");
 assert.match(xml,/งานปูกระเบื้อง/);assert.match(xml,/24000/);
});
test("generated PPTX contains requested slides and Thai content",async()=>{
 const doc=await docs.renderDocument(spec,"pptx");const zip=await JSZip.loadAsync(doc.bytes);const xml=await zip.file("ppt/slides/slide1.xml").async("string");
 assert.match(xml,/งานปูกระเบื้อง/);assert.match(xml,/5,000/);
});
test("generated XLSX keeps numeric cells and Thai headers",async()=>{
 const doc=await docs.renderDocument(spec,"xlsx");const wb=XLSX.read(doc.bytes,{type:"buffer"});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
 assert.equal(rows[1][1],24000);assert.equal(rows[0][0],"รายการ");
});
test("new image, transcription and web intents are explicit",()=>{
 assert.ok(gen.wantsNewImage("อาร์ตสร้างภาพ 3D ร้านชา"));assert.ok(!gen.wantsNewImage("อาร์ตทำภาพเป็น PDF"));
 assert.ok(gen.wantsTranscription("อาร์ตถอดเสียงล่าสุด"));assert.ok(gen.wantsWebSearch("อาร์ตค้นเว็บหาบ้านเหนือคลอง"));
 assert.ok(!gen.wantsWebSearch("อาร์ตค้นหาไฟล์ในกลุ่ม"));
});
test("web sources become clickable URLs rather than invisible citation tokens",()=>{
 const result=gen.publicWebAnswer({output:[{content:[{type:"output_text",text:"ผลค้น citex",annotations:[{type:"url_citation",url:"https://example.com",title:"Official"}]}]}]});
 assert.match(result,/https:\/\/example.com/);assert.ok(!result.includes("cite"));
});
test("LINE target is strictly derived from the current scope",()=>{
 assert.equal(lineTarget(scope),scope.slice(6));assert.throws(()=>lineTarget("unknown"));assert.throws(()=>lineTarget("group:https://external"));
});

function queueHarness(fetchStatus=200,handler) {
 let jobs=[],calls=0,sends=[];
 const db=async(q,opts={})=>{
   if(opts.method==="POST"&&q.startsWith("ttm_ai_jobs?")){
     const item=JSON.parse(opts.body)[0];if(jobs.some(x=>x.line_message_id===item.line_message_id))return [];
     const job={...item,id:"123e4567-e89b-12d3-a456-426614174000",status:"queued",delivery_status:"pending",created_at:new Date().toISOString(),delivery_attempts:0};jobs.push(job);return [job];
   }
   if(q==="rpc/ttm_claim_ai_job"){const job=jobs.find(x=>x.status==="queued");if(!job)return [];job.status="running";return [{...job}];}
   if(opts.method==="PATCH"){const id=q.match(/id=eq\.([^&]+)/)?.[1];const job=jobs.find(x=>x.id===id);if(job)Object.assign(job,JSON.parse(opts.body));return null;}
   if(q.includes("delivery_status=eq.pending"))return jobs.filter(x=>["completed","failed"].includes(x.status)&&x.delivery_status==="pending"&&(!x.delivery_next_at||Date.parse(x.delivery_next_at)<=Date.now())).map(x=>({...x}));
   return jobs;
 };
 const queue=createJobQueue({supabaseRequest:db,token:"test-token",handlers:{document:async job=>{calls++;return handler?handler(job):{fileName:"out.docx",messages:[{type:"text",text:"file"}]}}},log:()=>{},fetchImpl:async(url,request)=>{
   sends.push({url,request});return {ok:fetchStatus===200,status:fetchStatus,headers:new Headers()};
 }});
 return {queue,get jobs(){return jobs},get calls(){return calls},sends};
}
test("queue deduplicates a redelivered LINE event",async()=>{
 const h=queueHarness();const p={scopeId:scope,requesterId:user,messageId:"msg1",kind:"document",payload:{}};
 assert.ok(await h.queue.enqueue(p));assert.equal(await h.queue.enqueue(p),null);await h.queue.tick();assert.equal(h.calls,1);assert.equal(h.jobs[0].delivery_status,"sent");
});
test("failed delivery retries the persisted result without regenerating it",async()=>{
 const h=queueHarness(503);await h.queue.enqueue({scopeId:scope,requesterId:user,messageId:"msg2",kind:"document",payload:{}});await h.queue.tick();
 assert.equal(h.jobs[0].status,"completed");h.jobs[0].delivery_next_at="2000-01-01T00:00:00Z";await h.queue.tick();
 assert.equal(h.calls,1);assert.equal(h.sends.length,2);assert.equal(h.sends[0].request.headers["X-Line-Retry-Key"],h.sends[1].request.headers["X-Line-Retry-Key"]);
 assert.equal(JSON.parse(h.sends[0].request.body).to,scope.slice(6));
});
test("failed generation is never reported as a successful file",async()=>{
 const h=queueHarness(200,()=>{throw Error("API quota")});await h.queue.enqueue({scopeId:scope,requesterId:user,messageId:"msg3",kind:"document",payload:{}});await h.queue.tick();
 assert.equal(h.jobs[0].status,"failed");assert.match(h.jobs[0].result.messages[0].text,/ยังไม่สำเร็จ/);
});
test("silent group processing sends no unsolicited messages",async()=>{
 const h=queueHarness(200,()=>({silent:true,messages:[{type:"text",text:"transcript"}]}));await h.queue.enqueue({scopeId:scope,requesterId:user,messageId:"msg4",kind:"document",payload:{silent:true}});await h.queue.tick();
 assert.equal(h.sends.length,0);assert.equal(h.jobs[0].delivery_status,"sent");
});
test("video renderer creates a playable MP4 with audio",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"art-video-test-"));
 try {
   const audio=path.join(dir,"audio.mp3");
   await run(require("ffmpeg-static"),["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=500:duration=1","-c:a","libmp3lame",audio]);
   const image=await sharp({create:{width:320,height:180,channels:3,background:"#176A4A"}}).png().toBuffer();
   const bytes=await require("./video-tools").renderNarratedVideo(image,await fs.readFile(audio));
   assert.equal(bytes.subarray(4,8).toString(),"ftyp");
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("failed silent attachment analysis also stays silent",async()=>{
 const h=queueHarness(200,()=>{throw Error("quota")});await h.queue.enqueue({scopeId:scope,requesterId:user,messageId:"msg5",kind:"document",payload:{silent:true}});await h.queue.tick();assert.equal(h.sends.length,0);
});
test("service-only internal smoke tests cannot send LINE messages",async()=>{
 const h=queueHarness();await h.queue.enqueue({scopeId:scope,requesterId:user,messageId:"msg6",kind:"document",payload:{internalTest:true}});await h.queue.tick();assert.equal(h.sends.length,0);
});

test("document API request explicitly asks for JSON in its input",async()=>{
 let request,stored=false;
 const handlers=gen.createGenerationHandlers({key:"test",loadContext:async()=>"ข้อมูลทดสอบ",supabaseRequest:async()=>[],downloadSupabaseFile:async()=>Buffer.alloc(0),uploadSupabaseFile:async bytes=>{stored=bytes.subarray(0,2).toString()==="PK";return {bucket:"test",storagePath:"test.docx"}},saveFileMemory:async()=>{},createSupabaseSignedUrl:async()=>"https://example.com/test.docx",fetchImpl:async(url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({status:"completed",output_text:JSON.stringify(spec)})}}});
 const result=await handlers.document({id:"123e4567-e89b-12d3-a456-426614174000",scope_id:scope,requester_id:user,payload:{text:"ทำ Word ทดสอบ",format:"docx"}});
 assert.match(request.input[0].content[0].text,/JSON/i);assert.equal(request.text.format.type,"json_object");assert.ok(stored);assert.ok(result.fileName.endsWith(".docx"));
});
