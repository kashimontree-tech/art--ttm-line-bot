
const express = require("express");

const crypto = require("crypto");

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

app.get("/", (req, res) => {

  res.status(200).send("Art TTM LINE Bot is running");

});

app.post(

  "/webhook",

  express.raw({ type: "application/json" }),

  async (req, res) => {

    try {

      const rawBody = req.body;

      const signature = req.get("x-line-signature") || "";

      if (!CHANNEL_SECRET) {

        console.error("LINE_CHANNEL_SECRET is missing");

        return res.sendStatus(500);

      }

      const expectedSignature = crypto

        .createHmac("sha256", CHANNEL_SECRET)

        .update(rawBody)

        .digest("base64");

      const validSignature =

        signature.length === expectedSignature.length &&

        crypto.timingSafeEqual(

          Buffer.from(signature),

          Buffer.from(expectedSignature)

        );

      if (!validSignature) {

        console.error("Invalid LINE signature");

        return res.sendStatus(401);

      }

      const body = JSON.parse(rawBody.toString("utf8"));

      // ตอบ LINE ทันที เพื่อให้ Webhook Verify ผ่าน

      res.sendStatus(200);

      for (const event of body.events || []) {

        if (

          event.type === "message" &&

          event.message &&

          event.message.type === "text" &&

          event.replyToken

        ) {

          await replyToLine(

            event.replyToken,

            "อาร์ต TTM รับข้อความแล้วครับ: " + event.message.text

          );

        }

      }

    } catch (error) {

      console.error("Webhook error:", error);

      if (!res.headersSent) {

        res.sendStatus(500);

      }

    }

  }

);

async function replyToLine(replyToken, text) {

  if (!CHANNEL_ACCESS_TOKEN) {

    console.error("LINE_CHANNEL_ACCESS_TOKEN is missing");

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

            text,

          },

        ],

      }),

    }

  );

  if (!response.ok) {

    console.error("LINE reply error:", await response.text());

  }

}

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {

  console.log(`Art TTM server running on port ${PORT}`);

});
