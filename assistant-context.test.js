"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const a = require("./assistant-context");
const row = (name, id, date="2026-10-17T17:00:00Z") => ({file_name:name,line_message_id:id,storage_bucket:"private",storage_path:"group-a/"+id,created_at:date,mime_type:/\.pdf$/i.test(name)?"application/pdf":/\.xlsx?$/i.test(name)?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"image/jpeg"});
test("one broken context source does not discard the other sources", async () => {
  assert.deepEqual(await a.loadContextParts([()=>"history",()=>{throw Error("offline")},async()=>"members"],()=>{}),["history","","members"]);
});
test("reasoning is enabled with an adequate output budget", () => {
  assert.equal(a.reasoningOptions({}).reasoning.effort,"medium");
  assert.equal(a.reasoningOptions({}).model,"gpt-5.4");
  assert.equal(a.reasoningOptions({OPENAI_REASONING_EFFORT:"none"}).reasoning.effort,"medium");
});
test("explicit missing filename never substitutes an unrelated attachment",()=>{
  assert.deepEqual(a.selectAttachments([row("a.pdf","1")],"อาร์ตอ่าน missing.pdf"),[]);
});
test("quoted reply chooses exact message only",()=>{
  assert.deepEqual(a.selectAttachments([row("a.jpg","1"),row("b.jpg","2")],"อาร์ตเทียบรูป","2").map(x=>x.file_name),["b.jpg"]);
});
test("comparison does not mix older projects",()=>{
  assert.equal(a.selectAttachments([row("a.jpg","1"),row("b.jpg","2"),row("old.jpg","3","2026-10-16T00:00:00Z")],"อาร์ตเทียบรูปทั้งหมด").length,2);
});
test("general questions do not download unrelated files",async()=>{
  const result=await a.loadRelevantAttachments({scopeId:"group:a",text:"อาร์ตสวัสดี",supabaseRequest:()=>{throw Error("must not query")}});
  assert.deepEqual(result,[]);
});
test("persistent lookup is scoped to the group and quoted message",async()=>{
  let query;
  const result=await a.loadRelevantAttachments({scopeId:"group:a",text:"อาร์ตอ่านรูป",quotedId:"2",supabaseRequest:async q=>{query=q;return [row("a.jpg","2")]},downloadSupabaseFile:async()=>Buffer.from("image")});
  assert.ok(query.includes("scope_id=eq.group%3Aa"));
  assert.ok(query.includes("line_message_id=eq.2"));
  assert.equal(result[1].type,"input_image");
});
test("oversized attachment is not submitted as a model input",async()=>{
  const result=await a.loadRelevantAttachments({scopeId:"group:a",text:"อาร์ตอ่านรูป",supabaseRequest:async()=>[row("a.jpg","1")],downloadSupabaseFile:async()=>Buffer.alloc(17*1024*1024)});
  assert.ok(result.every(x=>x.type==="input_text"));
  assert.match(result[0].text,/เกินขนาด/);
});
test("Excel content includes sheet names and actual values",async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["งาน","จำนวน"],["กระเบื้อง",12]]),"BOQ");
  const result=await a.loadRelevantAttachments({scopeId:"group:a",text:"อาร์ตอ่าน boq.xlsx",supabaseRequest:async()=>[row("boq.xlsx","1")],downloadSupabaseFile:async()=>XLSX.write(wb,{type:"buffer",bookType:"xlsx"}),XLSX});
  assert.match(result[1].text,/BOQ/);assert.match(result[1].text,/กระเบื้อง,12/);
});
test("long Thai answers are split into legal LINE text messages",()=>{
  const text="ทดสอบ😀".repeat(2200);
  const parts=a.splitLineText(text);
  assert.ok(parts.length>1 && parts.length<=5);
  assert.ok(parts.every(x=>x.text.length<=5000));
  assert.equal(parts.map(x=>x.text).join(""),text);
});
test("PDF is passed as original bytes, not a summary",async()=>{
  const result=await a.loadRelevantAttachments({scopeId:"group:a",text:"อาร์ตอ่าน a.pdf",supabaseRequest:async()=>[row("a.pdf","1")],downloadSupabaseFile:async()=>Buffer.from("%PDF-test")});
  assert.equal(result[1].type,"input_file");assert.match(result[1].file_data,/^data:application\/pdf;base64,/);
});
test("image followup skips a newer PDF",()=>{
  assert.equal(a.selectAttachments([row("new.pdf","2"),row("photo.jpg","1")],"อาร์ตอ่านข้อความในรูป")[0].line_message_id,"1");
});
test("cached original remains readable during storage outage and respects quote",async()=>{
  const cachedFiles=[{fileName:"photo.jpg",mime:"image/jpeg",bytes:Buffer.from("original"),savedAt:Date.now(),lineMessageId:"photo"}];
  const args={scopeId:"group:a",text:"อาร์ตคิดเห็นข้อความในรูปยังไง",quotedId:"photo",cachedFiles,supabaseRequest:async()=>{throw Error("offline")}};
  const result=await a.loadRelevantAttachments(args);
  assert.equal(result[1].type,"input_image");
  assert.equal(result[1].image_url,"data:image/jpeg;base64,b3JpZ2luYWw=");
  const missing=await a.loadRelevantAttachments({...args,quotedId:"other"});
  assert.ok(missing.every(x=>x.type==="input_text"));
});
test("expired cache is not used when persistence fails",async()=>{
  await assert.rejects(a.loadRelevantAttachments({scopeId:"group:a",text:"อ่านรูป",cachedFiles:[{savedAt:Date.now()-3600001}],supabaseRequest:async()=>{throw Error("offline")}}),/offline/);
});
