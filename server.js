const express = require("express");
const crypto = require("crypto");

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

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
      if (event.type === "message" && event.replyToken) {
        if (event.message?.type === "text") await processTextEvent(event);
        else if (event.message?.type === "image") await processImageEvent(event);
        else if (event.message?.type === "file") await processFileEvent(event);
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

async function processFileEvent(event) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const rawName = await getLineDisplayName(source, userId);
  const displayName = honorificName(rawName) || "พี่";
  const fileName = event.message.fileName || "document";
  try {
    const { bytes, mime } = await downloadLineContent(event.message.id);
    const uploaded = await uploadOpenAIFile(bytes, fileName, mime);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CLEAN_OPENAI_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_FILE_MODEL || "gpt-5.4",
        instructions: "คุณคือ Art TTM อ่านไฟล์เอกสารจาก LINE เช่น PDF, Excel, Word และสรุปข้อมูลจริงจากไฟล์ ห้ามอ้างว่าอ่านหรือบันทึกสำเร็จถ้ายังไม่ได้ทำจริง",
        input: [{ role: "user", content: [
          { type: "input_file", file_id: uploaded.id },
          { type: "input_text", text: `${displayName} ส่งไฟล์ชื่อ ${fileName} มา ให้อ่านไฟล์นี้และจำชื่อไฟล์ไว้ หากเป็น BOQ ให้สรุปว่าเป็นไฟล์อะไรและข้อมูลสำคัญที่อ่านได้` }
        ]}],
        max_output_tokens: 1500
      })
    });
    if (!response.ok) throw new Error(`OpenAI file read error ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const answer = extractOutputText(data) || `รับไฟล์ ${fileName} แล้วครับ`;
    await saveMessage({ lineMessageId: event.message.id || null, scopeId, userId, displayName: rawName, groupId: source.groupId || null, messageType: "file", text: `[ไฟล์: ${fileName}] ${answer}`, role: "user" });
    await saveFileMemory({ scopeId, userId, displayName: rawName, source, fileName, lineMessageId: event.message.id, openaiFileId: uploaded.id, mime, summary: answer });
    await replyMessage(event.replyToken, `${displayName}ครับ อาร์ตอ่านและบันทึกไฟล์ “${fileName}” แล้วครับ\n${answer.slice(0, 3500)}`);
  } catch (e) {
    console.error("File processing error:", e);
    await replyMessage(event.replyToken, `${displayName}ครับ อาร์ตรับไฟล์ “${fileName}” แล้ว แต่ยังอ่านเนื้อหาไม่สำเร็จครับ`);
  }
}

async function saveFileMemory({ scopeId, userId, displayName, source, fileName, lineMessageId, openaiFileId, mime, summary }) {
  await supabaseRequest("line_memories", {
    method: "POST", prefer: "return=minimal",
    body: JSON.stringify([{
      line_message_id: lineMessageId, line_user_id: userId, user_id: userId,
      display_name: displayName, source_type: source.type || "unknown",
      group_id: source.groupId || null, room_id: source.roomId || null,
      message_type: "file", file_name: fileName, mime_type: mime,
      text_content: summary, memory_text: `ไฟล์ที่เคยได้รับ: ${fileName}\nสรุป: ${summary}`,
      scope_id: scopeId,
      metadata: { source: "line", openai_file_id: openaiFileId, line_message_id: lineMessageId, saved_by: "art-ttm-file-v1" }
    }])
  });
}

async function processImageEvent(event) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const rawName = await getLineDisplayName(source, userId);
  const displayName = honorificName(rawName) || "พี่";
  try {
    await upsertMember({ scopeId, userId, displayName: rawName, sourceType: source.type || "unknown", groupId: source.groupId || null, roomId: source.roomId || null });
    const { bytes, mime } = await downloadLineContent(event.message.id);
    if (bytes.length > 15 * 1024 * 1024) throw new Error("Image too large");
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const answer = await askOpenAIImage(dataUrl, displayName);
    await saveMessage({ lineMessageId: event.message.id || null, scopeId, userId, displayName: rawName, groupId: source.groupId || null, messageType: "image", text: "[รูปภาพ] " + answer, role: "user" });
    await replyMessage(event.replyToken, answer);
  } catch (e) {
    console.error("Image processing error:", e);
    await replyMessage(event.replyToken, `${displayName}ครับ ตอนนี้อาร์ตอ่านรูปนี้ไม่สำเร็จ กรุณาลองส่งรูปใหม่อีกครั้งครับ`);
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

async function maybeReturnKnownFile(text, scopeId, displayName) {
  if (!/(ส่ง.*ไฟล์|ไฟล์.*กลับ|ขอ.*ไฟล์|เอา.*ไฟล์)/i.test(text || "")) return null;
  const rows = (await supabaseRequest(
    "line_memories?select=file_name,metadata,created_at" +
    `&scope_id=eq.${encodeURIComponent(scopeId)}&message_type=eq.file&order=created_at.desc&limit=20`,
    { method: "GET" }
  )) || [];
  const wanted = rows.find(r => r.file_name && (text || "").toLowerCase().includes(r.file_name.toLowerCase().replace(/\.[^.]+$/, ""))) || rows[0];
  if (!wanted) return null;
  return `${displayName || "พี่"}ครับ อาร์ตจำได้ว่าเคยได้รับไฟล์ “${wanted.file_name}” และมีข้อมูลไฟล์บันทึกไว้แล้วครับ แต่ LINE ไม่อนุญาตให้ส่งไฟล์ต้นฉบับเก่ากลับจาก message ID หลังหมดอายุโดยตรง ตอนนี้อาร์ตยังไม่มีที่เก็บไฟล์ถาวร จึงยังส่งไฟล์เดิมกลับไม่ได้ครับ`;
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
