"use strict";

// Owner-confirmed identity facts live in the database, never in source control.
async function identityReply({scopeId, senderId, targetId, text, request}) {
  if (!String(scopeId).startsWith("group:") ||
      !/(?:ใคร|ประวัติ|รู้จัก.*ไหม)/u.test(text)) return null;
  const rows = await request("line_memories?select=metadata&scope_id=eq."+
    encodeURIComponent(scopeId)+
    "&metadata->>kind=in.(owner_confirmed_member_bio,owner_confirmed_sender_identity)"+
    "&order=created_at.desc&limit=100", {method:"GET"});
  const facts = (rows || []).map(r=>r.metadata || {});
  if (!targetId && /(?:พี่|ผม|ฉัน|เรา)(?:เป็น|คือ)ใคร/u.test(text)) {
    const self = facts.find(m=>m.kind==="owner_confirmed_sender_identity" &&
      m.subject_line_user_id===senderId);
    return self?.exact_answer || null;
  }
  const bound = facts.filter(m=>m.kind==="owner_confirmed_member_bio" &&
    m.subject_line_user_id && m.bio_text);
  const bio = targetId ? bound.find(m=>m.subject_line_user_id===targetId) :
    bound.find(m=>m.subject_name && text.includes(m.subject_name));
  return bio?.bio_text || null;
}
module.exports = {identityReply};
