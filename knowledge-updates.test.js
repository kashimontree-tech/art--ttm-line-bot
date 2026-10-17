"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const k=require("./knowledge-updates");
test("explicit price and work corrections are remembered",()=>{
  assert.ok(k.shouldRemember("อาร์ต อัปเดตราคากระเบื้องเป็น 645 บาท"));
  assert.ok(k.shouldRemember("แก้เป็นยอดรับ 150000 บาท"));
  assert.ok(k.shouldRemember("บันทึกข้อมูล ต้นทุนงาน 5000 บาท"));
});
test("questions must not become recorded financial facts",()=>{
  assert.ok(!k.shouldRemember("ต้นทุนเท่าไหร่"));
  assert.ok(!k.shouldRemember("อาร์ต อัปเดตราคา 645 บาทได้ไหม"));
  assert.ok(!k.shouldRemember("มีข้อมูลอะไรบ้าง"));
});
test("attachment summaries update only an existing file in the current room",async()=>{
  let query,options;
  const saved=await k.updateAttachmentSummary({scopeId:"group:a",messageId:"file/1",summary:"ราคา 645 บาท",supabaseRequest:async(q,o)=>{query=q;options=o;return [{id:"existing"}]}});
  assert.ok(saved);assert.ok(query.includes("scope_id=eq.group%3Aa"));assert.ok(query.includes("line_message_id=eq.file%2F1"));
  assert.equal(options.method,"PATCH");assert.equal(JSON.parse(options.body).text_content,"ราคา 645 บาท");
});
test("missing archive rows are not reported as successfully updated",async()=>{
  assert.equal(await k.updateAttachmentSummary({scopeId:"group:a",messageId:"1",summary:"read",supabaseRequest:async()=>[]}),false);
});
test("failed or empty analysis does not overwrite stored content",async()=>{
  const result=await k.updateAttachmentSummary({scopeId:"group:a",messageId:"1",summary:"",supabaseRequest:async()=>{throw Error("must not write")}});assert.equal(result,false);
});
test("newest shared source revision wins even with duplicate older records",()=>{
 const rows=k.newestKnowledge([{source_reference:"f#1",version:1,content:"old"},{source_reference:"f#1",version:3,content:"new"},{source_reference:"f#2",version:1,content:"other"},{source_reference:"f#1",version:2,content:"middle"}]);
 assert.equal(rows.length,2);assert.equal(rows.find(x=>x.source_reference==="f#1").content,"new");
});
