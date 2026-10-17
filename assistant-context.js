"use strict";

const VERSION = "tools-jobs-20261018-v2";
const MAX_BYTES = 16 * 1024 * 1024;

async function loadContextParts(loaders, log = console.error) {
  const results = await Promise.allSettled(loaders.map(fn => Promise.resolve().then(fn)));
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value || "";
    log("Assistant context source unavailable", i, r.reason?.message);
    return "";
  });
}

function reasoningOptions(env = process.env) {
  const effort = ["low", "medium", "high"].includes(env.OPENAI_REASONING_EFFORT)
    ? env.OPENAI_REASONING_EFFORT : "medium";
  return { model: env.OPENAI_REASONING_MODEL || env.OPENAI_MODEL || "gpt-5.4",
    reasoning: { effort }, text: { verbosity: "medium" }, max_output_tokens: 10000 };
}

function selectAttachments(rows, text, quotedId) {
  const list = rows.filter(x => x.file_name && x.storage_bucket && x.storage_path);
  if (quotedId) return list.filter(x => String(x.line_message_id) === String(quotedId)).slice(0, 1);
  const explicit = String(text).match(/[^\s“”"'<>]+\.(?:pdf|xlsx|xls|csv|png|jpe?g|webp|txt)/gi);
  if (explicit) return list.filter(x => explicit.some(n => x.file_name.toLowerCase() === n.toLowerCase())).slice(0, 4);
  if (!/(รูป|ภาพ|ไฟล์|เอกสาร|แนบ|ตาราง|แบบนี้|อันนี้|เมื่อกี้)/i.test(text)) return [];
  const multiple = /(เทียบ|เปรียบ|ทั้งหมด|ทุกรูป|ทุกไฟล์|ทั้งสอง|หลายรูป)/.test(text);
  // Only co-select recent uploads from the same batch; never silently mix old projects.
  const newest = Date.parse(list[0]?.created_at);
  return list.filter(x => !multiple || Math.abs(newest - Date.parse(x.created_at)) < 10 * 60 * 1000)
    .slice(0, multiple ? 4 : 1);
}

async function loadRelevantAttachments({scopeId, text, quotedId, supabaseRequest, downloadSupabaseFile, XLSX}) {
  if (!scopeId || scopeId === "unknown") return [];
  if (!quotedId && !/(รูป|ภาพ|ไฟล์|เอกสาร|แนบ|ตาราง|แบบนี้|อันนี้|เมื่อกี้|\.(pdf|xlsx|csv))/i.test(text)) return [];
  let query = "line_memories?select=file_name,mime_type,storage_bucket,storage_path,created_at,line_message_id" +
    "&scope_id=eq." + encodeURIComponent(scopeId) + "&message_type=eq.file";
  if (quotedId) query += "&line_message_id=eq." + encodeURIComponent(quotedId);
  const rows = await supabaseRequest(query + "&order=created_at.desc&limit=60", {method:"GET"}) || [];
  const chosen = selectAttachments(rows, text, quotedId);
  const content = [];
  let usedBytes = 0;
  for (const row of chosen) {
    try {
      const bytes = await downloadSupabaseFile(row.storage_bucket, row.storage_path);
      if (!bytes?.length || bytes.length + usedBytes > MAX_BYTES) {
        content.push({type:"input_text",text:`ไม่ได้อ่านต้นฉบับ ${row.file_name}: เกินขนาดที่รองรับในคำถามนี้`});
        continue;
      }
      usedBytes += bytes.length;
      const mime = row.mime_type || "";
      content.push({type:"input_text",text:`ต้นฉบับจากกลุ่มนี้: ${row.file_name} (${row.created_at})`});
      if (/^image\/(png|jpeg|webp)$/.test(mime)) {
        content.push({type:"input_image",image_url:`data:${mime};base64,${bytes.toString("base64")}`,detail:"high"});
      } else if (/\.pdf$/i.test(row.file_name)) {
        content.push({type:"input_file",filename:row.file_name,file_data:`data:application/pdf;base64,${bytes.toString("base64")}`});
      } else if (/\.(xlsx?|csv)$/i.test(row.file_name) && XLSX) {
        const wb = XLSX.read(bytes, {type:"buffer",sheetRows:301});
        const sheets = wb.SheetNames.slice(0,8).map(name => "ชีต: " + name + "\n" +
          XLSX.utils.sheet_to_csv(wb.Sheets[name]).slice(0,16000));
        content.push({type:"input_text",text:("ข้อมูลตารางจากต้นฉบับ (สูงสุด 8 ชีต, 300 แถวต่อชีต; อาจไม่ครบไฟล์และไม่ได้คำนวณสูตรใหม่):\n" + sheets.join("\n\n")).slice(0,64000)});
      } else if (/\.(txt|md|json)$/i.test(row.file_name)) {
        content.push({type:"input_text",text:bytes.toString("utf8").slice(0,40000)});
      } else content.push({type:"input_text",text:"ยังไม่ได้อ่านเนื้อหาต้นฉบับชนิดนี้ ห้ามอ้างว่าอ่านแล้ว"});
    } catch (e) {
      console.error("Attachment context unavailable", row.file_name, e.message);
      content.push({type:"input_text",text:`อ่านต้นฉบับ ${row.file_name} ไม่สำเร็จ ให้แจ้งข้อจำกัดตรงไปตรงมา`});
    }
  }
  if (!chosen.length) content.push({type:"input_text",text:"ไม่พบต้นฉบับที่ตรงคำขอใน 60 ไฟล์ล่าสุดของกลุ่มนี้ ถ้าบริบทมีเพียงสรุป ต้องแจ้งว่าอ้างอิงสรุปและอย่าเดารายละเอียดต้นฉบับ"});
  return content;
}

function splitLineText(text) {
  let remaining = String(text || "").trim();
  const parts = [];
  while (remaining && parts.length < 5) {
    let cut = remaining.length <= 4800 ? remaining.length : remaining.lastIndexOf("\n", 4800);
    if (cut < 2400) cut = Math.min(4800, remaining.length);
    // Do not split a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]/.test(remaining[cut-1]) && /[\uDC00-\uDFFF]/.test(remaining[cut] || "")) cut--;
    parts.push({type:"text",text:remaining.slice(0,cut)});
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts[parts.length-1].text += "\n(คำตอบยาวเกินขีดจำกัด LINE กรุณาขอส่วนที่เหลือต่อครับ)";
  return parts.length ? parts : [{type:"text",text:"ระบบยังไม่มีคำตอบ กรุณาลองใหม่ครับ"}];
}

module.exports = {VERSION, loadContextParts, reasoningOptions, selectAttachments, loadRelevantAttachments, splitLineText};
