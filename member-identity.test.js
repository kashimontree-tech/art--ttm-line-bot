const test=require("node:test");
const assert=require("node:assert/strict");
const {identityReply}=require("./member-identity");
const facts=[{metadata:{kind:"owner_confirmed_member_bio",subject_line_user_id:"member-a",subject_name:"พี่ตัวอย่าง",bio_text:"ประวัติที่ยืนยัน"}},
  {metadata:{kind:"owner_confirmed_sender_identity",subject_line_user_id:"owner-a",exact_answer:"บอสผม"}}];
const base={scopeId:"group:test",senderId:"sender",text:"อาร์ตคนนี้คือใคร",request:async q=>{assert.ok(q.includes("scope_id=eq.group%3Atest"));return facts;}};
test("plain who-is retains name-only route while biography requests return facts",async()=>{
  assert.equal(await identityReply({...base,targetId:"member-a"}),null);
  assert.equal(await identityReply({...base,targetId:"member-a",text:"อาร์ตประวัติคนนี้คือใคร"}),"ประวัติที่ยืนยัน");
  assert.equal(await identityReply({...base,targetId:"member-b",text:"อาร์ตประวัติคนนี้"}),null);
});
test("owner self question is bound to sender, not the word phi",async()=>{
  assert.equal(await identityReply({...base,senderId:"owner-a",text:"อาร์ตพี่คือใคร"}),"บอสผม");
  assert.equal(await identityReply({...base,text:"อาร์ตพี่คือใคร"}),null);
});
test("named biography and group isolation",async()=>{
  assert.equal(await identityReply({...base,text:"อาร์ตประวัติพี่ตัวอย่าง"}),"ประวัติที่ยืนยัน");
  assert.equal(await identityReply({...base,scopeId:"user:test",targetId:"member-a"}),null);
});
