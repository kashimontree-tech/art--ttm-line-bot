const express = require("express");

const crypto = require("crypto");

const XLSX = require("xlsx");

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const OPENAI_MODEL = "gpt-5.6-luna";

app.get("/", (req, res) => {

  res.status(200).json({

    ok: true,

    service: "Art TTM LINE AI",

    phase: 3,

    supabase: Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY)

  });

});

app.get("/webhook", (req, res) =>

  res.status(200).send("Art TTM webhook is ready")

);

app.post(

  "/webhook",

  express.raw({ type: "*/*", limit: "25mb" }),

  async (req, res) => {

    try {

      const signature = req.get("x-line-signature") || "";

      if (!verifyLineSignature(req.body, signature)) {

        return res.sendStatus(401);

      }

      let body;

      try {

        body = JSON.parse(req.body.toString("utf8"));

      } catch (error) {

        console.error("Invalid webhook JSON:", error);

        return res.sendStatus(400);

      }

      // LINE ควรได้รับ 200 โดยเร็ว

      res.sendStatus(200);

      for (const event of Array.isArray(body.events) ? body.events : []) {

        try {

          await handleLineEvent(event);

        } catch (error) {

          console.error("EVENT ERROR:", error);

        }

      }

    } catch (error) {

      console.error("WEBHOOK ERROR:", error);

      if (!res.headersSent) {

        res.sendStatus(500);

      }

    }

  }

);

// ============================================================

// LINE SECURITY

// ============================================================

function verifyLineSignature(rawBody, signature) {

  if (

    !LINE_CHANNEL_SECRET ||

    !signature ||

    !Buffer.isBuffer(rawBody)

  ) {

    return false;

  }

  const expected = crypto

    .createHmac("sha256", LINE_CHANNEL_SECRET)

    .update(rawBody)

    .digest("base64");

  try {

    const a = Buffer.from(expected);

    const b = Buffer.from(signature);

    return (

      a.length === b.length &&

      crypto.timingSafeEqual(a, b)

    );

  } catch {

    return false;

  }

}

// ============================================================

// EVENT ROUTER

// ============================================================

async function handleLineEvent(event) {

  if (!event) return;

  if (event.type === "join") {

    await rememberGroup(event);

    if (event.replyToken) {

      await replyLINE(

        event.replyToken,

        "สวัสดีครับ ผมอาร์ต TTM 🤖\n" +

        "ผู้ช่วย AI ของพี่เบนซ์และทีม TTM ครับ\n" +

        "เรียกผมว่า “อาร์ต” ได้เลยครับ"

      );

    }

    return;

  }

  if (event.type !== "message" || !event.message) {

    return;

  }

  if (event.message.type === "text") {

    return handleTextMessage(event);

  }

  if (event.message.type === "image") {

    return handleImageMessage(event);

  }

  if (event.message.type === "file") {

    return handleFileMessage(event);

  }

}

// ============================================================

// TEXT

// ============================================================

async function handleTextMessage(event) {

  const text = String(event.message.text || "").trim();

  if (!text || !event.replyToken) return;

  const sourceType = event.source?.type || "unknown";

  // ในกลุ่ม อาร์ตตอบเมื่อถูกเรียก

  if (

    (sourceType === "group" || sourceType === "room") &&

    !/อาร์ต|art\s*ttm|\bart\b/i.test(text)

  ) {

    // ถึงไม่ตอบ ก็จำสมาชิกได้

    const actor = await getLineActor(event);

    await rememberActor(event, actor);

    await rememberMessage(event, actor, text, "text");

    return;

  }

  const actor = await getLineActor(event);

  await rememberActor(event, actor);

  await rememberGroup(event);

  // บันทึกข้อความปัจจุบันก่อน

  await rememberMessage(

    event,

    actor,

    text,

    "text"

  );

  try {

    const memory = await loadRecentMemory(event, actor);

    const answer = await askOpenAIText(

      buildUserContext(

        event,

        actor,

        text,

        memory

      )

    );

    // จำคำตอบของอาร์ตด้วย

    await rememberAssistantAnswer(

      event,

      actor,

      answer,

      "text"

    );

    await replyLINE(

      event.replyToken,

      answer

    );

  } catch (error) {

    console.error("TEXT ERROR:", error);

    await replyLINE(

      event.replyToken,

      "อาร์ตเชื่อมต่อ AI ไม่สำเร็จชั่วคราวครับ " +

      "กรุณาลองอีกครั้งครับ"

    );

  }

}

// ============================================================

// LINE PROFILE

// ============================================================

async function getLineActor(event) {

  const source = event.source || {};

  const userId = source.userId || "";

  const fallback = {

    userId,

    displayName: "สมาชิกใน LINE",

    pictureUrl: ""

  };

  if (!userId || !LINE_CHANNEL_ACCESS_TOKEN) {

    return fallback;

  }

  let url;

  if (source.type === "group" && source.groupId) {

    url =

      `https://api.line.me/v2/bot/group/` +

      `${encodeURIComponent(source.groupId)}` +

      `/member/${encodeURIComponent(userId)}`;

  } else if (source.type === "room" && source.roomId) {

    url =

      `https://api.line.me/v2/bot/room/` +

      `${encodeURIComponent(source.roomId)}` +

      `/member/${encodeURIComponent(userId)}`;

  } else {

    url =

      `https://api.line.me/v2/bot/profile/` +

      `${encodeURIComponent(userId)}`;

  }

  try {

    const response = await fetch(url, {

      headers: {

        Authorization:

          `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`

      }

    });

    if (!response.ok) {

      return fallback;

    }

    const data = await response.json();

    return {

      userId: data.userId || userId,

      displayName:

        data.displayName ||

        fallback.displayName,

      pictureUrl:

        data.pictureUrl || ""

    };

  } catch (error) {

    console.error("LINE PROFILE ERROR:", error);

    return fallback;

  }

}

// ============================================================

// SUPABASE

// ============================================================

function supabaseReady() {

  return Boolean(

    SUPABASE_URL &&

    SUPABASE_SECRET_KEY

  );

}

function supabaseBase() {

  return String(SUPABASE_URL || "")

    .replace(/\/+$/, "");

}

async function supabaseREST(

  path,

  {

    method = "GET",

    body,

    prefer = "return=representation"

  } = {}

) {

  if (!supabaseReady()) {

    console.error("SUPABASE ENV MISSING");

    return null;

  }

  try {

    const response = await fetch(

      `${supabaseBase()}/rest/v1/${path}`,

      {

        method,

        headers: {

          apikey: SUPABASE_SECRET_KEY,

          "Content-Type": "application/json",

          Prefer: prefer

        },

        body:

          body === undefined

            ? undefined

            : JSON.stringify(body)

      }

    );

    const raw = await response.text();

    if (!response.ok) {

      console.error(

        "SUPABASE ERROR:",

        response.status,

        raw

      );

      return null;

    }

    if (!raw) return true;

    try {

      return JSON.parse(raw);

    } catch {

      return raw;

    }

  } catch (error) {

    console.error(

      "SUPABASE FETCH ERROR:",

      error

    );

    return null;

  }

}

// ============================================================

// REMEMBER GROUP

// ============================================================

async function rememberGroup(event) {

  if (!supabaseReady()) return;

  const source = event.source || {};

  const groupId =

    source.groupId ||

    source.roomId ||

    "";

  if (!groupId) return;

  try {

    const encoded =

      encodeURIComponent(groupId);

    const found = await supabaseREST(

      `line_groups?line_group_id=eq.${encoded}` +

      `&select=id,line_group_id&limit=1`

    );

    if (Array.isArray(found) && found.length) {

      await supabaseREST(

        `line_groups?line_group_id=eq.${encoded}`,

        {

          method: "PATCH",

          body: {

            last_seen_at:

              new Date().toISOString(),

            updated_at:

              new Date().toISOString()

          },

          prefer: "return=minimal"

        }

      );

    } else {

      await supabaseREST(

        "line_groups",

        {

          method: "POST",

          body: {

            line_group_id: groupId,

            source_type:

              source.type || "group",

            first_seen_at:

              new Date().toISOString(),

            last_seen_at:

              new Date().toISOString(),

            created_at:

              new Date().toISOString(),

            updated_at:

              new Date().toISOString()

          },

          prefer: "return=minimal"

        }

      );

    }

  } catch (error) {

    console.error(

      "REMEMBER GROUP ERROR:",

      error

    );

  }

}

// ============================================================

// REMEMBER MEMBER

// ============================================================

async function rememberActor(event, actor) {

  if (!supabaseReady()) {

    console.error("REMEMBER ACTOR: Supabase is not ready");

    return false;

  }

  if (!actor?.userId) {

    console.error("REMEMBER ACTOR: LINE userId missing");

    return false;

  }

  try {

    const encodedUserId = encodeURIComponent(actor.userId);

    // ตรวจว่าคนนี้เคยถูกบันทึกหรือยัง

    const found = await supabaseREST(

      `line_members?line_user_id=eq.${encodedUserId}` +

      `&select=id,line_user_id,display_name&limit=1`

    );

    if (found === null) {

      console.error(

        "REMEMBER ACTOR: Cannot read line_members",

        actor.userId

      );

      return false;

    }

    // รอบแรกใช้เฉพาะ column ที่ยืนยันแล้วว่ามีจริง

    const memberData = {

      line_user_id: actor.userId,

      display_name:

        actor.displayName && actor.displayName !== "สมาชิกใน LINE"

          ? actor.displayName

          : null

    };

    let result;

    if (Array.isArray(found) && found.length > 0) {

      // สมาชิกเดิม -> อัปเดตชื่อ

      result = await supabaseREST(

        `line_members?line_user_id=eq.${encodedUserId}`,

        {

          method: "PATCH",

          body: memberData,

          prefer: "return=representation"

        }

      );

    } else {

      // สมาชิกใหม่ -> เพิ่มข้อมูล

      result = await supabaseREST(

        "line_members",

        {

          method: "POST",

          body: memberData,

          prefer: "return=representation"

        }

      );

    }

    if (result === null) {

      console.error(

        "REMEMBER ACTOR: Save failed",

        actor.userId

      );

      return false;

    }

    console.log(

      "REMEMBER ACTOR SUCCESS:",

      actor.userId,

      actor.displayName

    );

    return true;

  } catch (error) {

    console.error(

      "REMEMBER ACTOR ERROR:",

      error

    );

    return false;

  }

}

  async function rememberMessage(event, actor, content, messageType)
  if (!supabaseReady()) return;

  const source = event.source || {};

  try {

    await supabaseREST(

      "line_memories",

      {

        method: "POST",

        body: {

          line_message_id: event.message?.id || null,

          line_user_id: actor?.userId || null,

          display_name:

            actor?.displayName || "สมาชิกใน LINE",

          source_type: source.type || null,

          group_id: source.groupId || null,

          room_id: source.roomId || null,

          message_type:

            messageType ||

            event.message?.type ||

            "text",

          text_content:

            String(content || "").slice(0, 30000),

          file_name:

            event.message?.fileName || null,

          mime_type: null,

          metadata: {

            sender: "user",

            sourceType: source.type || null

          },

          created_at: new Date().toISOString()

        },

        prefer: "return=minimal"

      }

    );

  } catch (error) {

    console.error(

      "REMEMBER MESSAGE ERROR:",

      error

    );

  }

}

    await supabaseREST(

      "line_memories",

      {

        method: "POST",

        body: {

          line_message_id:

            event.message?.id || null,

          line_user_id:

            actor?.userId || null,

          display_name:

            actor?.displayName ||

            "สมาชิกใน LINE",

          source_type:

            source.type || null,

          group_id:

            source.groupId || null,

          room_id:

            source.roomId || null,

          message_type:

            messageType ||

            event.message?.type ||

            "text",

          text_content:

            String(content || "")

              .slice(0, 30000),

          file_name:

            event.message?.fileName ||

            null,

          mime_type:

            null,

          metadata: {

            sender: "user",

            sourceType:

              source.type || null

          },

          created_at:

            new Date().toISOString()

        },

        prefer: "return=minimal"

      }

    );

  } catch (error) {

    console.error(

      "REMEMBER MESSAGE ERROR:",

      error

    );

  }

}

async function rememberAssistantAnswer(

  event,

  actor,

  answer,

  messageType

) {

  if (!supabaseReady()) return;

  const source = event.source || {};

  try {

    await supabaseREST(

      "line_memories",

      {

        method: "POST",

        body: {

          line_message_id: null,

          line_user_id:

            actor?.userId || null,

          display_name: "Art TTM",

          source_type:

            source.type || null,

          group_id:

            source.groupId || null,

          room_id:

            source.roomId || null,

          message_type:

            messageType || "text",

          text_content:

            String(answer || "")

              .slice(0, 30000),

          metadata: {

            sender: "assistant"

          },

          created_at:

            new Date().toISOString()

        },

        prefer: "return=minimal"

      }

    );

  } catch (error) {

    console.error(

      "REMEMBER ANSWER ERROR:",

      error

    );

  }

}

// ============================================================

// LOAD MEMORY

// ============================================================

async function loadRecentMemory(

  event,

  actor

) {

  if (!supabaseReady()) {

    return "";

  }

  const source = event.source || {};

  let filter;

  if (source.groupId) {

    filter =

      `group_id=eq.` +

      encodeURIComponent(source.groupId);

  } else if (source.roomId) {

    filter =

      `room_id=eq.` +

      encodeURIComponent(source.roomId);

  } else if (actor?.userId) {

    filter =

      `line_user_id=eq.` +

      encodeURIComponent(actor.userId);

  } else {

    return "";

  }

  try {

    const rows = await supabaseREST(

      `line_memories?${filter}` +

      `&select=display_name,message_type,text_content,created_at` +

      `&order=created_at.desc&limit=20`

    );

    if (!Array.isArray(rows)) {

      return "";

    }

    return rows

      .reverse()

      .map((row) => {

        const name =

          row.display_name ||

          "สมาชิก";

        const text =

          row.text_content || "";

        return `${name}: ${text}`;

      })

      .join("\n")

      .slice(0, 16000);

  } catch (error) {

    console.error(

      "LOAD MEMORY ERROR:",

      error

    );

    return "";

  }

}

// ============================================================

// BUILD AI CONTEXT

// ============================================================

function buildUserContext(

  event,

  actor,

  text,

  memory

) {

  const source = event.source || {};

  return (

    `ชื่อผู้ส่งใน LINE: ${actor.displayName}\n` +

    `LINE userId: ${actor.userId || "ไม่ทราบ"}\n` +

    `ประเภทแชต: ${source.type || "unknown"}\n` +

    `Group ID: ${source.groupId || ""}\n` +

    `Room ID: ${source.roomId || ""}\n\n` +

    `===== ความจำล่าสุดจากฐานข้อมูล TTM =====\n` +

    `${memory || "ยังไม่มีประวัติก่อนหน้า"}\n` +

    `===== จบความจำ =====\n\n` +

    `ข้อความปัจจุบัน:\n${text}`

  );

}

// ============================================================

// DOWNLOAD LINE CONTENT

// ============================================================

async function downloadLineContent(messageId) {

  if (!LINE_CHANNEL_ACCESS_TOKEN) {

    throw new Error(

      "LINE_CHANNEL_ACCESS_TOKEN missing"

    );

  }

  const response = await fetch(

    `https://api-data.line.me/v2/bot/message/` +

    `${encodeURIComponent(messageId)}/content`,

    {

      headers: {

        Authorization:

          `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`

      }

    }

  );

  if (!response.ok) {

    throw new Error(

      `LINE content error ${response.status}`

    );

  }

  return {

    buffer: Buffer.from(

      await response.arrayBuffer()

    ),

    contentType:

      response.headers.get("content-type") ||

      "application/octet-stream"

  };

}

// ============================================================

// IMAGE

// ============================================================

async function handleImageMessage(event) {

  if (

    !event.replyToken ||

    !event.message?.id

  ) {

    return;

  }

  try {

    const actor =

      await getLineActor(event);

    await rememberActor(event, actor);

    await rememberGroup(event);

    const media =

      await downloadLineContent(

        event.message.id

      );

    const mimeType =

      normalizeImageMime(

        media.contentType

      );

    const dataUrl =

      `data:${mimeType};base64,` +

      media.buffer.toString("base64");

    const memory =

      await loadRecentMemory(

        event,

        actor

      );

    const prompt =

      `ผู้ส่งรูปใน LINE: ${actor.displayName}\n\n` +

      `ความจำล่าสุดของแชต:\n` +

      `${memory || "ไม่มี"}\n\n` +

      "วิเคราะห์รูปนี้อย่างละเอียด " +

      "ถ้าเป็น BOQ ใบเสนอราคา ใบเสร็จ " +

      "รายการวัสดุ หรือเอกสารก่อสร้าง " +

      "ให้ถอดชื่อผู้ขาย วันที่ เลขที่เอกสาร " +

      "รายการ สเปก จำนวน หน่วย ราคาต่อหน่วย " +

      "ส่วนลด VAT ค่าขนส่ง ยอดรวม และหมายเหตุ " +

      "ถ้าเป็นรูปหน้างานให้สรุปสิ่งที่เห็น " +

      "งานที่ดำเนินการ จุดตรวจสอบ " +

      "และปัญหาที่สังเกตได้ " +

      "ห้ามเดาข้อมูลที่อ่านไม่ชัด";

    const answer =

      await askOpenAIImage(

        prompt,

        dataUrl

      );

    // จำผลวิเคราะห์รูปแทนการจำภาพด้วยชื่อคน

    await rememberMessage(

      event,

      actor,

      `[รูปภาพ]\n${answer}`,

      "image"

    );

    await rememberAssistantAnswer(

      event,

      actor,

      answer,

      "image_analysis"

    );

    await replyLINE(

      event.replyToken,

      `ผู้ส่ง: ${actor.displayName}\n\n${answer}`

    );

  } catch (error) {

    console.error(

      "IMAGE ERROR:",

      error

    );

    await replyLINE(

      event.replyToken,

      "อาร์ตได้รับรูปแล้ว " +

      "แต่การวิเคราะห์รูปไม่สำเร็จครับ " +

      "กรุณาลองส่งใหม่ครับ"

    );

  }

}

// ============================================================

// FILE

// ============================================================

async function handleFileMessage(event) {

  if (

    !event.replyToken ||

    !event.message?.id

  ) {

    return;

  }

  const fileName = String(

    event.message.fileName ||

    "unknown-file"

  );

  try {

    const actor =

      await getLineActor(event);

    await rememberActor(event, actor);

    await rememberGroup(event);

    const media =

      await downloadLineContent(

        event.message.id

      );

    const lowerName =

      fileName.toLowerCase();

    let answer;

    if (

      lowerName.endsWith(".xlsx") ||

      lowerName.endsWith(".xls")

    ) {

      answer =

        await analyzeExcel(

          media.buffer,

          fileName,

          actor.displayName

        );

    } else if (

      lowerName.endsWith(".pdf")

    ) {

      answer =

        await analyzePDF(

          media.buffer,

          fileName,

          actor.displayName

        );

    } else {

      answer =

        `อาร์ตได้รับไฟล์ ${fileName} แล้วครับ\n` +

        "ตอนนี้ระบบวิเคราะห์ PDF, XLSX และ XLS โดยตรงครับ";

    }

    await rememberDocument(

      event,

      actor,

      fileName,

      media,

      answer

    );

    await rememberMessage(

      event,

      actor,

      `[ไฟล์: ${fileName}]\n${answer}`,

      "file"

    );

    await rememberAssistantAnswer(

      event,

      actor,

      answer,

      "file_analysis"

    );

    await replyLINE(

      event.replyToken,

      `ผู้ส่ง: ${actor.displayName}\n\n${answer}`

    );

  } catch (error) {

    console.error(

      "FILE ERROR:",

      error

    );

    await replyLINE(

      event.replyToken,

      `อาร์ตได้รับไฟล์แล้ว ` +

      `แต่การอ่าน ${fileName} ` +

      `ไม่สำเร็จครับ กรุณาลองส่งใหม่ครับ`

    );

  }

}

// ============================================================

// DOCUMENT DATABASE

// ============================================================

async function rememberDocument(

  event,

  actor,

  fileName,

  media,

  analysis

) {

  if (!supabaseReady()) return;

  const source = event.source || {};

  let documentType = "other";

  const lower =

    fileName.toLowerCase();

  if (lower.endsWith(".pdf")) {

    documentType = "pdf";

  } else if (

    lower.endsWith(".xlsx") ||

    lower.endsWith(".xls")

  ) {

    documentType = "excel";

  }

  try {

    await supabaseREST(

      "documents",

      {

        method: "POST",

        body: {

          line_message_id:

            event.message?.id || null,

          line_user_id:

            actor?.userId || null,

          display_name:

            actor?.displayName || null,

          group_id:

            source.groupId ||

            source.roomId ||

            null,

          document_type:

            documentType,

          file_name:

            fileName,

          mime_type:

            media.contentType ||

            "application/octet-stream",

          file_size:

            event.message?.fileSize ||

            media.buffer?.length ||

            null,

          extracted_text:

            String(analysis || "")

              .slice(0, 50000),

          extracted_data: {

            analyzedBy: "Art TTM",

            messageType:

              event.message?.type,

            sourceType:

              source.type

          },

          created_at:

            new Date().toISOString(),

          updated_at:

            new Date().toISOString()

        },

        prefer: "return=minimal"

      }

    );

  } catch (error) {

    console.error(

      "REMEMBER DOCUMENT ERROR:",

      error

    );

  }

}

// ============================================================

// EXCEL ANALYSIS

// ============================================================

async function analyzeExcel(

  buffer,

  fileName,

  displayName

) {

  const workbook =

    XLSX.read(buffer, {

      type: "buffer",

      cellDates: true

    });

  const sections = [];

  for (

    const sheetName

    of workbook.SheetNames.slice(0, 12)

  ) {

    const sheet =

      workbook.Sheets[sheetName];

    if (!sheet) continue;

    const csv =

      XLSX.utils.sheet_to_csv(

        sheet,

        {

          blankrows: false

        }

      );

    sections.push(

      `===== SHEET: ${sheetName} =====\n` +

      csv.slice(0, 25000)

    );

  }

  const workbookText =

    sections.join("\n\n");

  if (!workbookText.trim()) {

    return (

      "อาร์ตเปิดไฟล์ Excel ได้ " +

      "แต่ไม่พบข้อมูลในชีตครับ"

    );

  }

  return askOpenAIText(

    `ผู้ส่งไฟล์: ${displayName}\n` +

    `ชื่อไฟล์: ${fileName}\n\n` +

    `ข้อมูลจาก Excel:\n` +

    `${workbookText}\n\n` +

    "วิเคราะห์ข้อมูลทั้งหมด " +

    "ถ้าเป็น BOQ ให้สรุปหมวดงาน รายการ " +

    "จำนวน หน่วย ราคาต่อหน่วย ยอดรวม " +

    "และจุดที่ควรตรวจสอบ " +

    "ถ้าเป็นใบเสนอราคาซัพพลายเออร์ " +

    "ให้แยกบริษัท วันที่ รายการ สเปก " +

    "จำนวน หน่วย ราคาต่อหน่วย ส่วนลด " +

    "VAT ค่าขนส่ง และยอดสุทธิ " +

    "ห้ามสร้างตัวเลขที่ไม่มีในไฟล์"

  );

}

// ============================================================

// PDF ANALYSIS

// ============================================================

async function analyzePDF(

  buffer,

  fileName,

  displayName

) {

  if (!OPENAI_API_KEY) {

    throw new Error(

      "OPENAI_API_KEY missing"

    );

  }

  if (

    buffer.length >

    45 * 1024 * 1024

  ) {

    return (

      "ไฟล์ PDF มีขนาดใหญ่เกินไป " +

      "สำหรับการวิเคราะห์ในครั้งเดียวครับ"

    );

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers: openAIHeaders(),

      body: JSON.stringify({

        model: OPENAI_MODEL,

        instructions:

          buildInstructions(),

        input: [

          {

            role: "user",

            content: [

              {

                type: "input_file",

                filename:

                  fileName,

                file_data:

                  `data:application/pdf;base64,` +

                  buffer.toString("base64")

              },

              {

                type: "input_text",

                text:

                  `ผู้ส่งไฟล์: ${displayName}\n` +

                  `ชื่อไฟล์: ${fileName}\n` +

                  "อ่าน PDF นี้อย่างละเอียด " +

                  "ถ้าเป็น BOQ ใบเสนอราคา " +

                  "หรือเอกสารก่อสร้าง " +

                  "ให้สรุปหมวดงาน รายการ " +

                  "จำนวน หน่วย ราคาต่อหน่วย " +

                  "ยอดรวม VAT ส่วนลด " +

                  "ค่าขนส่ง และหมายเหตุ " +

                  "ห้ามเดาข้อมูลที่ไม่มีในเอกสาร"

              }

            ]

          }

        ],

        max_output_tokens: 1800

      })

    }

  );

  return parseOpenAIResponse(

    response,

    "PDF"

  );

}

// ============================================================

// OPENAI TEXT

// ============================================================

async function askOpenAIText(text) {

  if (!OPENAI_API_KEY) {

    throw new Error(

      "OPENAI_API_KEY missing"

    );

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers:

        openAIHeaders(),

      body: JSON.stringify({

        model: OPENAI_MODEL,

        instructions:

          buildInstructions(),

        input: text,

        max_output_tokens: 1600

      })

    }

  );

  return parseOpenAIResponse(

    response,

    "TEXT"

  );

}

// ============================================================

// OPENAI IMAGE

// ============================================================

async function askOpenAIImage(

  prompt,

  imageDataUrl

) {

  if (!OPENAI_API_KEY) {

    throw new Error(

      "OPENAI_API_KEY missing"

    );

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers:

        openAIHeaders(),

      body: JSON.stringify({

        model: OPENAI_MODEL,

        instructions:

          buildInstructions(),

        input: [

          {

            role: "user",

            content: [

              {

                type: "input_text",

                text: prompt

              },

              {

                type: "input_image",

                image_url:

                  imageDataUrl,

                detail: "high"

              }

            ]

          }

        ],

        max_output_tokens: 1800

      })

    }

  );

  return parseOpenAIResponse(

    response,

    "IMAGE"

  );

}

// ============================================================

// OPENAI HELPERS

// ============================================================

function openAIHeaders() {

  return {

    "Content-Type":

      "application/json",

    Authorization:

      `Bearer ${OPENAI_API_KEY}`

  };

}

async function parseOpenAIResponse(

  response,

  label

) {

  const data =

    await response

      .json()

      .catch(() => null);

  if (!response.ok) {

    console.error(

      `OPENAI ${label} ERROR:`,

      response.status,

      data

    );

    throw new Error(

      `${label}: OpenAI API error ` +

      `${response.status}`

    );

  }

  const text =

    extractOpenAIText(data);

  if (!text) {

    throw new Error(

      `${label}: OpenAI returned no text`

    );

  }

  return text;

}

function extractOpenAIText(data) {

  if (

    typeof data?.output_text ===

      "string" &&

    data.output_text.trim()

  ) {

    return data.output_text.trim();

  }

  const parts = [];

  for (

    const item of

    Array.isArray(data?.output)

      ? data.output

      : []

  ) {

    for (

      const content of

      Array.isArray(item?.content)

        ? item.content

        : []

    ) {

      if (

        typeof content?.text ===

          "string" &&

        content.text.trim()

      ) {

        parts.push(

          content.text.trim()

        );

      }

    }

  }

  return parts

    .join("\n")

    .trim();

}

// ============================================================

// ART TTM SYSTEM INSTRUCTIONS

// ============================================================

function buildInstructions() {

  return (

    "คุณชื่อ Art TTM หรือ อาร์ต " +

    "เป็นผู้ช่วย AI ของพี่เบนซ์และ " +

    "TTM HOME DESIGN & BUILD-IN CO., LTD. " +

    "ตอบภาษาไทยเป็นหลัก " +

    "สุภาพ เป็นกันเองกับทีม TTM " +

    "ช่วยงานก่อสร้าง ตกแต่งภายใน " +

    "บิวท์อิน BOQ ถอดปริมาณ ต้นทุน " +

    "กำไร Supplier วิเคราะห์รูปหน้างาน " +

    "ใบเสนอราคา PDF และ Excel " +

    "ระบบอาจส่งความจำจากฐานข้อมูล TTM " +

    "มากับข้อความ ให้ใช้ข้อมูลนั้นเพื่อจำ " +

    "ชื่อสมาชิก งานเดิม เอกสารเดิม " +

    "และบริบทการทำงานต่อเนื่อง " +

    "สำหรับราคาวัสดุหรือซัพพลายเออร์ " +

    "ต้องแยกชื่อบริษัท รายการ สเปก หน่วย " +

    "ราคา วันที่ และแหล่งที่มาให้ชัดเจน " +

    "ถ้ามีหลายราคาและผู้ใช้ขอเปรียบเทียบ " +

    "ให้เปรียบเทียบสเปกเดียวกันก่อน " +

    "ใช้ชื่อผู้ส่งจาก LINE Display Name " +

    "ห้ามเดาชื่อบุคคลจากใบหน้าในภาพ " +

    "ห้ามเดาตัวเลข " +

    "ถ้าอ่านไม่ชัดให้บอกว่าอ่านไม่ชัด " +

    "ตรวจหน่วย สูตร และตัวเลข " +

    "อย่างระมัดระวัง"

  );

}

// ============================================================

// IMAGE MIME

// ============================================================

function normalizeImageMime(

  contentType

) {

  const type =

    String(contentType || "")

      .split(";")[0]

      .trim()

      .toLowerCase();

  return [

    "image/jpeg",

    "image/png",

    "image/webp",

    "image/gif"

  ].includes(type)

    ? type

    : "image/jpeg";

}

// ============================================================

// LINE REPLY

// ============================================================

async function replyLINE(

  replyToken,

  text

) {

  if (!LINE_CHANNEL_ACCESS_TOKEN) {

    throw new Error(

      "LINE_CHANNEL_ACCESS_TOKEN missing"

    );

  }

  const safeText =

    String(text || "")

      .trim()

      .slice(0, 4900);

  if (!safeText) return;

  const response = await fetch(

    "https://api.line.me/v2/bot/message/reply",

    {

      method: "POST",

      headers: {

        "Content-Type":

          "application/json",

        Authorization:

          `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`

      },

      body: JSON.stringify({

        replyToken,

        messages: [

          {

            type: "text",

            text: safeText

          }

        ]

      })

    }

  );

  if (!response.ok) {

    const detail =

      await response

        .text()

        .catch(() => "");

    console.error(

      "LINE REPLY ERROR:",

      response.status,

      detail

    );

    throw new Error(

      `LINE reply error ${response.status}`

    );

  }

}

// ============================================================

// START SERVER

// ============================================================

const PORT =

  process.env.PORT || 3000;

app.listen(

  PORT,

  "0.0.0.0",

  () => {

    console.log(

      `Art TTM server running on port ${PORT}`

    );

    console.log(

      "Phase 3: LINE + OpenAI + Supabase Memory + Image + PDF + Excel"

    );

    console.log(

      "Supabase:",

      supabaseReady()

        ? "READY"

        : "NOT CONFIGURED"

    );

    console.log(

      "Webhook: /webhook"

    );

  }

);
