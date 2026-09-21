const express = require("express");

const crypto = require("crypto");

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const LINE_CHANNEL_ACCESS_TOKEN =

  process.env.LINE_CHANNEL_ACCESS_TOKEN;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const XLSX = require("xlsx");

const { PDFParse } = require("pdf-parse");


// ==============================

// HEALTH CHECK

// ==============================

app.get("/", (req, res) => {

  res.status(200).send("Art TTM LINE Bot is running");

});

app.get("/webhook", (req, res) => {

  res.status(200).send("Art TTM webhook is ready");

});

// ==============================

// LINE WEBHOOK

// ต้องใช้ raw body เพื่อตรวจ LINE signature

// ==============================

app.post(

  "/webhook",

  express.raw({ type: "*/*" }),

  async (req, res) => {

    try {

      const signature = req.get("x-line-signature") || "";

      if (!verifyLineSignature(req.body, signature)) {

        console.error("Invalid LINE signature");

        return res.sendStatus(401);

      }

      let body;

      try {

        body = JSON.parse(req.body.toString("utf8"));

      } catch (error) {

        console.error("Invalid JSON:", error);

        return res.sendStatus(400);

      }

      // ตอบ LINE ทันที ป้องกัน webhook timeout

      res.sendStatus(200);

      const events = Array.isArray(body.events)

        ? body.events

        : [];

      for (const event of events) {

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

// ==============================

// VERIFY LINE SIGNATURE

// ==============================

function verifyLineSignature(rawBody, signature) {

  if (!LINE_CHANNEL_SECRET || !signature) {

    return false;

  }

  const expectedSignature = crypto

    .createHmac("sha256", LINE_CHANNEL_SECRET)

    .update(rawBody)

    .digest("base64");

  try {

    const expected = Buffer.from(expectedSignature);

    const received = Buffer.from(signature);

    if (expected.length !== received.length) {

      return false;

    }

    return crypto.timingSafeEqual(expected, received);

  } catch (error) {

    console.error("SIGNATURE ERROR:", error);

    return false;

  }

}

// ==============================

// HANDLE LINE EVENT

// ==============================

async function handleLineEvent(event) {

  if (!event) {

    return;

  }

  // ------------------------------

  // Art TTM ถูกเชิญเข้ากลุ่ม

  // ------------------------------

  if (

    event.type === "join" &&

    event.source &&

    (event.source.type === "group" ||

      event.source.type === "room")

  ) {

    const introduction =

      "สวัสดีครับ ผมชื่อ Art TTM 🤖\n\n" +

      "ผมเป็น Bot ช่วยพี่เบนซ์ทุกด้าน และคอยเก็บข้อมูลรายงานพี่เบนซ์ทุกวันนะครับ";

    if (event.replyToken) {

      await replyLINE(event.replyToken, introduction);

    }

    return;

  }
// ==============================

// IMAGE / FILE MESSAGE ROUTER

// ==============================

if (

  event.type === "message" &&

  event.message &&

  (event.message.type === "image" || event.message.type === "file")

) {

  await handleMediaMessage(event);

  return;

}
  

  // ------------------------------

  // รับเฉพาะข้อความ Text

  // ------------------------------

  if (

    event.type !== "message" ||

    !event.message ||

    event.message.type !== "text"

  ) {

    return;

  }

  const userText = String(event.message.text || "").trim();

  if (!userText || !event.replyToken) {

    return;

  }

  const sourceType =

    event.source && event.source.type

      ? event.source.type

      : "unknown";

  // ------------------------------

  // ในกลุ่ม:

  // ตอบเฉพาะข้อความที่เรียก "อาร์ต"

  // เพื่อไม่ให้ Bot ตอบทุกข้อความ

  // ------------------------------

  if (

    sourceType === "group" ||

    sourceType === "room"

  ) {

    const calledArt =

      /อาร์ต|art\s*ttm|\bart\b/i.test(userText);

    if (!calledArt) {

      return;

    }

  }

  // ------------------------------

  // ส่งข้อความให้ OpenAI

  // ------------------------------

  let answer;

  try {

    answer = await askOpenAI(userText);

  } catch (error) {

    console.error("OPENAI ERROR:", error);

    answer =

      "อาร์ตเชื่อมต่อระบบ AI ไม่สำเร็จชั่วคราวครับพี่เบนซ์ กรุณาลองอีกครั้งครับ";

  }

  await replyLINE(event.replyToken, answer);

}

// ==============================

// OPENAI

// ==============================

async function askOpenAI(userText) {

  if (!OPENAI_API_KEY) {

    throw new Error("OPENAI_API_KEY is missing");

  }

  const instructions = `

คุณชื่อ "Art TTM" หรือ "อาร์ต"

คุณเป็นผู้ช่วย AI ของพี่เบนซ์ และบริษัท

TTM HOME DESIGN & BUILD-IN CO., LTD.

ให้ตอบเป็นภาษาไทยเป็นหลัก

เรียกผู้ใช้ว่า "พี่เบนซ์" เมื่อเหมาะสม

หน้าที่ของคุณ ได้แก่:

- ช่วยงานก่อสร้าง

- งานตกแต่งภายใน

- งานบิวท์อิน

- BOQ

- ถอดปริมาณ

- คำนวณต้นทุน

- คำนวณกำไร

- เปรียบเทียบราคาวัสดุ

- ข้อมูล Supplier

- งานโครงการ

- งานเอกสาร

- งานบริหาร

- งานทั่วไปที่พี่เบนซ์มอบหมาย

หลักการตอบ:

- ตอบให้ตรงคำถาม

- กระชับแต่ครบ

- ห้ามแต่งข้อมูลที่ไม่มี

- ถ้าไม่ทราบให้บอกว่าไม่ทราบ

- ตัวเลขและการคำนวณต้องระมัดระวัง

- ข้อมูลสำคัญให้สรุปให้อ่านง่าย

- หากเป็นข้อมูลจากสมาชิกในกลุ่ม ให้ช่วยจัดระเบียบข้อมูลเพื่อใช้สรุปรายงานภายหลัง

`;

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        Authorization: `Bearer ${OPENAI_API_KEY}`

      },

      body: JSON.stringify({

        model: "gpt-5.6-luna",

        instructions: instructions,

        input: userText,

        max_output_tokens: 1000

      })

    }

  );

  const data = await response.json();

  if (!response.ok) {

    console.error(

      "OPENAI API ERROR:",

      response.status,

      JSON.stringify(data)

    );

    throw new Error(

      `OpenAI API error ${response.status}`

    );

  }

  const text = extractOpenAIText(data);

  if (!text) {

    throw new Error("OpenAI returned no text");

  }

  return text;

}

// ==============================

// EXTRACT OPENAI RESPONSE TEXT

// ==============================

function extractOpenAIText(data) {

  if (

    data &&

    typeof data.output_text === "string" &&

    data.output_text.trim()

  ) {

    return data.output_text.trim();

  }

  if (!data || !Array.isArray(data.output)) {

    return "";

  }

  const parts = [];

  for (const item of data.output) {

    if (!item || !Array.isArray(item.content)) {

      continue;

    }

    for (const content of item.content) {

      if (

        content &&

        typeof content.text === "string"

      ) {

        parts.push(content.text);

      }

    }

  }

  return parts.join("\n").trim();

}

// ==============================

// REPLY TO LINE

// ==============================

async function replyLINE(replyToken, text) {

  if (!LINE_CHANNEL_ACCESS_TOKEN) {

    throw new Error(

      "LINE_CHANNEL_ACCESS_TOKEN is missing"

    );

  }

  const safeText = String(text || "")

    .trim()

    .slice(0, 4900);

  if (!safeText) {

    return;

  }

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

        replyToken: replyToken,

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

    const errorText = await response.text();

    console.error(

      "LINE REPLY ERROR:",

      response.status,

      errorText

    );

    throw new Error(

      `LINE reply error ${response.status}`

    );

  }

}
// ==============================

// DOWNLOAD CONTENT FROM LINE

// ==============================

async function downloadLineContent(messageId) {

  const response = await fetch(

    `https://api-data.line.me/v2/bot/message/${messageId}/content`,

    {

      method: "GET",

      headers: {

        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`

      }

    }

  );

  if (!response.ok) {

    const errorText = await response.text();

    console.error("LINE CONTENT ERROR:", response.status, errorText);

    throw new Error(`LINE content error ${response.status}`);

  }

  const arrayBuffer = await response.arrayBuffer();

  return {

    buffer: Buffer.from(arrayBuffer),

    contentType:

      response.headers.get("content-type") ||

      "application/octet-stream"

  };

}

// ==============================

// HANDLE IMAGE / FILE

// ==============================

async function handleMediaMessage(event) {

  try {

    if (!event.replyToken || !event.message || !event.message.id) {

      return;

    }

    const media = await downloadLineContent(event.message.id);

    if (event.message.type === "image") {

      await replyLINE(

        event.replyToken,

        "อาร์ตได้รับรูปแล้วครับพี่เบนซ์ 🖼️ กำลังเตรียมระบบอ่านและวิเคราะห์รูปครับ"

      );

      return;

    }

    if (event.message.type === "file") {

      const fileName = event.message.fileName || "unknown-file";

      await replyLINE(

        event.replyToken,

        `อาร์ตได้รับไฟล์ ${fileName} แล้วครับ 📄 กำลังเตรียมระบบอ่าน PDF/Excel ครับ`

      );

      return;

    }

  } catch (error) {

    console.error("MEDIA ERROR:", error);

    if (event.replyToken) {

      await replyLINE(

        event.replyToken,

        "อาร์ตรับรูปหรือไฟล์ไม่สำเร็จชั่วคราวครับ กรุณาลองส่งอีกครั้งครับ"

      );

    }

  }

}


// ==============================

// START SERVER

// ==============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {

  console.log(

    `Art TTM server running on port ${PORT}`

  );

  console.log("Webhook: /webhook");

});
