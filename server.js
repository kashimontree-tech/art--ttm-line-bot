const express = require("express");
const crypto = require("crypto");

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

app.get("/", (req, res) => {
  res.status(200).send("Art TTM LINE Bot is running");
});

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
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
          let answer;
          try {
            answer = await askOpenAI(event.message.text);
          } catch (error) {
            console.error("OpenAI processing error:", error);
            answer =
              "ขออภัยครับ ระบบ Art TTM มีปัญหาชั่วคราว กรุณาลองส่งข้อความอีกครั้งครับ";
          }

          try {
            await replyMessage(event.replyToken, answer);
          } catch (error) {
            console.error("LINE reply error:", error);
          }
        }
      }
    } catch (error) {
      console.error("Webhook error:", error);
      if (!res.headersSent) res.sendStatus(500);
    }
  }
);

async function askOpenAI(userText) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "คุณคือ Art TTM ผู้ช่วย AI ของทีม TTM HOME DESIGN & BUILD-IN ตอบภาษาไทยเป็นหลัก สุภาพ กระชับ ชัดเจน ช่วยงานก่อสร้าง ออกแบบ BOQ ต้นทุน งานระบบ และงานทั่วไปของทีม หากข้อมูลไม่พอให้ถามกลับ และห้ามแต่งข้อมูลหรือราคาโดยไม่มีฐานอ้างอิง",
      input: userText,
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
