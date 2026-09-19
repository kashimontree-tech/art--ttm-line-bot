const express = require("express");

const crypto = require("crypto");

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// แสดงทุก request ใน Render Logs

app.use((req, res, next) => {

  console.log(`[HTTP] ${req.method} ${req.originalUrl}`);

  next();

});

// หน้าแรกสำหรับเช็กว่า Server ทำงาน

app.get("/", (req, res) => {

  res.status(200).send("Art TTM LINE Bot is running");

});

// เปิดไว้สำหรับตรวจว่า /webhook มีอยู่จริง

app.get("/webhook", (req, res) => {

  res.status(200).send("Art TTM webhook is ready");

});

// LINE Webhook

app.post(

  "/webhook",

  express.raw({ type: "*/*" }),

  async (req, res) => {

    try {

      const rawBody = Buffer.isBuffer(req.body)

        ? req.body

        : Buffer.from(req.body || "");

      const signature = req.get("x-line-signature") || "";

      if (!CHANNEL_SECRET) {

        console.error("ERROR: LINE_CHANNEL_SECRET is missing");

        return res.sendStatus(500);

      }

      const expectedSignature = crypto

        .createHmac("sha256", CHANNEL_SECRET)

        .update(rawBody)

        .digest("base64");

      const signatureIsValid =

        signature.length === expectedSignature.length &&

        crypto.timingSafeEqual(

          Buffer.from(signature),

          Buffer.from(expectedSignature)

        );

      if (!signatureIsValid) {

        console.error("ERROR: Invalid LINE signature");

        return res.sendStatus(401);

      }

      let body = {};

      if (rawBody.length > 0) {

        body = JSON.parse(rawBody.toString("utf8"));

      }

      // ตอบ LINE 200 ทันที

      res.sendStatus(200);

      for (const event of body.events || []) {

        if (

          event.type === "message" &&

          event.message &&

          event.message.type === "text" &&

          event.replyToken

        ) {

          await replyMessage(

            event.replyToken,

            `สวัสดีครับ ผม Art TTM 🤖

ระบบ LINE Webhook เชื่อมต่อสำเร็จแล้วครับ

ข้อความที่ได้รับ:

${event.message.text}`

          );

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

async function replyMessage(replyToken, text) {

  try {

    if (!CHANNEL_ACCESS_TOKEN) {

      console.error("ERROR: LINE_CHANNEL_ACCESS_TOKEN is missing");

      return;

    }

    const response = await fetch(

      "https://api.line.me/v2/bot/message/reply",

      {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,

        },

        body: JSON.stringify({

          replyToken,

          messages: [

            {

              type: "text",

              text: text,

            },

          ],

        }),

      }

    );

    if (!response.ok) {

      console.error(

        "LINE REPLY ERROR:",

        response.status,

        await response.text()

      );

    }

  } catch (error) {

    console.error("LINE REPLY EXCEPTION:", error);

  }

}

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {

  console.log(`Art TTM server running on port ${PORT}`);

  console.log("Webhook endpoint: /webhook");

});
