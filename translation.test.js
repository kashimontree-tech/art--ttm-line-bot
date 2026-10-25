"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("./translation");
test("translation commands override rewrite and image creation intents",()=>{
 for(const s of ["แปลเป็นภาษาจีนให้พี่ที","อาร์ต แปลข้อความข้างบนเป็นอังกฤษ","ช่วยแปลรูปนี้เป็นไทย","แปล ภาษาเกาหลี","Translate this to Chinese"])
  assert.equal(t.isRequest(s),true,s);
 for(const s of ["แปลงเป็น Excel","แปลงภาพเป็น PDF","ปรับข้อความให้สุภาพ","อาร์ตสวัสดี"])
  assert.equal(t.isRequest(s),false,s);
});
test("separate mention permits only the same sender's translation in the same scope",()=>{
 const base={scopeId:"group:a",userId:"user:a",now:1000};
 assert.equal(t.isInvoked({...base,text:"@Art TTM",explicit:true}),true);
 assert.equal(t.isInvoked({...base,scopeId:"group:b",text:"แปลเป็นจีน",explicit:false,now:2000}),false);
 assert.equal(t.isInvoked({...base,userId:"user:b",text:"แปลเป็นจีน",explicit:false,now:2000}),false);
 assert.equal(t.isInvoked({...base,text:"คุยทั่วไป",explicit:false,now:2000}),false);
 assert.equal(t.isInvoked({...base,text:"แปลเป็นจีน",explicit:false,now:2000}),true);
 assert.equal(t.isInvoked({...base,text:"แปลเป็นจีน",explicit:false,now:3000}),false);
});
test("mention authorization expires and missing identity never grants followup",()=>{
 const base={scopeId:"group:expiry",userId:"user:a",now:1000};
 t.isInvoked({...base,text:"@Art TTM",explicit:true});
 assert.equal(t.isInvoked({...base,text:"แปลเป็นจีน",explicit:false,now:91001}),false);
 t.isInvoked({...base,userId:null,text:"@Art TTM",explicit:true});
 assert.equal(t.isInvoked({...base,userId:null,text:"แปลเป็นจีน",explicit:false,now:2000}),false);
});
