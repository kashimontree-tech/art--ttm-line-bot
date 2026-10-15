const express = require("express");
const crypto = require("crypto");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");

const app = express();
app.get("/slip-admin.html", (req,res) => res.sendFile(require("path").join(__dirname,"slip-admin.html")));
require("./slip-admin").setupSlipAdmin(app,{supabaseRequest,createSupabaseSignedUrl,getThaiPdfFont,uploadSupabaseFile,saveFileMemory});
const liveFileCache = new Map();
const downloadTokens = new Map();

app.get("/download/:token", (req, res) => {
  const item = downloadTokens.get(req.params.token);
  if (!item || item.expiresAt < Date.now()) {
    downloadTokens.delete(req.params.token);
    return res.status(404).send("File link expired or not found");
  }
  res.setHeader("Content-Type", item.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(item.fileName || "document")}`);
  return res.send(item.bytes);
});

function cacheLiveFile(scopeId, fileName, mime, bytes) {
  const key = String(scopeId || "unknown");
  const list = liveFileCache.get(key) || [];
  list.unshift({ fileName, mime, bytes, savedAt: Date.now() });
  liveFileCache.set(key, list.slice(0, 20));
}

function createLiveDownload(scopeId, requestedText) {
  const list = liveFileCache.get(String(scopeId || "unknown")) || [];
  if (!list.length) return null;
  const q = String(requestedText || "").toLowerCase().replace(/\s+/g, "");
  const item = list.find(x => {
    const full = String(x.fileName || "").toLowerCase().replace(/\s+/g, "");
    const stem = full.replace(/\.[^.]+$/, "");
    return q.includes(full) || (stem && q.includes(stem));
  }) || list[0];
  const token = crypto.randomBytes(24).toString("hex");
  downloadTokens.set(token, { ...item, expiresAt: Date.now() + 60 * 60 * 1000 });
  const base = process.env.RENDER_EXTERNAL_URL || "https://art-ttm-line-bot.onrender.com";
  return { item, url: `${base.replace(/\/$/, "")}/download/${token}` };
}

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

let lastLinePushTarget = null;
const pendingSukloeiNotifications = [];
const SUKLOEI_RELAY_SECRET = process.env.SUKLOEI_RELAY_SECRET || "";
const SUKLOEI_TARGET_KEY = "sukloei_family";

async function loadPersistedLineTarget() {
  if (!CLEAN_SUPABASE_URL || !CLEAN_SUPABASE_KEY) return null;
  try {
    const url = CLEAN_SUPABASE_URL.replace(/\/$/, "") +
      "/rest/v1/line_push_targets?target_key=eq." + encodeURIComponent(SUKLOEI_TARGET_KEY) +
      "&select=target_id&limit=1";
    const r = await fetch(url, {
      headers: {
        apikey: CLEAN_SUPABASE_KEY,
        Authorization: `Bearer ${CLEAN_SUPABASE_KEY}`
      }
    });
    if (!r.ok) {
      console.error("Load persisted LINE target failed:", r.status, await r.text());
      return null;
    }
    const rows = await r.json();
    return rows?.[0]?.target_id || null;
  } catch (e) {
    console.error("Load persisted LINE target error:", e);
    return null;
  }
}

async function persistLineTarget(targetId, sourceType) {
  if (!targetId || !CLEAN_SUPABASE_URL || !CLEAN_SUPABASE_KEY) return;
  try {
    const url = CLEAN_SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/line_push_targets";
    const r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: CLEAN_SUPABASE_KEY,
        Authorization: `Bearer ${CLEAN_SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        target_key: SUKLOEI_TARGET_KEY,
        target_id: targetId,
        source_type: sourceType || null,
        updated_at: new Date().toISOString()
      })
    });
    if (!r.ok) console.error("Persist LINE target failed:", r.status, await r.text());
  } catch (e) {
    console.error("Persist LINE target error:", e);
  }
}

app.post("/internal/sukloei-notify", express.json(), async (req, res) => {
  try {
    const supplied = String(req.headers["x-sukloei-secret"] || "");
    if (!SUKLOEI_RELAY_SECRET || supplied !== SUKLOEI_RELAY_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!CHANNEL_ACCESS_TOKEN) {
      return res.status(500).json({ error: "LINE token missing" });
    }
    let target = req.body?.target_id || lastLinePushTarget;
    if (!target) {
      target = await loadPersistedLineTarget();
      if (target) lastLinePushTarget = target;
    }
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    if (!target) {
      pendingSukloeiNotifications.push(text.slice(0, 4900));
      if (pendingSukloeiNotifications.length > 20) pendingSukloeiNotifications.shift();
      return res.status(202).json({ ok: true, queued: true, reason: "waiting_for_line_target" });
    }

    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: target,
        messages: [{ type: "text", text: text.slice(0, 4900) }]
      })
    });
    if (!r.ok) return res.status(502).json({ error: `LINE ${r.status}: ${await r.text()}` });
    return res.json({ ok: true, target_captured: true });
  } catch (e) {
    console.error("Sukloei relay error:", e);
    return res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.status(200).send("Art TTM LINE Bot is running");
});

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
      console.error("Missing LINE environment variables");
      return res.sendStatus(500);
    }

    const signature = safeHeaderValue(req.headers["x-line-signature"]);
    const expectedSignature = crypto
      .createHmac("SHA256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    const signatureBuffer = Buffer.from(signature || "", "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return res.status(401).send("Invalid signature");
    }

    const body = JSON.parse(req.body.toString("utf8"));
    res.sendStatus(200);

    for (const event of body.events || []) {
      const source = event.source || {};
      const capturedTarget = source.groupId || source.roomId || source.userId || null;
      if (capturedTarget) {
        lastLinePushTarget = capturedTarget;
        persistLineTarget(
          capturedTarget,
          source.groupId ? "group" : source.roomId ? "room" : "user"
        ).catch(err => console.error("Persist captured LINE target failed:", err));
      }

      if (lastLinePushTarget && pendingSukloeiNotifications.length && CHANNEL_ACCESS_TOKEN) {
        const queued = pendingSukloeiNotifications.splice(0, pendingSukloeiNotifications.length);
        for (const pendingText of queued) {
          try {
            const push = await fetch("https://api.line.me/v2/bot/message/push", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                to: lastLinePushTarget,
                messages: [{ type: "text", text: pendingText.slice(0, 4900) }]
              })
            });
            if (!push.ok) console.error("Queued Sukloei LINE push failed:", push.status, await push.text());
          } catch (pushError) {
            console.error("Queued Sukloei LINE push error:", pushError);
          }
        }
      }
      if (event.type === "message" && event.replyToken) {
        const silentGroupAttachment = isGroupConversation(source);
        if (event.message?.type === "text") await processTextEvent(event);
        else if (event.message?.type === "image") await processImageEvent(event, silentGroupAttachment);
        else if (event.message?.type === "file") await processFileEvent(event, silentGroupAttachment);
      }
    }
  } catch (error) {
    console.error("Webhook error:", error);
    if (!res.headersSent) res.sendStatus(500);
  }
});

function honorificName(name) {
  if (!name) return null;
  return /^พี่/.test(name) ? name : `พี่${name}`;
}

async function downloadLineContent(messageId) {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${CLEAN_LINE_TOKEN}` }
  });
  if (!r.ok) throw new Error(`LINE content error ${r.status}: ${await r.text()}`);
  return {
    bytes: Buffer.from(await r.arrayBuffer()),
    mime: (r.headers.get("content-type") || "application/octet-stream").split(";")[0]
  };
}

async function uploadSupabaseFile(bytes, scopeId, messageId, fileName, mime) {
  const safeScope = String(scopeId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeName = String(fileName || "document").replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${safeScope}/${Date.now()}-${messageId || "msg"}-${safeName}`;
  const bucket = process.env.SUPABASE_FILE_BUCKET || "line-files";
  const response = await fetch(
    `${CLEAN_SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "POST",
      headers: {
        apikey: CLEAN_SUPABASE_KEY,
        Authorization: `Bearer ${CLEAN_SUPABASE_KEY}`,
        "Content-Type": mime || "application/octet-stream",
        "x-upsert": "true",
      },
      body: bytes,
    }
  );
  if (!response.ok) throw new Error(`Supabase storage error ${response.status}: ${await response.text()}`);
  return { bucket, storagePath };
}

async function downloadSupabaseFile(bucket, storagePath) {
  const response = await fetch(
    `${CLEAN_SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${String(storagePath).split("/").map(encodeURIComponent).join("/")}`,
    { headers: { apikey: CLEAN_SUPABASE_KEY, Authorization: `Bearer ${CLEAN_SUPABASE_KEY}` } }
  );
  if (!response.ok) throw new Error(`Supabase storage download error ${response.status}: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function uploadOpenAIFile(bytes, fileName, mime) {
  const fd = new FormData();
  fd.append("purpose", "user_data");
  fd.append("file", new Blob([bytes], { type: mime || "application/octet-stream" }), fileName || "document");
  const r = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${CLEAN_OPENAI_KEY}` },
    body: fd
  });
  if (!r.ok) throw new Error(`OpenAI file upload error ${r.status}: ${await r.text()}`);
  return await r.json();
}

// Group chats only receive replies for a real LINE @mention of this bot or
// a direct textual invocation. Personal 1:1 chats retain their normal behavior.
function isGroupConversation(source) {
  return source?.type === "group" || source?.type === "room" || Boolean(source?.groupId || source?.roomId);
}

function isArtInvoked(event) {
  if (!isGroupConversation(event.source || {})) return true;
  const message = event.message || {};
  const text = String(message.text || "");
  const mentions = message.mention?.mentionees || [];
  const hasArtName = /(?:@\s*)?(?:อาร์ต|อาท|art(?:[\s_-]*ttm)?)(?=$|[\s,.:!?\u0E00-\u0E7F])/iu.test(text);
  // LINE may provide an @mention with an opaque user ID. Resolve that
  // identity using the known bot ID rather than responding to @anyone.
  const botUserId = process.env.LINE_BOT_USER_ID || "";
  const taggedBot = mentions.some(m =>
    m.type === "user" && Boolean(botUserId) && m.userId === botUserId
  );
  return taggedBot || hasArtName;
}

async function processFileEvent(event, silent = false) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const rawName = await getLineDisplayName(source, userId);
  const displayName = honorificName(rawName) || "พี่";
  const fileName = event.message.fileName || "document";
  let stored = null;
  let indexed = false;
  let summary = "";
  let bytes, mime;
  try {
    ({bytes,mime} = await downloadLineContent(event.message.id));
    cacheLiveFile(scopeId,fileName,mime,bytes);
  } catch(error) {
    console.error("LINE original file download failed:",error);
    if (!silent) await replyMessage(event.replyToken, `${displayName}ครับ ดาวน์โหลดต้นฉบับ “${fileName}” จาก LINE ไม่สำเร็จ จึงยังไม่ได้บันทึกครับ`);
    return;
  }
  try {
    stored = await uploadSupabaseFile(bytes,scopeId,event.message.id,fileName,mime);
    await saveFileMemory({scopeId,userId,displayName:rawName,source,fileName,lineMessageId:event.message.id,openaiFileId:null,mime,summary:"ต้นฉบับจาก LINE (รอวิเคราะห์)",storageBucket:stored.bucket,storagePath:stored.storagePath});
    indexed = true;
  } catch(error) {
    console.error("LINE file permanent archive/index failed:",error);
  }
  try {
    const uploaded = await uploadOpenAIFile(bytes,fileName,mime);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${CLEAN_OPENAI_KEY}`},
      body:JSON.stringify({
        model:process.env.OPENAI_FILE_MODEL||"gpt-5.4",
        instructions:"คุณคือ Art TTM อ่านไฟล์ตามข้อมูลจริง ไม่ยืนยันว่าเก็บไฟล์ถาวรหรือแปลงสำเร็จโดยไม่มีผลลัพธ์",
        input:[{role:"user",content:[{type:"input_file",file_id:uploaded.id},{type:"input_text",text:`สรุปสาระสำคัญของไฟล์ ${fileName} โดยเฉพาะรายการ BOQ`}]}],
        max_output_tokens:1500
      })
    });
    if(!response.ok)throw Error(`OpenAI read ${response.status}: ${await response.text()}`);
    summary=extractOutputText(await response.json())||"";
  } catch(error){console.error("LINE file analysis failed (archive retained):",error);}
  try {
    await saveMessage({lineMessageId:event.message.id||null,scopeId,userId,displayName:rawName,groupId:source.groupId||null,messageType:"file",text:`[ไฟล์: ${fileName}] ${summary||"ยังไม่สรุปเนื้อหา"}`,role:"user"});
  }catch(error){console.error("File message log failed:",error);}
  if (silent) return;
  const archiveStatus=indexed ? "เก็บต้นฉบับลงคลังถาวรและลงทะเบียนค้นหาแล้ว ✅" :
    stored ? "เก็บต้นฉบับใน Storage แล้ว แต่ลงทะเบียนค้นหาไม่สำเร็จ ต้องตรวจสอบ" :
    "ยังบันทึกถาวรไม่ได้ (ไฟล์อยู่ชั่วคราวเท่านั้น)";
  const analysisStatus=summary ? "\n"+summary.slice(0,2600) : "\nยังอ่านรายละเอียดในไฟล์ไม่สำเร็จ แต่สถานะการเก็บไฟล์เป็นไปตามที่แจ้งข้างต้น";
  await replyMessage(event.replyToken,`${displayName}ครับ รับไฟล์ “${fileName}” แล้ว — ${archiveStatus}${analysisStatus}`);
}

async function saveFileMemory({ scopeId, userId, displayName, source, fileName, lineMessageId, openaiFileId, mime, summary, storageBucket, storagePath }) {
  await supabaseRequest("line_memories", {
    method: "POST", prefer: "return=minimal",
    body: JSON.stringify([{
      line_message_id: lineMessageId, line_user_id: userId, user_id: userId,
      display_name: displayName, source_type: source.type || "unknown",
      group_id: source.groupId || null, room_id: source.roomId || null,
      message_type: "file", file_name: fileName, mime_type: mime,
      storage_bucket: storageBucket, storage_path: storagePath,
      text_content: summary, memory_text: `ไฟล์ที่เคยได้รับ: ${fileName}\nสรุป: ${summary}`,
      scope_id: scopeId,
      metadata: { source: "line", openai_file_id: openaiFileId, line_message_id: lineMessageId, storage_bucket: storageBucket, storage_path: storagePath, saved_by: "art-ttm-file-v2" }
    }])
  });
}

async function processImageEvent(event, silent = false) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const rawName = await getLineDisplayName(source, userId);
  const displayName = honorificName(rawName) || "พี่";
  try {
    // Supabase is optional for image understanding. A database/network failure must never block Vision.
    try {
      await upsertMember({ scopeId, userId, displayName: rawName, sourceType: source.type || "unknown", groupId: source.groupId || null, roomId: source.roomId || null });
    } catch (dbError) {
      console.error("Image member persistence error (non-blocking):", dbError);
    }

    const { bytes, mime } = await downloadLineContent(event.message.id);
    if (bytes.length > 15 * 1024 * 1024) throw new Error("Image too large");
    const imageExt = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const imageFileName = `LINE_image_${event.message.id}.${imageExt}`;
    cacheLiveFile(scopeId, imageFileName, mime, bytes);
    let storedImage = null;
    try {
      storedImage = await uploadSupabaseFile(bytes, scopeId, event.message.id, imageFileName, mime);
      await saveFileMemory({ scopeId, userId, displayName: rawName, source, fileName: imageFileName, lineMessageId: event.message.id, openaiFileId: null, mime, summary: "รูปภาพ/เอกสารจาก LINE", storageBucket: storedImage.bucket, storagePath: storedImage.storagePath });
    } catch (storageError) {
      console.error("Permanent image storage error (non-blocking):", storageError);
    }
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const answer = await askOpenAIImage(dataUrl, displayName);

    try {
      await saveMessage({ lineMessageId: event.message.id || null, scopeId, userId, displayName: rawName, groupId: source.groupId || null, messageType: "image", text: "[รูปภาพ] " + answer, role: "user" });
    } catch (dbError) {
      console.error("Image message persistence error (non-blocking):", dbError);
    }

    if (!silent) await replyMessage(event.replyToken, answer);
  } catch (e) {
    console.error("Image processing error:", e);
    if (!silent) await replyMessage(event.replyToken, `${displayName}ครับ ตอนนี้อาร์ตอ่านรูปนี้ไม่สำเร็จ กรุณาลองส่งรูปใหม่อีกครั้งครับ`);
  }
}

async function askOpenAIImage(dataUrl, displayName) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CLEAN_OPENAI_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-5.4",
      instructions: "คุณคือ Art TTM อ่านและวิเคราะห์รูปภาพ/เอกสารจาก LINE อย่างละเอียด ตอบภาษาไทย กระชับ ถ้าผู้ใช้ต้องการแปลงเป็น PDF ให้บอกว่าอ่านรูปได้แล้วและสรุปสิ่งที่เห็นได้ แต่ห้ามอ้างว่าส่งไฟล์ PDF สำเร็จถ้าระบบยังไม่ได้สร้างไฟล์จริง",
      input: [{ role: "user", content: [
        { type: "input_text", text: `${displayName} ส่งรูปนี้มา กรุณาอ่านรูปและช่วยตามเนื้อหาในภาพ` },
        { type: "input_image", image_url: dataUrl }
      ]}],
      max_output_tokens: 1200
    })
  });
  if (!response.ok) throw new Error(`OpenAI image error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI returned empty image response");
  return text.slice(0, 4900);
}

async function convertLatestAttachmentToExcel(scopeId, displayName) {
  const cache = liveFileCache.get(String(scopeId || "unknown")) || [];
  let source = cache.find(x => !/\.(csv|xlsx)$/i.test(String(x.fileName || ""))) || null;

  if (!source) {
    try {
      const rows = (await supabaseRequest(
        "line_memories?select=file_name,mime_type,storage_bucket,storage_path,created_at" +
        `&scope_id=eq.${encodeURIComponent(scopeId)}&message_type=eq.file&order=created_at.desc&limit=20`,
        { method: "GET" }
      )) || [];
      const row = rows.find(r => !/\.(csv|xlsx)$/i.test(String(r.file_name || "")) && r.storage_bucket && r.storage_path);
      if (row) {
        const bytes = await downloadSupabaseFile(row.storage_bucket, row.storage_path);
        source = { fileName: row.file_name || "document", mime: row.mime_type || "application/octet-stream", bytes };
        cacheLiveFile(scopeId, source.fileName, source.mime, source.bytes);
      }
    } catch (e) {
      console.error("Load persistent source for conversion error:", e);
    }
  }

  if (!source) {
    return `${displayName || "พี่"}ครับ ยังไม่พบไฟล์ต้นฉบับสำหรับแปลง กรุณาส่ง PDF/รูปมาก่อนครับ`;
  }

  let content;
  if (String(source.mime || "").startsWith("image/")) {
    const imageUrl = `data:${source.mime};base64,${source.bytes.toString("base64")}`;
    content = [
      { type: "input_text", text: "อ่านข้อความทั้งหมดจากเอกสารในภาพนี้ โดยเฉพาะตารางรายการสินค้า/งาน จำนวน หน่วย ราคาต่อหน่วย จำนวนเงิน รวมเงิน VAT และยอดสุทธิ แล้วส่งกลับเป็น JSON ตามรูปแบบที่กำหนด ห้ามตัดรายการที่มองเห็นได้" },
      { type: "input_image", image_url: imageUrl }
    ];
  } else {
    const uploaded = await uploadOpenAIFile(source.bytes, source.fileName, source.mime);
    content = [
      { type: "input_file", file_id: uploaded.id },
      { type: "input_text", text: "อ่านเอกสารนี้ทั้งหมด โดยเฉพาะตารางรายการ จำนวน หน่วย ราคาต่อหน่วย จำนวนเงิน รวมเงิน VAT และยอดสุทธิ แล้วส่งกลับเป็น JSON ตามรูปแบบที่กำหนด ห้ามตัดรายการที่อ่านได้" }
    ];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CLEAN_OPENAI_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_FILE_MODEL || "gpt-5.4",
      instructions:
        'Return ONLY valid JSON, no markdown. Schema: {"document":{"document_type":"","number":"","date":"","issuer":"","customer":"","customer_address":"","subtotal":"","vat":"","grand_total":"","amount_text":"","notes":""},"items":[{"no":"","description":"","qty":"","unit":"","unit_price":"","amount":""}]}. Extract every visible line item. Do not duplicate header rows. If a value is missing use empty string.',
      input: [{ role: "user", content }],
      max_output_tokens: 6000
    })
  });

  if (!response.ok) throw new Error(`Excel conversion error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  let raw = extractOutputText(data).trim();
  raw = raw.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Excel JSON parse error:", e, raw.slice(0, 1000));
    throw new Error("Could not parse extracted document data");
  }

  const doc = parsed.document || {};
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  const summaryRows = [
    ["ประเภทเอกสาร", doc.document_type || ""],
    ["เลขที่", doc.number || ""],
    ["วันที่", doc.date || ""],
    ["บริษัทผู้ออก", doc.issuer || ""],
    ["ชื่อลูกค้า", doc.customer || ""],
    ["ที่อยู่ลูกค้า", doc.customer_address || ""],
    ["รวมเงิน", doc.subtotal || ""],
    ["VAT", doc.vat || ""],
    ["ยอดสุทธิ", doc.grand_total || ""],
    ["จำนวนเงินตัวอักษร", doc.amount_text || ""],
    ["หมายเหตุ", doc.notes || ""]
  ];

  const itemRows = items.map((x, i) => ({
    "ลำดับ": x.no || String(i + 1),
    "รายละเอียด": x.description || "",
    "จำนวน": x.qty || "",
    "หน่วย": x.unit || "",
    "ราคาต่อหน่วย": x.unit_price || "",
    "จำนวนเงิน": x.amount || ""
  }));

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 22 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "สรุปเอกสาร");

  const wsItems = XLSX.utils.json_to_sheet(itemRows.length ? itemRows : [{
    "ลำดับ": "", "รายละเอียด": "ไม่พบรายการสินค้า/งานที่อ่านได้จากต้นฉบับ", "จำนวน": "", "หน่วย": "", "ราคาต่อหน่วย": "", "จำนวนเงิน": ""
  }]);
  wsItems["!cols"] = [{ wch: 10 }, { wch: 70 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsItems, "รายการ");

  const xlsxBytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const stem = String(source.fileName || "converted").replace(/\.[^.]+$/, "");
  const outName = `${stem}.xlsx`;
  cacheLiveFile(scopeId, outName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes);
  const dl = createLiveDownload(scopeId, outName);

  return `${displayName || "พี่"}ครับ แปลงเป็น Excel จริงให้แล้วครับ ✅\n\nไฟล์: ${outName}\nมี 2 ชีต: “สรุปเอกสาร” และ “รายการ”\nดาวน์โหลด:\n${dl.url}\n\nลิงก์ใช้ได้ 1 ชั่วโมงครับ`;
}

let cachedThaiFont = null;

async function getThaiPdfFont() {
  if (cachedThaiFont) return cachedThaiFont;
  const fontUrl = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf";
  const r = await fetch(fontUrl);
  if (!r.ok) throw new Error(`Thai font download error ${r.status}`);
  cachedThaiFont = Buffer.from(await r.arrayBuffer());
  return cachedThaiFont;
}

function wantsPdfConversion(text) {
  return /(แปลง|ทำ|เปลี่ยน).*(pdf|พีดีเอฟ)|(?:pdf|พีดีเอฟ).*(แปลง|ทำ|เปลี่ยน)/i.test(text || "");
}

async function convertLatestExcelToPdf(scopeId, displayName) {
  const cache = liveFileCache.get(String(scopeId || "unknown")) || [];
  let source = cache.find(x => /\.xlsx$/i.test(String(x.fileName || ""))) || null;

  if (!source) {
    try {
      const rows = (await supabaseRequest(
        "line_memories?select=file_name,mime_type,storage_bucket,storage_path,created_at" +
        `&scope_id=eq.${encodeURIComponent(scopeId)}&message_type=eq.file&order=created_at.desc&limit=30`,
        { method: "GET" }
      )) || [];
      const row = rows.find(r => /\.xlsx$/i.test(String(r.file_name || "")) && r.storage_bucket && r.storage_path);
      if (row) {
        const bytes = await downloadSupabaseFile(row.storage_bucket, row.storage_path);
        source = { fileName: row.file_name, mime: row.mime_type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes };
        cacheLiveFile(scopeId, source.fileName, source.mime, source.bytes);
      }
    } catch (e) {
      console.error("Load XLSX for PDF conversion error:", e);
    }
  }

  if (!source) {
    return `${displayName || "พี่"}ครับ ยังไม่พบไฟล์ Excel (.xlsx) สำหรับแปลงเป็น PDF กรุณาส่งไฟล์ Excel มาก่อนครับ`;
  }

  const workbook = XLSX.read(source.bytes, { type: "buffer", cellDates: false });
  const thaiFont = await getThaiPdfFont();

  const pdfBytes = await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24, autoFirstPage: false });
      const chunks = [];
      doc.on("data", chunk => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.registerFont("Thai", thaiFont);

      // Render every Excel column. Wide sheets are split into 8-column bands,
      // with all rows repeated in each band so BOQ price columns are never lost.
      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: false });
        const maxCols = Math.max(1, ...rows.map(r => Array.isArray(r) ? r.length : 0));
        const columnsPerPage = 8;
        for (let colStart = 0; colStart < maxCols; colStart += columnsPerPage) {
          const colEnd = Math.min(maxCols, colStart + columnsPerPage);
          const renderCols = colEnd - colStart;
          const addTablePage = (continued = false) => {
            doc.addPage();
            doc.font("Thai").fontSize(12).text(
              String(sheetName) + (maxCols > columnsPerPage ? ` (คอลัมน์ ${colStart + 1}-${colEnd} จาก ${maxCols})` : "") + (continued ? " (ต่อ)" : ""),
              { align: "left" }
            );
            doc.moveDown(0.4);
            doc.font("Thai").fontSize(7);
          };
          addTablePage();
          const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const colWidth = pageWidth / renderCols;
          for (const row of rows) {
            const vals = Array.isArray(row) ? row : [];
            const texts = Array.from({ length: renderCols }, (_, i) => String(vals[colStart + i] ?? ""));
            doc.font("Thai").fontSize(7);
            const heights = texts.map(t => doc.heightOfString(t || " ", { width: colWidth - 8, lineGap: 1 }));
            const rowH = Math.max(20, Math.min(96, Math.max(...heights) + 8));
            if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) addTablePage(true);
            const y = doc.y;
            let x = doc.page.margins.left;
            for (let i = 0; i < renderCols; i++) {
              doc.rect(x, y, colWidth, rowH).stroke();
              doc.font("Thai").fontSize(7).text(texts[i], x + 4, y + 4, {
                width: colWidth - 8, height: rowH - 8, ellipsis: true, lineGap: 1
              });
              x += colWidth;
            }
            doc.y = y + rowH;
          }
        }
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });

  const stem = String(source.fileName || "converted").replace(/\.xlsx$/i, "");
  const outName = `${stem}.pdf`;
  cacheLiveFile(scopeId, outName, "application/pdf", pdfBytes);

  let downloadUrl = null;
  let isPersistentLink = false;
  try {
    const stored = await uploadSupabaseFile(pdfBytes, scopeId, "generated-pdf", outName, "application/pdf");
    try {
      await saveFileMemory({
        scopeId, userId: null, displayName: "Art TTM", source: { type: "bot" },
        fileName: outName, lineMessageId: null, openaiFileId: null,
        mime: "application/pdf", summary: `PDF converted from ${source.fileName}`,
        storageBucket: stored.bucket, storagePath: stored.storagePath
      });
    } catch (memoryError) {
      console.error("Save PDF memory failed (non-blocking):", memoryError);
    }
    downloadUrl = await createSupabaseSignedUrl(stored.bucket, stored.storagePath, 3600);
    isPersistentLink = true;
  } catch (e) {
    console.error("Persist/sign generated PDF failed; using live fallback:", e);
  }
  if (!downloadUrl) {
    const dl = createLiveDownload(scopeId, outName);
    downloadUrl = dl?.url || null;
  }
  if (!downloadUrl) throw new Error("Unable to create PDF download URL");
  return `${displayName || "พี่"}ครับ แปลง Excel เป็น PDF ให้แล้วครับ ✅\n\nไฟล์: ${outName}\nดาวน์โหลด:\n${downloadUrl}\n\nลิงก์ใช้ได้ 1 ชั่วโมงครับ`;

}

function wantsExcelConversion(text) {
  return /(แปลง|ทำ|เปลี่ยน).*(excel|xlsx|เอ็กเซล)|(?:excel|xlsx|เอ็กเซล).*(แปลง|ทำ|เปลี่ยน)/i.test(text || "");
}

async function processTextEvent(event) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const sourceType = source.type || "unknown";
  const userText = event.message.text;
  const rawDisplayName = await getLineDisplayName(source, userId);
  const displayName = honorificName(rawDisplayName);
  let mentionedMembers = [];

  try {
    mentionedMembers = await captureMentionedMembers(event, scopeId);
    await upsertMember({
      scopeId, userId, displayName: rawDisplayName, sourceType,
      groupId: source.groupId || null,
      roomId: source.roomId || null,
    });
    await saveMessage({
      lineMessageId: event.message.id || null,
      scopeId, userId, displayName: rawDisplayName,
      groupId: source.groupId || null,
      messageType: "text", text: userText, role: "user",
    });
    await saveLongTermMemory({
      scopeId, userId, displayName: rawDisplayName, sourceType, source,
      text: userText, lineMessageId: event.message.id || null,
      mentionedMembers,
    });
  } catch (error) {
    console.error("Supabase write error:", error);
  }

  if (!isArtInvoked(event)) return; // Do not interrupt ordinary group conversation.

  let recentContext = "";
  let memberContext = "";
  let longTermMemory = "";
  try {
    [recentContext, memberContext, longTermMemory] = await Promise.all([
      loadRecentContext(scopeId),
      loadMemberContext(scopeId),
      loadLongTermMemory(scopeId),
    ]);
  } catch (error) {
    console.error("Supabase read error:", error);
  }

  let answer;
  try {
    answer = directIdentityReply(userText, displayName) ||
      (require("./archive-search").isFileCatalogRequest(userText) ? await require("./archive-search").listFileCatalog({scopeId,displayName,supabaseRequest}) : null) ||
      (require("./material-research").isMaterialResearch(userText) ? await require("./material-research").researchMaterials(userText,{key:CLEAN_OPENAI_KEY,model:OPENAI_MODEL,displayName}) : null) ||
      (require("./archive-search").isSearchRequest(userText) ? await require("./archive-search").searchArchive({text:userText,scopeId,displayName,supabaseRequest,createSupabaseSignedUrl}) : null) ||
      (/(อัปเดต|อัพเดท|เพิ่ม|แนบเพิ่ม)/i.test(userText) && /(รูป|สลิป|อัลบั้ม|ไฟล์)/i.test(userText) ? await addLatestSlipToAlbum(scopeId,displayName,userText) : null) ||
      (/(สลิป|slip|อัลบั้ม|album|เจมาร์ท|j.?mart)/i.test(userText) && /(อัลบั้ม|album|excel|เอ็กเซล|ยอดเงิน|จำนวนเงิน|สรุปยอด)/i.test(userText) ? await makeDetailedSlipAlbum(scopeId,displayName,userText) : null) ||
      (/(สลิป|slip)/i.test(userText) && /(รวม|ทำไฟล์|pdf|พีดีเอฟ|สร้างไฟล์)/i.test(userText) ? await makeSlipReport(scopeId,displayName) : null) ||
      (wantsPdfConversion(userText) ? await convertLatestExcelToPdf(scopeId, displayName) : null) ||
      (wantsExcelConversion(userText) ? await convertLatestAttachmentToExcel(scopeId, displayName) : null) ||
      await maybeSaveLatestAttachment(userText, scopeId, displayName) ||
      await maybeReturnKnownFile(userText, scopeId, displayName) ||
      await askOpenAI(userText, recentContext, memberContext, longTermMemory, displayName, mentionedMembers);
  } catch (error) {
    console.error("OpenAI processing error:", error);
    answer = "ขออภัยครับ ระบบ Art TTM มีปัญหาชั่วคราว กรุณาลองส่งข้อความอีกครั้งครับ";
  }

  try {
    await saveMessage({
      lineMessageId: null, scopeId, userId: null, displayName: "Art TTM",
      groupId: source.groupId || null, messageType: "text", text: answer, role: "assistant",
    });
  } catch (error) {
    console.error("Supabase assistant write error:", error);
  }

  try {
    await replyMessage(event.replyToken, answer);
  } catch (error) {
    console.error("LINE reply error:", error);
  }
}

function getScopeId(source) {
  if (source.type === "group" && source.groupId) return `group:${source.groupId}`;
  if (source.type === "room" && source.roomId) return `room:${source.roomId}`;
  if (source.userId) return `user:${source.userId}`;
  return "unknown";
}

async function getLineDisplayName(source, userId) {
  if (!userId) return null;
  try {
    let url;
    if (source.type === "group" && source.groupId) {
      url = `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(userId)}`;
    } else if (source.type === "room" && source.roomId) {
      url = `https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(userId)}`;
    } else {
      url = `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`;
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${CLEAN_LINE_TOKEN}` },
    });
    if (!response.ok) {
      console.error("LINE member profile error:", response.status, await response.text());
      return null;
    }
    const data = await response.json();
    return data.displayName || null;
  } catch (error) {
    console.error("LINE member profile exception:", error);
    return null;
  }
}

async function captureMentionedMembers(event, scopeId) {
  const source = event.source || {};
  const mentionees = event.message?.mention?.mentionees || [];
  const captured = [];
  for (const mention of mentionees) {
    if (mention.type !== "user" || !mention.userId) continue;
    const name = await getLineDisplayName(source, mention.userId);
    if (!name) continue;
    await upsertMember({
      scopeId,
      userId: mention.userId,
      displayName: name,
      sourceType: source.type || "unknown",
      groupId: source.groupId || null,
      roomId: source.roomId || null,
    });
    captured.push({ userId: mention.userId, displayName: name });
  }
  return captured;
}

function supabaseHeaders(prefer) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("Missing Supabase environment variables");
  }
  const headers = {
    apikey: CLEAN_SUPABASE_KEY,
    Authorization: `Bearer ${CLEAN_SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function safeHeaderValue(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201C\u201D]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "");
}

function cleanEnvUrl(value) {
  let v = safeHeaderValue(value);
  const m = v.match(/https?:\/\/[^\s"'<>]+/i);
  v = m ? m[0].replace(/[),;]+$/, "") : v;
  // Remove accidental trailing punctuation from copied smart quotes.
  try {
    const u = new URL(v);
    u.hostname = u.hostname.replace(/[^a-z0-9.-]/gi, "").replace(/\.+$/, "");
    return u.origin;
  } catch {
    return v.replace(/[.,]+$/, "");
  }
}

// Use the Render environment URL; do not override it with a hard-coded hostname.
const CLEAN_SUPABASE_URL = cleanEnvUrl(SUPABASE_URL);
const CLEAN_SUPABASE_KEY = safeHeaderValue(process.env["SUPABASE_" + "SECRET_KEY"]).replace(/^SUPABASE_SECRET_KEY=/i, "");
const CLEAN_LINE_TOKEN = safeHeaderValue(process.env["LINE_" + "CHANNEL_ACCESS_TOKEN"]).replace(/^LINE_CHANNEL_ACCESS_TOKEN=/i, "");
const CLEAN_OPENAI_KEY = safeHeaderValue(process.env["OPENAI_" + "API_KEY"]).replace(/^OPENAI_API_KEY=/i, "");

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${CLEAN_SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(options.prefer),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Supabase error ${response.status}: ${await response.text()}`
    );
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function upsertMember({
  scopeId,
  userId,
  displayName,
  sourceType,
  groupId,
  roomId,
}) {
  if (!userId) return;

  const now = new Date().toISOString();
  await supabaseRequest("line_members?on_conflict=line_user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify([
      {
        line_user_id: userId,
        user_id: userId,
        scope_id: scopeId,
        display_name: displayName,
        source_type: sourceType,
        group_id: groupId,
        room_id: roomId,
        last_seen_at: now,
        updated_at: now,
      },
    ]),
  });
}

async function saveMessage({
  lineMessageId,
  scopeId,
  userId,
  displayName,
  groupId,
  messageType,
  text,
  role,
}) {
  await supabaseRequest("line_messages", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([
      {
        line_message_id: lineMessageId,
        line_user_id: userId,
        user_id: userId,
        line_group_id: groupId,
        scope_id: scopeId,
        display_name: displayName,
        message_type: messageType,
        message_text: text,
        content: text,
        role,
      },
    ]),
  });
}

async function loadRecentContext(scopeId) {
  const query =
    "line_messages?select=display_name,role,content,message_text,created_at" +
    `&scope_id=eq.${encodeURIComponent(scopeId)}` +
    "&order=created_at.desc&limit=20";

  const rows = (await supabaseRequest(query, { method: "GET" })) || [];
  return rows
    .reverse()
    .map((row) => {
      const speaker =
        row.role === "assistant" ? "Art TTM" : row.display_name || "ผู้ใช้";
      const text = row.content || row.message_text || "";
      return text ? `${speaker}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(-12000);
}

async function loadMemberContext(scopeId) {
  const rows = (await supabaseRequest(
    "line_members?select=line_user_id,display_name,ttm_name,role,role_name,department,notes" +
      `&scope_id=eq.${encodeURIComponent(scopeId)}&order=last_seen_at.desc&limit=50`,
    { method: "GET" }
  )) || [];
  return rows.map((m) =>
    [m.display_name, m.ttm_name, m.role_name || m.role, m.department, m.notes]
      .filter(Boolean).join(" | ")
  ).filter(Boolean).join("\n");
}

async function loadLongTermMemory(scopeId) {
  const rows = (await supabaseRequest(
    "line_memories?select=display_name,memory_text,text_content,created_at" +
      `&scope_id=eq.${encodeURIComponent(scopeId)}&order=created_at.desc&limit=50`,
    { method: "GET" }
  )) || [];
  return rows.reverse().map((m) =>
    `${m.display_name || "ผู้ใช้"}: ${m.memory_text || m.text_content || ""}`
  ).filter((x) => !x.endsWith(": ")).join("\n").slice(-16000);
}

async function createSupabaseSignedUrl(bucket, storagePath, expiresIn = 3600) {
  const response = await fetch(
    `${CLEAN_SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${String(storagePath).split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "POST",
      headers: {
        apikey: CLEAN_SUPABASE_KEY,
        Authorization: `Bearer ${CLEAN_SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    }
  );
  if (!response.ok) throw new Error(`Supabase signed URL error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const signedPath = data.signedURL || data.signedUrl || data.signed_url;
  if (!signedPath) throw new Error("Supabase did not return a signed URL");
  return signedPath.startsWith("http") ? signedPath : `${CLEAN_SUPABASE_URL}/storage/v1${signedPath}`;
}

function slipAlbumName(text) {
  const value=String(text||"");
  const match=value.match(/(?:อัลบั้ม|โครงการ)\s*([\u0E00-\u0E7Fa-z0-9 _-]{2,70})/i);
  if (!match) return "ทั่วไป";
  let name=match[1].trim();
  name=name.replace(/\s*(?:pdf|excel|xlsx|พีดีเอฟ|เอ็กเซล|สรุป|รายงาน|อัปเดต|อัพเดท|เพิ่มเติม|ส่งออก|ให้|ครับ|ค่ะ|ด้วย|ล่าสุด).*$/i,"").trim();
  const normalized=name.replace(/\s+/g,"");
  if (/^(?:เจมาร์|เจมาร์ท|เจมาร์ต|jaymart|jmart)(?:อุดร|อุดรธานี)$/i.test(normalized)) return "เจมาร์ทอุดร";
  return name.slice(0,60)||"ทั่วไป";
}
async function addLatestSlipToAlbum(scopeId,displayName,text) {
  const requested=slipAlbumName(text);
  const rows=await supabaseRequest("line_memories?select=id,file_name,mime_type,storage_bucket,storage_path,metadata,created_at"+
    `&scope_id=eq.${encodeURIComponent(scopeId)}&order=created_at.desc&limit=100`,{method:"GET"});
  const pictures=(rows||[]).filter(x=>/^image\/(png|jpeg)$/i.test(x.mime_type||"")&&x.storage_bucket&&x.storage_path);
  if(!pictures.length) return `${displayName||"พี่"}ครับ ยังไม่มีรูปที่บันทึกในกลุ่ม กรุณาส่งรูปเข้ากลุ่มก่อนครับ`;
  const album=requested!=="ทั่วไป" ? requested : (pictures.find(x=>x.metadata?.album_name)?.metadata.album_name||"ทั่วไป");
  // Do not keep claiming success for the same photo: take the newest image not yet in this album.
  const latest=pictures[0];
  if (Date.now()-new Date(latest.created_at).getTime()>15*60*1000) return `${displayName||"พี่"}ครับ รูปล่าสุดเกิน 15 นาทีแล้ว กรุณาส่งรูปใหม่แล้วสั่งอัปเดตอีกครั้งครับ`;
  if (latest.metadata?.album_name===album) return `${displayName||"พี่"}ครับ รูปล่าสุดอยู่ในอัลบั้ม “${album}” แล้ว ไม่เพิ่มซ้ำครับ`;
  if(!latest) return `${displayName||"พี่"}ครับ รูปทั้งหมดที่บอทได้รับอยู่ในอัลบั้ม “${album}” แล้ว ไม่มีรูปใหม่ให้เพิ่มครับ`;
  const meta={...(latest.metadata||{}),album_name:album};
  await supabaseRequest(`line_memories?id=eq.${encodeURIComponent(latest.id)}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({metadata:meta})});
  const count=pictures.filter(x=>x.id===latest.id||x.metadata?.album_name===album).length;
  return `${displayName||"พี่"}ครับ เพิ่มรูป “${latest.file_name}” เข้าอัลบั้ม “${album}” สำเร็จ ✅ ตอนนี้มี ${count} รูป\nถ้าต้องการไฟล์ใหม่ พิมพ์ “อาร์ต ทำอัลบั้ม ${album} PDF Excel” ครับ`;
}
async function makeDetailedSlipAlbum(scopeId, displayName, requestText = '') {
  const {readSlip,makeExports,makeReportPdf}=require("./slip-album");
  const rows=await supabaseRequest("line_memories?select=file_name,mime_type,storage_bucket,storage_path,metadata,created_at" +
    `&scope_id=eq.${encodeURIComponent(scopeId)}&order=created_at.desc&limit=500`,{method:"GET"});
  const album=slipAlbumName(requestText);
  const all=(rows||[]).filter(x=>/^image\/(jpeg|png)$/i.test(x.mime_type||"")&&x.storage_bucket&&x.storage_path);
  const chosen=album==="ทั่วไป" ? all : all.filter(x=>x.metadata?.album_name===album);
  const unique=Array.from(new Map(chosen.map(x=>[x.storage_path,x])).values());
  const picked=unique.slice().reverse();
  if(!picked.length) return `${displayName||"พี่"}ครับ ยังไม่มีสลิปที่บันทึกไว้ในกลุ่มนี้ครับ`;
  const items=[];
  for(const x of picked) {
    try {
      const bytes=await downloadSupabaseFile(x.storage_bucket,x.storage_path);
      let fields={amount:null,date:"",reference:"",sender:"",receiver:"",confidence:"low"};
      try { fields=await readSlip({bytes,mime:x.mime_type},CLEAN_OPENAI_KEY); }
      catch(e){console.error("Slip recognition failed:",e);}
      items.push({...fields,bytes,fileName:x.file_name||"slip"});
    } catch(e){console.error("Slip download failed:",e);}
  }
  if(!items.length) return `${displayName||"พี่"}ครับ โหลดรูปสลิปไม่ได้ กรุณาลองใหม่ครับ`;
  const {excel,total,excluded}=makeExports(items);
  const pdf=await makeReportPdf(items,await getThaiPdfFont());
  const stamp=Date.now();
  const out=[];
  for(const [name,bytes,mime] of [
    [`TTM_Slip_Album_${stamp}.pdf`,pdf,"application/pdf"],
    [`TTM_Slip_Summary_${stamp}.xlsx`,excel,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
  ]) {
    const stored=await uploadSupabaseFile(bytes,scopeId,"slip-album",name,mime);
    const url=await createSupabaseSignedUrl(stored.bucket,stored.storagePath,3600);
    out.push(name+"\n"+url);
    try{await saveFileMemory({scopeId,userId:null,displayName:"Art TTM",source:{type:"bot"},fileName:name,lineMessageId:null,openaiFileId:null,mime,summary:"Slip album export",storageBucket:stored.bucket,storagePath:stored.storagePath});}
    catch(e){console.error("Slip album memory error:",e);}
  }
  return `${displayName||"พี่"}ครับ ทำอัลบั้ม PDF และ Excel จาก ${items.length} รูปแล้วครับ\nยอดที่ AI อ่านได้ความมั่นใจสูง: ${total.toLocaleString("en-US",{minimumFractionDigits:2})} บาท\nรอตรวจสอบ: ${excluded} รูป\nยังไม่ใช่ยอดบัญชีที่ยืนยันแล้ว ต้องตรวจสลิปซ้ำครับ\n\n${out.join("\n\n")}\nลิงก์ใช้ได้ 1 ชั่วโมงครับ`;
}

async function makeSlipReport(scopeId, displayName) {
  const {createSlipPdf} = require("./slip-report");
  const rows = await supabaseRequest("line_memories?select=file_name,mime_type,storage_bucket,storage_path,created_at" +
    `&scope_id=eq.${encodeURIComponent(scopeId)}&order=created_at.desc&limit=40`, {method:"GET"});
  const pictures = (rows || []).filter(x => /^image\/(png|jpeg)$/i.test(x.mime_type || "") && x.storage_bucket && x.storage_path).slice(0,15);
  if (!pictures.length) return `${displayName || "พี่"}ครับ ยังไม่มีรูปสลิปในคลัง กรุณาส่งรูปเข้ากลุ่มอีกครั้งครับ`;
  const images = [];
  for (const pic of pictures.reverse()) {
    try { images.push({bytes:await downloadSupabaseFile(pic.storage_bucket,pic.storage_path)}); }
    catch(error){console.error("Slip load error:",error);}
  }
  if (!images.length) return `${displayName || "พี่"}ครับ ไม่สามารถเปิดรูปที่เก็บไว้ได้ครับ`;
  const bytes = await createSlipPdf(images);
  const fileName = `TTM_Slip_Report_${Date.now()}.pdf`;
  const stored = await uploadSupabaseFile(bytes,scopeId,"slip-report",fileName,"application/pdf");
  const url = await createSupabaseSignedUrl(stored.bucket,stored.storagePath,3600);
  await saveFileMemory({scopeId,userId:null,displayName:"Art TTM",source:{type:"bot"},fileName,lineMessageId:null,openaiFileId:null,mime:"application/pdf",summary:`รวมภาพสลิป ${images.length} รูป`,storageBucket:stored.bucket,storagePath:stored.storagePath});
  return `${displayName || "พี่"}ครับ รวมรูปสลิป ${images.length} รูปเป็น PDF แล้วครับ\n${fileName}\n${url}\nลิงก์ใช้ได้ 1 ชั่วโมงครับ`;
}

async function maybeSaveLatestAttachment(text, scopeId, displayName) {
  if (!/(บันทึก.*ไฟล์|จำ.*ไฟล์|เก็บ.*ไฟล์|บันทึก.*รูป|เก็บ.*รูป)/i.test(text || "")) return null;
  const list = liveFileCache.get(String(scopeId || "unknown")) || [];
  if (!list.length) {
    return `${displayName || "พี่"}ครับ ตอนนี้อาร์ตยังไม่พบไฟล์หรือรูปต้นฉบับในข้อความล่าสุด กรุณาส่งไฟล์/รูปเข้าห้องนี้ก่อน แล้วพิมพ์ “อาร์ตบันทึกไฟล์นี้” ครับ`;
  }
  const item = list[0];
  return `${displayName || "พี่"}ครับ อาร์ตบันทึกไฟล์ล่าสุด “${item.fileName}” ไว้แล้วครับ ✅ ถ้าต้องการรับกลับ พิมพ์ “อาร์ตส่งไฟล์ที่บันทึกกลับมา” ได้เลยครับ`;
}

async function maybeReturnKnownFile(text, scopeId, displayName) {
  if (!/(ส่ง.*ไฟล์|ไฟล์.*กลับ|ขอ.*ไฟล์|เอา.*ไฟล์|ดาวน์โหลด.*ไฟล์|ส่ง.*กลับ|ค้นหา.*ไฟล์|ลิงก์ดาวน์โหลด|ขอลิงก์)/i.test(text || "")) return null;
  const normalized = x => String(x||"").toLowerCase().replace(/\s+/g,"").replace(/[^a-z0-9\u0e00-\u0e7f.]/gi,"");
  const query = normalized(text);
  let rows = [];
  try {
    // Always query permanent storage first. An expired one-hour link does NOT
    // mean the source file has expired. Generate a fresh signed URL each time.
    rows = await supabaseRequest("line_memories?select=file_name,mime_type,storage_bucket,storage_path,created_at" +
      `&scope_id=eq.${encodeURIComponent(scopeId)}&message_type=eq.file&storage_path=not.is.null&order=created_at.desc&limit=500`,{method:"GET"});
  } catch(error) { console.error("Permanent file lookup failed:",error); }
  const stored = (rows||[]).filter(x=>x.storage_bucket&&x.storage_path);
  const matches = stored.filter(x => {
    const full = normalized(x.file_name),stem=full.replace(/\.[^.]+$/,"");
    return Boolean(full&&query.includes(full) || stem&&stem.length>=5&&query.includes(stem));
  });
  // If caller explicitly specifies a filename, do not return an unrelated file.
  const explicitName = /\.(xlsx?|pdf|docx?|png|jpe?g|zip)\b/i.test(text||"");
  // Never substitute the newest file for a request naming a project or filename.
  const wantsLatest = /(?:ล่าสุด|ใหม่สุด|เพิ่งส่ง)/i.test(text||"") && !explicitName;
  const projectWords = String(text||"").replace(/อาร์ต|ส่ง|ไฟล์|กลับมา|กลับ|ให้|หน่อย|ครับ|ค่ะ|ขอ|ดาวน์โหลด|ลิงก์|ค้นหา|ที่บันทึกไว้|จากคลัง|ใหม่/gi,"").trim();
  const projectKey = normalized(projectWords);
  const namedMatches = matches.length ? matches : (projectKey.length>=3 ? stored.filter(x=>normalized(x.file_name).includes(projectKey)) : []);
  const chosen=namedMatches[0] || (wantsLatest ? stored[0] : null);
  if(chosen) {
    try {
      const url=await createSupabaseSignedUrl(chosen.storage_bucket,chosen.storage_path,3600);
      return `${displayName||"พี่"}ครับ พบต้นฉบับ “${chosen.file_name}” ในคลังถาวรแล้วครับ ✅\nลิงก์ดาวน์โหลดใหม่:\n${url}\n\nลิงก์นี้ใช้ได้ 1 ชั่วโมง แต่ต้นฉบับยังเก็บอยู่ เรียกใหม่เมื่อไรก็ได้ครับ`;
    }catch(e){console.error("Signed file URL failed:",e);}
  }
  const liveList=liveFileCache.get(String(scopeId||"unknown"))||[];
  const live=liveList.find(x=>{const full=normalized(x.fileName),stem=full.replace(/\.[^.]+$/,"");return full&&query.includes(full)||stem.length>=5&&query.includes(stem)||projectKey.length>=3&&full.includes(projectKey)})||(wantsLatest?liveList[0]:null);
  if(live) {
    const dl=createLiveDownload(scopeId,live.fileName);
    if(dl)return `${displayName||"พี่"}ครับ พบไฟล์ “${dl.item.fileName}” เฉพาะในหน่วยความจำชั่วคราว\n${dl.url}\nควรเก็บต้นฉบับลงคลังถาวรด้วยครับ`;
  }
  return `${displayName||"พี่"}ครับ ยังไม่พบต้นฉบับไฟล์ที่ขอในคลังของ LINE กลุ่มนี้ครับ หากเคยส่งในห้องอื่นต้องเรียกในห้องเดิม หรือส่งต้นฉบับเข้าห้องนี้เพื่อบันทึกครับ`;
}

function directIdentityReply(text, displayName) {
  if (!displayName) return null;
  const t = (text || "").trim();
  // Identity questions must be answered from the LINE sender profile, not inferred by the model.
  if (/(ผม|ฉัน|หนู|เรา|พี่)?\s*ชื่อ\s*(อะไร|ว่าอะไร)|ชื่อผม|ชื่อฉัน|ชื่อหนู|รู้จักผมไหม|รู้จักฉันไหม|จำผมได้ไหม|จำฉันได้ไหม/i.test(t)) {
    return `ชื่อใน LINE ของคุณคือ ${honorificName(displayName)} ครับ 😊`;
  }
  return null;
}

function looksLikeMemory(text) {
  return /(จำไว้|จำว่า|ชื่อ.*คือ|เรียกว่า|เป็นแฟน|เป็นภรรยา|เป็นสามี|เป็นลูก|เป็นพี่|เป็นน้อง|ตำแหน่ง|โปรเจกต์.*ชื่อ|โครงการ.*ชื่อ)/i.test(text || "");
}

async function saveLongTermMemory({ scopeId, userId, displayName, sourceType, source, text, lineMessageId, mentionedMembers = [] }) {
  if (!looksLikeMemory(text)) return;
  const mentionedNames = mentionedMembers.map((m) => m.displayName).filter(Boolean);
  const relationMatch = (text || "").match(/(แฟน|ภรรยา|สามี|ลูก|พ่อ|แม่|พี่|น้อง|เพื่อน|หุ้นส่วน|ลูกน้อง|หัวหน้า)/);
  const relation = relationMatch ? relationMatch[1] : null;
  const normalizedMemory = mentionedNames.length
    ? [
        `ผู้พูดชื่อ LINE: ${displayName || "ไม่ทราบชื่อ"} (LINE userId: ${userId || "unknown"})`,
        `ข้อความ: ${text}`,
        `บุคคลที่ถูก @mention: ${mentionedNames.join(", ")}`,
        relation && mentionedNames.length === 1
          ? `ข้อเท็จจริงความสัมพันธ์: ${mentionedNames[0]} เป็น${relation}ของ${displayName || "ผู้พูด"}`
          : "",
      ].filter(Boolean).join("\n")
    : `ผู้พูดชื่อ LINE: ${displayName || "ไม่ทราบชื่อ"}\nข้อความ: ${text}`;
  await supabaseRequest("line_memories", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([{
      line_message_id: lineMessageId,
      line_user_id: userId,
      user_id: userId,
      display_name: displayName,
      source_type: sourceType,
      group_id: source.groupId || null,
      room_id: source.roomId || null,
      message_type: "text",
      text_content: text,
      memory_text: normalizedMemory,
      scope_id: scopeId,
      metadata: { source: "line", saved_by: "art-ttm-memory-v2" }
    }])
  });
}

async function askOpenAI(userText, recentContext, memberContext, longTermMemory, currentDisplayName, mentionedMembers = []) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const mentionContext = mentionedMembers.length
    ? mentionedMembers.map((m) => `@mention นี้คือสมาชิก LINE ชื่อ ${m.displayName} userId=${m.userId}`).join("\n")
    : "ไม่มี @mention ในข้อความล่าสุด";

  const input = [
    `ผู้ส่งข้อความล่าสุดคือสมาชิก LINE ชื่อ: ${currentDisplayName || "ไม่ทราบชื่อ"}`,
    `ข้อมูล @mention ของข้อความล่าสุด:\n${mentionContext}`,
    memberContext ? `สมาชิกที่ระบบรู้จักในห้องนี้:\n${memberContext}` : "",
    longTermMemory ? `ความจำระยะยาวของห้องนี้:\n${longTermMemory}` : "",
    recentContext ? `บทสนทนาล่าสุดในห้องนี้:\n${recentContext}` : "",
    `ข้อความล่าสุด:\n${userText}`,
  ].filter(Boolean).join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLEAN_OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "คุณคือ Art TTM ผู้ช่วย AI ของทีม TTM HOME DESIGN & BUILD-IN ตอบภาษาไทยเป็นหลัก สุภาพ กระชับ ชัดเจน เมื่อผู้ใช้ถามให้คำนวณ ให้คำนวณจากตัวเลขที่มีและแสดงคำตอบจริง เมื่อผู้ใช้ถามข้อมูลทั่วไปที่ไม่อยู่ในความจำ ให้ใช้ความรู้ของโมเดลตอบได้โดยแยกให้ชัดว่าไม่ใช่ข้อมูลจากไฟล์ ห้ามอ้างว่าอ่านไฟล์สำเร็จถ้าไม่มีเนื้อหาไฟล์ในบริบท ให้เรียกสมาชิก LINE ทุกคนโดยเติมคำว่า 'พี่' นำหน้าชื่อเสมอ (ถ้าชื่อมีคำว่าพี่อยู่แล้วไม่ต้องเติมซ้ำ) ผู้ส่งข้อความล่าสุดจะถูกระบุชื่อ LINE ให้ชัดเจนใน input: ให้ถือชื่อนั้นเป็นตัวตนของคนที่กำลังคุยด้วยเสมอ ใช้ข้อมูลสมาชิก ความจำระยะยาว และบทสนทนาล่าสุดจาก Supabase เป็นข้อเท็จจริงเมื่อเกี่ยวข้อง โดยเฉพาะบรรทัด 'ข้อเท็จจริงความสัมพันธ์' ถ้าความจำระบุว่า 'จูน เป็นแฟนของ Benz' แล้ว Benz ถามว่าแฟนพี่ชื่ออะไร ต้องตอบ 'จูน' ทันที ถ้าจูนถามว่าฉันเป็นอะไรกับ Benz ให้ตอบว่าเป็นแฟนของ Benz ห้ามขอข้อมูลซ้ำเมื่อความจำมีคำตอบแล้ว ชื่อจาก LINE member profile และชื่อ @mention เป็นชื่อจริงในบริบทของกลุ่ม ให้แยกความจำตามผู้พูดและกลุ่ม ห้ามสลับเจ้าของความสัมพันธ์ หากไม่มีข้อมูลจริงจึงค่อยถามกลับ ห้ามแต่งข้อมูลหรือราคาโดยไม่มีฐานอ้างอิง",
      input,
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
      max_output_tokens: 800,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI API error ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI returned an empty response");
  return text.slice(0, 4900);
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (
        content.type === "output_text" &&
        typeof content.text === "string" &&
        content.text.trim()
      ) {
        parts.push(content.text.trim());
      }
    }
  }
  return parts.join("\n").trim();
}

async function replyMessage(replyToken, text) {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLEAN_LINE_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `LINE reply error ${response.status}: ${await response.text()}`
    );
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Art TTM server running on port ${PORT}`);
  console.log("Credential diagnostics:", {
    supabaseUrlOk: /^https:\/\//.test(CLEAN_SUPABASE_URL),
    supabaseUrlHost: (() => { try { return new URL(CLEAN_SUPABASE_URL).host; } catch { return "INVALID"; } })(),
    supabaseKeyAscii: /^[\x20-\x7E]+$/.test(CLEAN_SUPABASE_KEY),
    lineTokenAscii: /^[\x20-\x7E]+$/.test(CLEAN_LINE_TOKEN),
    openaiKeyAscii: /^[\x20-\x7E]+$/.test(CLEAN_OPENAI_KEY)
  });
});
