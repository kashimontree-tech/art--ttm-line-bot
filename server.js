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

      const signature = req.headers["x-line-signature"];

      const expectedSignature = crypto

        .createHmac("SHA256", CHANNEL_SECRET)

        .update(req.body)

        .digest("base64");

      if (!signature || signature !== expectedSignature) {

        return res.status(401).send("Invalid signature");

      }

      const body = JSON.parse(req.body.toString("utf8"));

      res.sendStatus(200);

      for (const event of body.events || []) {

        if (

          event.type === "message" &&

          event.message &&

          event.message.type === "text"

        ) {

          await replyMessage(

            event.replyToken,

            "สวัสดีครับ ผม Art TTM 🤖\nระบบเชื่อมต่อ LINE สำเร็จแล้วครับ"

          );

        }

      }

    } catch (error) {

      console.error(error);

      if (!res.headersSent) res.sendStatus(500);

    }

  }

);

async function replyMessage(replyToken, text) {

  const response = await fetch(

    "https://api.line.me/v2/bot/message/reply",

    {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,

      },

      body: JSON.stringify({

        replyToken: replyToken,

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

    console.error("LINE reply error:", await response.text());

  }

}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`Art TTM server running on port ${PORT}`);

});
