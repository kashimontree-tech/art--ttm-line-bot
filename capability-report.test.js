const test=require("node:test"),assert=require("node:assert/strict"),{report}=require("./capability-report");
test("capability evidence excludes internal, silent and different-group jobs",async()=>{
 const make=x=>({scope_id:"group:a",kind:"document",status:"completed",delivery_status:"sent",payload:{format:"docx"},result:{fileName:"a.docx",messages:[{text:"link"}]},...x});
 const result=await report({scopeId:"group:a",version:"test",supabaseRequest:async()=>[make({payload:{format:"docx",internalTest:true}}),make({scope_id:"group:b"}),make({result:{silent:true,fileName:"a.docx",messages:[{text:"link"}]}})]});
 assert.match(result,/⚪ Word/);assert.ok(!result.includes("✅ Word"));
});
test("a returned question is not evidence of a generated document",async()=>{
 const result=await report({scopeId:"group:a",version:"test",supabaseRequest:async()=>[{scope_id:"group:a",kind:"document",status:"completed",delivery_status:"sent",payload:{format:"docx"},result:{messages:[{text:"ขอข้อมูลเพิ่ม"}]}}]});assert.match(result,/⚪ Word/);
});
test("real generated file acceptance is reported with the proper limitation",async()=>{
 const result=await report({scopeId:"group:a",version:"test",supabaseRequest:async()=>[{scope_id:"group:a",kind:"document",status:"completed",delivery_status:"sent",payload:{format:"docx"},result:{fileName:"a.docx",messages:[{text:"link"}]}}]});assert.match(result,/✅ Word/);assert.match(result,/ไม่ได้ยืนยันว่าผู้รับเปิดไฟล์/);
});
