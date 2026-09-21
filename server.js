const express = require("express");

const crypto = require("crypto");

const XLSX = require("xlsx");

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OPENAI_MODEL = "gpt-5.6-luna";

app.get("/", (req, res) => res.status(200).send("Art TTM LINE Bot is running"));

app.get("/webhook", (req, res) => res.status(200).send("Art TTM webhook is ready"));

app.post("/webhook", express.raw({ type: "*/*", limit: "25mb" }), async (req, res) => {

  try {

    const signature = req.get("x-line-signature") || "";

    if (!verifyLineSignature(req.body, signature)) return res.sendStatus(401);

    let body;

    try {

      body = JSON.parse(req.body.toString("utf8"));

    } catch (error) {

      console.error("Invalid webhook JSON:", error);

      return res.sendStatus(400);

    }

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

    if (!res.headersSent) res.sendStatus(500);

  }

});

function verifyLineSignature(rawBody, signature) {

  if (!LINE_CHANNEL_SECRET || !signature || !Buffer.isBuffer(rawBody)) return false;

  const expected = crypto

    .createHmac("sha256", LINE_CHANNEL_SECRET)

    .update(rawBody)

    .digest("base64");

  try {

    const a = Buffer.from(expected);

    const b = Buffer.from(signature);

    return a.length === b.length && crypto.timingSafeEqual(a, b);

  } catch {

    return false;

  }

}

async function handleLineEvent(event) {

  if (!event) return;

  if (event.type === "join") {

    if (event.replyToken) {

      await replyLINE(

        event.replyToken,

        "สวัสดีครับ ผมอาร์ต TTM 🤖\nผู้ช่วย AI ของพี่เบนซ์และทีม TTM ครับ\nเรียกผมว่า “อาร์ต” ได้เลยครับ"

      );

    }

    return;

  }

  if (event.type !== "message" || !event.message) return;

  if (event.message.type === "text") return handleTextMessage(event);

  if (event.message.type === "image") return handleImageMessage(event);

  if (event.message.type === "file") return handleFileMessage(event);

}

async function handleTextMessage(event) {

  const text = String(event.message.text || "").trim();

  if (!text || !event.replyToken) return;

  const sourceType = event.source?.type || "unknown";

  if (

    (sourceType === "group" || sourceType === "room") &&

    !/อาร์ต|art\s*ttm|\bart\b/i.test(text)

  ) {

    return;

  }

  const actor = await getLineActor(event);

  try {

    const answer = await askOpenAIText(

      `ชื่อผู้ส่งใน LINE: ${actor.displayName}\nประเภทแชต: ${sourceType}\n\nข้อความ:\n${text}`

    );

    await replyLINE(event.replyToken, answer);

  } catch (error) {

    console.error("TEXT ERROR:", error);

    await replyLINE(

      event.replyToken,

      "อาร์ตเชื่อมต่อ AI ไม่สำเร็จชั่วคราวครับ กรุณาลองอีกครั้งครับ"

    );

  }

}

async function getLineActor(event) {

  const source = event.source || {};

  const userId = source.userId || "";

  const fallback = {

    userId,

    displayName: "สมาชิกใน LINE"

  };

  if (!userId || !LINE_CHANNEL_ACCESS_TOKEN) return fallback;

  let url;

  if (source.type === "group" && source.groupId) {

    url =

      `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}` +

      `/member/${encodeURIComponent(userId)}`;

  } else if (source.type === "room" && source.roomId) {

    url =

      `https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}` +

      `/member/${encodeURIComponent(userId)}`;

  } else {

    url =

      `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`;

  }

  try {

    const response = await fetch(url, {

      headers: {

        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`

      }

    });

    if (!response.ok) return fallback;

    const data = await response.json();

    return {

      userId: data.userId || userId,

      displayName: data.displayName || fallback.displayName,

      pictureUrl: data.pictureUrl || ""

    };

  } catch {

    return fallback;

  }

}

async function downloadLineContent(messageId) {

  if (!LINE_CHANNEL_ACCESS_TOKEN) {

    throw new Error("LINE_CHANNEL_ACCESS_TOKEN missing");

  }

  const response = await fetch(

    `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,

    {

      headers: {

        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`

      }

    }

  );

  if (!response.ok) {

    throw new Error(`LINE content error ${response.status}`);

  }

  return {

    buffer: Buffer.from(await response.arrayBuffer()),

    contentType:

      response.headers.get("content-type") || "application/octet-stream"

  };

}

async function handleImageMessage(event) {

  if (!event.replyToken || !event.message?.id) return;

  try {

    const actor = await getLineActor(event);

    const media = await downloadLineContent(event.message.id);

    const mimeType = normalizeImageMime(media.contentType);

    const dataUrl =

      `data:${mimeType};base64,${media.buffer.toString("base64")}`;

    const prompt =

      `ผู้ส่งรูปใน LINE: ${actor.displayName}\n` +

      "วิเคราะห์รูปนี้อย่างละเอียด ถ้าเป็น BOQ ใบเสนอราคา ใบเสร็จ " +

      "รายการวัสดุ หรือเอกสารก่อสร้าง ให้ถอดชื่อผู้ขาย วันที่ รายการ " +

      "จำนวน หน่วย ราคาต่อหน่วย ยอดรวม VAT และหมายเหตุ " +

      "ถ้าเป็นรูปหน้างานให้สรุปสิ่งที่เห็น งานที่ดำเนินการ " +

      "จุดตรวจสอบ และปัญหาที่สังเกตได้ ห้ามเดาข้อมูลที่อ่านไม่ชัด";

    const answer = await askOpenAIImage(prompt, dataUrl);

    await replyLINE(

      event.replyToken,

      `ผู้ส่ง: ${actor.displayName}\n\n${answer}`

    );

  } catch (error) {

    console.error("IMAGE ERROR:", error);

    await replyLINE(

      event.replyToken,

      "อาร์ตได้รับรูปแล้ว แต่การวิเคราะห์รูปไม่สำเร็จครับ กรุณาลองส่งใหม่ครับ"

    );

  }

}

async function handleFileMessage(event) {

  if (!event.replyToken || !event.message?.id) return;

  const fileName = String(

    event.message.fileName || "unknown-file"

  );

  try {

    const actor = await getLineActor(event);

    const media = await downloadLineContent(event.message.id);

    const lowerName = fileName.toLowerCase();

    let answer;

    if (

      lowerName.endsWith(".xlsx") ||

      lowerName.endsWith(".xls")

    ) {

      answer = await analyzeExcel(

        media.buffer,

        fileName,

        actor.displayName

      );

    } else if (lowerName.endsWith(".pdf")) {

      answer = await analyzePDF(

        media.buffer,

        fileName,

        actor.displayName

      );

    } else {

      answer =

        `อาร์ตได้รับไฟล์ ${fileName} แล้วครับ\n` +

        "Phase 2 ตอนนี้รองรับ PDF, XLSX และ XLS ก่อนครับ";

    }

    await replyLINE(

      event.replyToken,

      `ผู้ส่ง: ${actor.displayName}\n\n${answer}`

    );

  } catch (error) {

    console.error("FILE ERROR:", error);

    await replyLINE(

      event.replyToken,

      `อาร์ตได้รับไฟล์แล้ว แต่การอ่าน ${fileName} ไม่สำเร็จครับ กรุณาลองส่งใหม่ครับ`

    );

  }

}

async function analyzeExcel(buffer, fileName, displayName) {

  const workbook = XLSX.read(buffer, {

    type: "buffer",

    cellDates: true

  });

  const sections = [];

  for (const sheetName of workbook.SheetNames.slice(0, 12)) {

    const sheet = workbook.Sheets[sheetName];

    if (!sheet) continue;

    const csv = XLSX.utils.sheet_to_csv(sheet, {

      blankrows: false

    });

    sections.push(

      `===== SHEET: ${sheetName} =====\n${csv.slice(0, 25000)}`

    );

  }

  const workbookText = sections.join("\n\n");

  if (!workbookText.trim()) {

    return "อาร์ตเปิดไฟล์ Excel ได้ แต่ไม่พบข้อมูลในชีตครับ";

  }

  return askOpenAIText(

    `ผู้ส่งไฟล์: ${displayName}\n` +

    `ชื่อไฟล์: ${fileName}\n\n` +

    `ข้อมูลจาก Excel:\n${workbookText}\n\n` +

    "วิเคราะห์ข้อมูล ถ้าเป็น BOQ ให้สรุปหมวดงาน รายการ จำนวน หน่วย " +

    "ราคาต่อหน่วย ยอดรวม และจุดที่ควรตรวจสอบ " +

    "ห้ามสร้างตัวเลขที่ไม่มีในไฟล์"

  );

}

async function analyzePDF(buffer, fileName, displayName) {

  if (!OPENAI_API_KEY) {

    throw new Error("OPENAI_API_KEY missing");

  }

  if (buffer.length > 45 * 1024 * 1024) {

    return "ไฟล์ PDF มีขนาดใหญ่เกินไปสำหรับการวิเคราะห์ในครั้งเดียวครับ";

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers: openAIHeaders(),

      body: JSON.stringify({

        model: OPENAI_MODEL,

        instructions: buildInstructions(),

        input: [

          {

            role: "user",

            content: [

              {

                type: "input_file",

                filename: fileName,

                file_data:

                  `data:application/pdf;base64,${buffer.toString("base64")}`

              },

              {

                type: "input_text",

                text:

                  `ผู้ส่งไฟล์: ${displayName}\n` +

                  `ชื่อไฟล์: ${fileName}\n` +

                  "อ่าน PDF นี้อย่างละเอียด ถ้าเป็น BOQ ใบเสนอราคา " +

                  "หรือเอกสารก่อสร้าง ให้สรุปหมวดงาน รายการ จำนวน หน่วย " +

                  "ราคาต่อหน่วย ยอดรวม VAT และหมายเหตุ " +

                  "ห้ามเดาข้อมูลที่ไม่มีในเอกสาร"

              }

            ]

          }

        ],

        max_output_tokens: 1800

      })

    }

  );

  return parseOpenAIResponse(response, "PDF");

}

async function askOpenAIText(text) {

  if (!OPENAI_API_KEY) {

    throw new Error("OPENAI_API_KEY missing");

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers: openAIHeaders(),

      body: JSON.stringify({

        model: OPENAI_MODEL,

        instructions: buildInstructions(),

        input: text,

        max_output_tokens: 1400

      })

    }

  );

  return parseOpenAIResponse(response, "TEXT");

}

async function askOpenAIImage(prompt, imageDataUrl) {

  if (!OPENAI_API_KEY) {

    throw new Error("OPENAI_API_KEY missing");

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers: openAIHeaders(),

      body: JSON.stringify({

        model: OPENAI_MODEL,

        instructions: buildInstructions(),

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

                image_url: imageDataUrl,

                detail: "high"

              }

            ]

          }

        ],

        max_output_tokens: 1600

      })

    }

  );

  return parseOpenAIResponse(response, "IMAGE");

}

function openAIHeaders() {

  return {

    "Content-Type": "application/json",

    Authorization: `Bearer ${OPENAI_API_KEY}`

  };

}

async function parseOpenAIResponse(response, label) {

  const data = await response.json().catch(() => null);

  if (!response.ok) {

    console.error(

      `OPENAI ${label} ERROR:`,

      response.status,

      data

    );

    throw new Error(

      `${label}: OpenAI API error ${response.status}`

    );

  }

  const text = extractOpenAIText(data);

  if (!text) {

    throw new Error(

      `${label}: OpenAI returned no text`

    );

  }

  return text;

}

function extractOpenAIText(data) {

  if (

    typeof data?.output_text === "string" &&

    data.output_text.trim()

  ) {

    return data.output_text.trim();

  }

  const parts = [];

  for (const item of Array.isArray(data?.output) ? data.output : []) {

    for (

      const content of

      Array.isArray(item?.content) ? item.content : []

    ) {

      if (

        typeof content?.text === "string" &&

        content.text.trim()

      ) {

        parts.push(content.text.trim());

      }

    }

  }

  return parts.join("\n").trim();

}

function buildInstructions() {

  return (

    "คุณชื่อ Art TTM หรือ อาร์ต เป็นผู้ช่วย AI ของพี่เบนซ์และ " +

    "TTM HOME DESIGN & BUILD-IN CO., LTD. ตอบภาษาไทยเป็นหลัก " +

    "ช่วยงานก่อสร้าง ตกแต่งภายใน บิวท์อิน BOQ ถอดปริมาณ ต้นทุน " +

    "กำไร Supplier วิเคราะห์รูปหน้างาน ใบเสนอราคา PDF และ Excel " +

    "ใช้ชื่อผู้ส่งจาก LINE เป็น Display Name " +

    "ห้ามเดาชื่อบุคคลจากภาพ ห้ามเดาตัวเลข " +

    "ถ้าอ่านไม่ชัดให้บอกว่าอ่านไม่ชัด " +

    "ตรวจหน่วยและตัวเลขอย่างระมัดระวัง " +

    "และตอบสุภาพเป็นกันเองกับทีม TTM"

  );

}

function normalizeImageMime(contentType) {

  const type = String(contentType || "")

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

async function replyLINE(replyToken, text) {

  if (!LINE_CHANNEL_ACCESS_TOKEN) {

    throw new Error("LINE_CHANNEL_ACCESS_TOKEN missing");

  }

  const safeText = String(text || "")

    .trim()

    .slice(0, 4900);

  if (!safeText) return;

  const response = await fetch(

    "https://api.line.me/v2/bot/message/reply",

    {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

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

    throw new Error(

      `LINE reply error ${response.status}`

    );

  }

}

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {

  console.log(`Art TTM server running on port ${PORT}`);

  console.log(

    "Phase 2: Text + Member Name + Image + PDF + Excel"

  );

  console.log("Webhook: /webhook");

});
