const express = require("express");
const crypto = require("crypto");

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

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
      if (
        event.type === "message" &&
        event.message?.type === "text" &&
        event.replyToken
      ) {
        await processTextEvent(event);
      }
    }
  } catch (error) {
    console.error("Webhook error:", error);
    if (!res.headersSent) res.sendStatus(500);
  }
});

async function processTextEvent(event) {
  const userText = event.message.text.trim();
  const scopeId = getScopeId(event.source);
  const userId = event.source?.userId || null;

  let profile = null;
  try {
    profile = await getLineProfile(event.source);
    await upsertMember(scopeId, userId, profile);
  } catch (error) {
    console.error("Profile/memory member error:", error);
  }

  const displayName = profile?.displayName || null;
  let answer;

  try {
    await saveMessage(scopeId, userId, displayName, "user", userText);

    const memoryText = extractExplicitMemory(userText);
    if (memoryText) {
      await saveMemory(scopeId, userId, displayName, memoryText);
      answer = `บันทึกไว้แล้วครับ${displayName ? ` คุณ${displayName}` : ""} 🧠\n“${memoryText}”`;
    } else {
      const [recentMessages, memories, members] = await Promise.all([
        getRecentMessages(scopeId, 12),
        getMemories(scopeId, 20),
        getMembers(scopeId),
      ]);

      answer = await askOpenAI({
        userText,
        displayName,
        recentMessages,
        memories,
        members,
      });
    }

    await saveMessage(scopeId, null, "Art TTM", "assistant", answer);
  } catch (error) {
    console.error("AI/memory processing error:", error);
    answer =
      "ขออภัยครับ ระบบ Art TTM มีปัญหาชั่วคราว กรุณาลองส่งข้อความอีกครั้งครับ";
  }

  try {
    await replyMessage(event.replyToken, answer);
  } catch (error) {
    console.error("LINE reply error:", error);
  }
}

function getScopeId(source = {}) {
  if (source.type === "group" && source.groupId) return `group:${source.groupId}`;
  if (source.type === "room" && source.roomId) return `room:${source.roomId}`;
  return `user:${source.userId || "unknown"}`;
}

async function getLineProfile(source = {}) {
  if (!source.userId) return null;

  let path;
  if (source.type === "group" && source.groupId) {
    path = `/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(source.userId)}`;
  } else if (source.type === "room" && source.roomId) {
    path = `/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(source.userId)}`;
  } else {
    path = `/v2/bot/profile/${encodeURIComponent(source.userId)}`;
  }

  const response = await fetch(`https://api.line.me${path}`, {
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
  });

  if (!response.ok) {
    throw new Error(`LINE profile error ${response.status}`);
  }

  return response.json();
}

function extractExplicitMemory(text) {
  const match = text.match(/^(?:อาร์ต[\s,:-]*)?(?:จำไว้ว่า|จำว่า|บันทึกว่า|บันทึกข้อมูลว่า|บันทึกไว้ว่า)\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseRequest(path, options = {}) {
  if (!supabaseEnabled()) return null;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase error ${response.status}: ${await response.text()}`);
  }

  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function upsertMember(scopeId, userId, profile) {
  if (!supabaseEnabled() || !userId) return;
  await supabaseRequest("line_members?on_conflict=scope_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      scope_id: scopeId,
      user_id: userId,
      display_name: profile?.displayName || null,
      picture_url: profile?.pictureUrl || null,
      last_seen_at: new Date().toISOString(),
    }),
  });
}

async function saveMessage(scopeId, userId, displayName, role, content) {
  if (!supabaseEnabled()) return;
  await supabaseRequest("line_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      scope_id: scopeId,
      user_id: userId,
      display_name: displayName,
      role,
      content,
    }),
  });
}

async function saveMemory(scopeId, userId, displayName, memoryText) {
  if (!supabaseEnabled()) {
    throw new Error("Supabase memory is not configured");
  }

  await supabaseRequest("line_memories", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      scope_id: scopeId,
      user_id: userId,
      display_name: displayName,
      memory_text: memoryText,
    }),
  });
}

async function getRecentMessages(scopeId, limit = 12) {
  if (!supabaseEnabled()) return [];
  const q = new URLSearchParams({
    select: "role,display_name,content,created_at",
    scope_id: `eq.${scopeId}`,
    order: "created_at.desc",
    limit: String(limit),
  });
  const rows = (await supabaseRequest(`line_messages?${q}`)) || [];
  return rows.reverse();
}

async function getMemories(scopeId, limit = 20) {
  if (!supabaseEnabled()) return [];
  const q = new URLSearchParams({
    select: "display_name,memory_text,created_at",
    scope_id: `eq.${scopeId}`,
    order: "created_at.desc",
    limit: String(limit),
  });
  return (await supabaseRequest(`line_memories?${q}`)) || [];
}

async function getMembers(scopeId) {
  if (!supabaseEnabled()) return [];
  const q = new URLSearchParams({
    select: "display_name,user_id,last_seen_at",
    scope_id: `eq.${scopeId}`,
    order: "last_seen_at.desc",
    limit: "50",
  });
  return (await supabaseRequest(`line_members?${q}`)) || [];
}

async function askOpenAI({ userText, displayName, recentMessages, memories, members }) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const memberNames = members
    .map((m) => m.display_name)
    .filter(Boolean)
    .join(", ");

  const memoryContext = memories
    .map((m) => `- ${m.display_name || "สมาชิก"}: ${m.memory_text}`)
    .join("\n");

  const historyContext = recentMessages
    .map((m) => `${m.display_name || m.role}: ${m.content}`)
    .join("\n");

  const input = [
    displayName ? `ผู้ส่งข้อความปัจจุบัน: ${displayName}` : "",
    memberNames ? `สมาชิกที่ระบบเคยพบในกลุ่มนี้: ${memberNames}` : "",
    memoryContext ? `ข้อมูลที่กลุ่มสั่งให้จำ:\n${memoryContext}` : "",
    historyContext ? `บทสนทนาล่าสุด:\n${historyContext}` : "",
    `ข้อความล่าสุด: ${userText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "คุณคือ Art TTM ผู้ช่วย AI ของทีม TTM HOME DESIGN & BUILD-IN ตอบภาษาไทยเป็นหลัก สุภาพ กระชับ ชัดเจน ใช้ชื่อสมาชิกและข้อมูลความจำที่ให้มาเมื่อเกี่ยวข้องเท่านั้น ช่วยงานก่อสร้าง ออกแบบ BOQ ต้นทุน งานระบบ และงานทั่วไปของทีม หากข้อมูลไม่พอให้ถามกลับ ห้ามแต่งข้อมูล ราคา หรือความทรงจำขึ้นเอง",
      input,
      max_output_tokens: 800,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
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
    throw new Error(`LINE reply error ${response.status}: ${await response.text()}`);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `Art TTM server running on port ${PORT}; Supabase memory: ${supabaseEnabled() ? "enabled" : "disabled"}`
  );
});
