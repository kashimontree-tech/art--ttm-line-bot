const express = require("express");

const crypto = require("crypto");

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const LINE_CHANNEL_ACCESS_TOKEN =

  process.env.LINE_CHANNEL_ACCESS_TOKEN;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// =========================

// HEALTH CHECK

// =========================

app.get("/", (req, res) => {

  res.status(200).send("Art TTM LINE Bot is running");

});

// =========================

// LINE WEBHOOK

// =========================

app.post(

  "/webhook",

  express.raw({ type: "application/json" }),

  async (req, res) => {

    try {

      // ตรวจสอบ LINE Signature

      const signature = req.headers["x-line-signature"];

      const expectedSignature = crypto

        .createHmac("SHA256", LINE_CHANNEL_SECRET)

        .update(req.body)

        .digest("base64");

      if (!signature || signature !== expectedSignature) {

        return res.status(401).send("Invalid signature");

      }

      const body = JSON.parse(

        req.body.toString("utf8")

      );

      // ตอบ LINE ทันทีว่าได้รับ Webhook แล้ว

      res.sendStatus(200);

      for (const event of body.events || []) {

        await handleEvent(event);

      }

    } catch (error) {

      console.error("Webhook error:", error);

      if (!res.headersSent) {

        res.sendStatus(500);

      }

    }

  }

);

// =========================

// HANDLE LINE EVENT

// =========================

async function handleEvent(event) {

  try {

    // เมื่อ Art TTM เข้ากลุ่ม

    if (event.type === "join" && event.replyToken) {

      const intro =

        "สวัสดีครับ ผมชื่ออาร์ต 🤖\n" +

        "ผมเป็น Bot ผู้ช่วยพี่เบนซ์ในทุกด้าน " +

        "และจะคอยเก็บข้อมูลการทำงานต่าง ๆ " +

        "เพื่อสรุปและรายงานพี่เบนซ์ทุกวันครับ";

      await replyLINE(

        event.replyToken,

        intro

      );

      return;

    }

    // รับเฉพาะข้อความ Text

    if (

      event.type !== "message" ||

      !event.message ||

      event.message.type !== "text" ||

      !event.replyToken

    ) {

      return;

    }

    const userText = event.message.text.trim();

    console.log(

      "LINE message:",

      userText

    );

    // ส่งข้อความเข้า OpenAI

    const aiAnswer =

      await askOpenAI(userText);

    // ส่งคำตอบกลับ LINE

    await replyLINE(

      event.replyToken,

      aiAnswer

    );

  } catch (error) {

    console.error(

      "Handle event error:",

      error

    );

    if (event.replyToken) {

      try {

        await replyLINE(

          event.replyToken,

          "อาร์ตได้รับข้อความแล้วครับ " +

            "แต่ระบบ AI มีปัญหาชั่วคราว " +

            "กรุณาลองใหม่อีกครั้งครับ"

        );

      } catch (replyError) {

        console.error(

          "Fallback reply error:",

          replyError

        );

      }

    }

  }

}

// =========================

// OPENAI

// =========================

async function askOpenAI(userText) {

  if (!OPENAI_API_KEY) {

    throw new Error(

      "OPENAI_API_KEY is missing"

    );

  }

  const response = await fetch(

    "https://api.openai.com/v1/responses",

    {

      method: "POST",

      headers: {

        "Content-Type":

          "application/json",

        Authorization:

          `Bearer ${OPENAI_API_KEY}`,

      },

      body: JSON.stringify({

        model: "gpt-5.6-luna",

        instructions: `

คุณชื่อ "อาร์ต"

คุณเป็น AI Bot ผู้ช่วยพี่เบนซ์

และทีมงานบริษัท

TTM HOME DESIGN & BUILD-IN

หลักการตอบ:

- ตอบภาษาไทยเป็นหลัก

- สุภาพ เป็นกันเอง

- กระชับ เข้าใจง่าย

- เรียกเจ้าของว่า "พี่เบนซ์"

- ช่วยสมาชิกทีม TTM อย่างมืออาชีพ

- ตอบคำถามตามข้อมูลที่มี

- ถ้าข้อมูลไม่พอ ให้ถามข้อมูลเพิ่ม

- ห้ามแต่งข้อมูล ตัวเลข หรือราคาเอง

งานหลักที่ช่วย:

- งานก่อสร้าง

- งานตกแต่งภายใน

- งาน Built-in

- BOQ

- คำนวณต้นทุน

- ราคาวัสดุ

- ค่าแรง

- Supplier

- เปรียบเทียบราคา

- ใบเสนอราคา

- งานไฟฟ้า

- ตารางโหลด

- งานออกแบบ

- งานหน้างาน

- Project Management

- วิเคราะห์กำไรขาดทุน

- งานเอกสาร

- งานบริษัท

- งานทั่วไปของทีม TTM

เมื่ออยู่ใน LINE Group:

- ตอบคำถามสมาชิกอย่างสุภาพ

- ช่วยประสานงานและสรุปข้อมูล

- หากมีคนเรียก "อาร์ต"

  ให้เข้าใจว่ากำลังเรียก Bot

ความปลอดภัย:

ห้ามเปิดเผย

- OpenAI API Key

- LINE Channel Secret

- LINE Access Token

- Password

- Secret Key

- ข้อมูลลับของระบบ

`,

        input: userText,

        max_output_tokens: 1000

      })

    }

  );

  const data =

    await response.json();

  if (!response.ok) {

    console.error(

      "OpenAI error:",

      response.status,

      JSON.stringify(data)

    );

    throw new Error(

      "OpenAI API request failed"

    );

  }

  // กรณี API ส่ง output_text มาโดยตรง

  if (data.output_text) {

    return data.output_text;

  }

  // สำรองกรณีต้องอ่านจาก output

  const text = (data.output || [])

    .flatMap(

      item => item.content || []

    )

    .filter(

      item =>

        item.type === "output_text"

    )

    .map(

      item => item.text

    )

    .join("\n")

    .trim();

  if (text) {

    return text;

  }

  return "อาร์ตได้รับข้อความแล้วครับ";

}

// =========================

// REPLY LINE

// =========================

async function replyLINE(

  replyToken,

  text

) {

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

        replyToken: replyToken,

        messages: [

          {

            type: "text",

            text: String(text)

              .slice(0, 4900)

          }

        ]

      })

    }

  );

  if (!response.ok) {

    const errorText =

      await response.text();

    console.error(

      "LINE reply error:",
