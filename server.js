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

    const signature = req.headers["x-line-signature"];
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
        if (event.message?.type === "text") {
          await processTextEvent(event);
        } else {
          await processNonTextEvent(event);
        }
      }
    }
  } catch (error) {
    console.error("Webhook error:", error);
    if (!res.headersSent) res.sendStatus(500);
  }
});

async function processTextEvent(event) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const sourceType = source.type || "unknown";
  const userText = event.message.text;
  const displayName = await getLineDisplayName(source, userId);
  let mentionedMembers = [];

  try {
    if (source.type === "group" && source.groupId) {
      await syncGroupMembers(source, scopeId);
    }
    mentionedMembers = await captureMentionedMembers(event, scopeId);
    await upsertMember({
      scopeId, userId, displayName, sourceType,
      groupId: source.groupId || null,
      roomId: source.roomId || null,
    });
    await saveMessage({
      lineMessageId: event.message.id || null,
      scopeId, userId, displayName,
      groupId: source.groupId || null,
      messageType: "text", text: userText, role: "user",
    });
    await saveLongTermMemory({
      scopeId, userId, displayName, sourceType, source,
      text: userText, lineMessageId: event.message.id || null,
      mentionedMembers,
    });
    await learnRelationshipFromText({
      scopeId, userId, displayName, sourceType, source,
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
    answer = await askOpenAI(userText, recentContext, memberContext, longTermMemory);
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

async function processNonTextEvent(event) {
  const source = event.source || {};
  const userId = source.userId || null;
  const scopeId = getScopeId(source);
  const displayName = await getLineDisplayName(source, userId);
  const type = event.message?.type || "unknown";
  const fileName = event.message?.fileName || null;

  try {
    if (source.type === "group" && source.groupId) await syncGroupMembers(source, scopeId);
    await upsertMember({
      scopeId, userId, displayName, sourceType: source.type || "unknown",
      groupId: source.groupId || null, roomId: source.roomId || null,
    });
    await saveMessage({
      lineMessageId: event.message?.id || null, scopeId, userId, displayName,
      groupId: source.groupId || null, messageType: type,
      text: fileName ? `[ไฟล์: ${fileName}]` : `[${type}]`, role: "user",
    });
  } catch (error) {
    console.error("Non-text persistence error:", error);
  }

  const reply = type === "file"
    ? `รับไฟล์ ${fileName || ""} แล้วครับ ผมบันทึกว่าไฟล์นี้ถูกส่งในห้องนี้แล้วครับ`
    : "รับข้อมูลแล้วครับ และบันทึกไว้ในประวัติห้องนี้แล้วครับ";
  try { await replyMessage(event.replyToken, reply); } catch (error) { console.error("LINE reply error:", error); }
}

async function syncGroupMembers(source, scopeId) {
  if (!source.groupId) return;
  let start = null;
  let count = 0;
  do {
    const suffix = start ? `?start=${encodeURIComponent(start)}` : "";
    const response = await fetch(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/members/ids${suffix}`,
      { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } }
    );
    if (!response.ok) {
      console.error("LINE group member IDs error:", response.status, await response.text());
      return;
    }
    const data = await response.json();
    for (const memberId of data.memberIds || []) {
      const name = await getLineDisplayName(source, memberId);
      if (name) {
        await upsertMember({
          scopeId, userId: memberId, displayName: name, sourceType: "group",
          groupId: source.groupId, roomId: null,
        });
      }
      count += 1;
      if (count >= 100) return;
    }
    start = data.next || null;
  } while (start);
}

async function learnRelationshipFromText({ scopeId, userId, displayName, sourceType, source, text, lineMessageId, mentionedMembers = [] }) {
  const relationshipWords = /(แฟน|สามี|ภรรยา|พ่อ|แม่|ลูก|พี่|น้อง|เพื่อน|หัวหน้า|ลูกน้อง|หุ้นส่วน|เจ้าของ|ผู้จัดการ|ช่าง|วิศวกร)/i;
  if (!relationshipWords.test(text || "")) return;

  const names = mentionedMembers.map((m) => m.displayName).filter(Boolean);
  const normalized = [
    `ผู้พูดข้อความนี้มีชื่อ LINE ว่า "${displayName || "ไม่ทราบชื่อ"}"`,
    names.length ? `บุคคลที่ถูก @mention มีชื่อ LINE ว่า "${names.join(", ")}"` : "",
    `ข้อความเกี่ยวกับความสัมพันธ์: ${text}`,
  ].filter(Boolean).join("\n");

  await supabaseRequest("line_memories", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([{
      line_message_id: lineMessageId, line_user_id: userId, user_id: userId,
      display_name: displayName, source_type: sourceType,
      group_id: source.groupId || null, room_id: source.roomId || null,
      message_type: "relationship", text_content: text, memory_text: normalized,
      scope_id: scopeId,
      metadata: { source: "line", kind: "relationship", saved_by: "art-ttm-memory-v3" }
    }])
  });
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
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
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
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

function looksLikeMemory(text) {
  return /(จำไว้|จำว่า|ชื่อ.*คือ|เรียกว่า|เป็นแฟน|เป็นภรรยา|เป็นสามี|เป็นลูก|เป็นพี่|เป็นน้อง|ตำแหน่ง|โปรเจกต์.*ชื่อ|โครงการ.*ชื่อ)/i.test(text || "");
}

async function saveLongTermMemory({ scopeId, userId, displayName, sourceType, source, text, lineMessageId, mentionedMembers = [] }) {
  if (!looksLikeMemory(text)) return;
  const mentionedNames = mentionedMembers.map((m) => m.displayName).filter(Boolean);
  const normalizedMemory = mentionedNames.length
    ? `${text}\nบุคคลที่ถูก @mention ในข้อความนี้มีชื่อ LINE จริง: ${mentionedNames.join(", ")}`
    : text;
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

async function askOpenAI(userText, recentContext, memberContext, longTermMemory) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const input = [
    memberContext ? `สมาชิกที่ระบบรู้จักในห้องนี้:\n${memberContext}` : "",
    longTermMemory ? `ความจำระยะยาวของห้องนี้:\n${longTermMemory}` : "",
    recentContext ? `บทสนทนาล่าสุดในห้องนี้:\n${recentContext}` : "",
    `ข้อความล่าสุด:\n${userText}`,
  ].filter(Boolean).join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "คุณคือ Art TTM ผู้ช่วย AI ของทีม TTM HOME DESIGN & BUILD-IN ตอบภาษาไทยเป็นหลัก สุภาพ กระชับ ชัดเจน ช่วยงานก่อสร้าง ออกแบบ BOQ ต้นทุน งานระบบ และงานทั่วไปของทีม สมาชิกแต่ละคนใน LINE group มีตัวตนตาม display_name ที่ระบบส่งมา ให้รู้ว่าข้อความที่มีชื่อผู้พูดในบทสนทนาคือข้อความของคนนั้นจริง ใช้ข้อมูลสมาชิก ความจำระยะยาว และบทสนทนาล่าสุดร่วมกัน หากความจำระบุความสัมพันธ์ เช่น จูนเป็นแฟนเบนซ์ ให้ตอบความสัมพันธ์นั้นได้ไม่ว่าใครในกลุ่มเป็นคนถาม ถ้าคนที่กำลังพูดมีชื่อ LINE ว่าจูน ให้เข้าใจว่าเขาคือจูน ไม่ต้องถามว่าจูนหมายถึงใคร ชื่อจาก LINE member profile และ @mention มีความน่าเชื่อถือสูงกว่าการเดาชื่อจากข้อความ ห้ามปฏิเสธว่าระบุตัวบุคคลไม่ได้เมื่อระบบมี display_name/user mapping อยู่แล้ว หากข้อมูลจริงไม่มีจึงค่อยบอกว่าไม่ทราบ และห้ามแต่งข้อมูลหรือราคาโดยไม่มีฐานอ้างอิง",
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
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
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
});
