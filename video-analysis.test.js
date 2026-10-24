"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs/promises"),os=require("os"),path=require("path"),{promisify}=require("util"),{execFile}=require("child_process");
const run=promisify(execFile),v=require("./video-analysis");
const scope="group:C"+"a".repeat(32);
test("original Thai clip question routes to analysis, creation stays separate",()=>{
 for(const text of ["@Art TTM อาร์ตดูคลิปแล้วพี่เบนซ์ร้องเพลงเป็นไงบ้าง","อาร์ตสรุปคลิปนี้","วิเคราะห์วิดีโอล่าสุด","อาร์ตอ่านคลิปให้หน่อย"])assert.ok(v.wantsVideoAnalysis(text),text);
 for(const text of ["อาร์ตสร้างคลิปสรุปงาน","อาร์ตทำคลิปเปิดร้าน","อาร์ตสรุปงาน","อาร์ตดูรูป"])assert.equal(v.wantsVideoAnalysis(text),false,text);
});
test("quoted source stays scoped and never falls back to another clip",async()=>{
 let queries=[];const db=async q=>{queries.push(q);return []};
 assert.equal(await v.findVideo({scopeId:scope,quotedId:"123",supabaseRequest:db}),null);
 assert.match(queries[0],new RegExp("scope_id=eq\\."+encodeURIComponent(scope)));assert.match(queries[0],/line_message_id=eq\.123/);assert.ok(!queries[0].includes("or="));
 await v.findVideo({scopeId:scope,supabaseRequest:db});assert.match(queries[1],/or=\(mime_type.like.video/);
});
test("real ffmpeg extracts frames, sound, silent video and rejects corrupt content",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"video-test-"));
 try{
  for(const sound of [true,false]){
   const file=path.join(dir,"clip.mp4");
   await run("/usr/bin/ffmpeg",["-y","-loglevel","error","-f","lavfi","-i","color=c=blue:s=160x120:r=5",...(sound?["-f","lavfi","-i","sine=frequency=440:sample_rate=24000"]:[]),"-t","2","-c:v","libx264","-pix_fmt","yuv420p",...(sound?["-c:a","aac"]:[]),file]);
   const result=await v.extractVideo(await fs.readFile(file),{ffmpegPath:"/usr/bin/ffmpeg"});
   assert.ok(result.frames.length>0&&result.frames.length<=12);assert.equal(Boolean(result.audio),sound);assert.ok(result.seconds<=2.1);
   assert.equal(result.frames[0].bytes[0],255);
  }
  await assert.rejects(v.extractVideo(Buffer.from("not video"),{ffmpegPath:"/usr/bin/ffmpeg"}),/decode/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
function harness(audioFailure=false,noAudio=false){
 let calls=[],saved=[];
 const analyze=v.createVideoAnalyzer({supabaseRequest:async()=>[{file_name:"exact.mp4",mime_type:"video/mp4",storage_bucket:"private",storage_path:"group/clip"}],downloadSupabaseFile:async()=>Buffer.from("video"),extract:async()=>({frames:[{seconds:1,bytes:Buffer.from("jpeg")}],audio:noAudio?null:Buffer.from("mp3"),duration:120,seconds:90}),saveMessage:async m=>saved.push(m),openai:async(route,body)=>{
  calls.push({route,body});if(route==="chat/completions"){if(audioFailure)throw Error("no access");return {json:async()=>({choices:[{message:{content:"เสียงจริง"}}]})}}
  return {json:async()=>({output_text:"ผลวิเคราะห์"})};
 }});
 return {analyze,calls,saved};
}
test("video handler supplies real audio and sampled images, records bounded analysis",async()=>{
 const h=harness();const result=await h.analyze({scope_id:scope,payload:{text:"ร้องเพลงเป็นไง",quotedId:"123"}});
 assert.equal(h.calls[0].route,"chat/completions");assert.equal(h.calls[0].body.messages[1].content[1].input_audio.format,"mp3");
 assert.equal(h.calls[1].body.input[0].content[2].type,"input_image");assert.match(result.messages[0].text,/0–90\.0.*120\.0/);assert.equal(h.saved.length,1);
});
test("audio errors and silent video disclose limitation and still analyze images",async()=>{
 for(const h of [harness(true),harness(false,true)]){
  const result=await h.analyze({scope_id:scope,payload:{text:"สรุปคลิป"}});
  assert.match(result.messages[0].text,/ยังไม่ได้วิเคราะห์เสียง/);
  const request=h.calls.find(x=>x.route==="responses");assert.match(request.body.input[0].content[0].text,/audioHeard":false/);
 }
});
