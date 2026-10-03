# ซักเลย MVP — W13-01

MVP สำหรับทดสอบ flow ก่อนต่อเครื่องจริง:

สแกน QR/เปิดหน้าเครื่อง → สร้างรายการ → จำลองจ่าย 40 บาท → Server → บันทึก Supabase → MQTT command (ถ้ามี broker) → LINE แจ้งเตือน

## Render
สร้าง Web Service จาก repository นี้ โดยตั้ง Root Directory เป็น `sukloei-mvp`.

Start command:
`npm start`

Health:
`/health`

หน้าเครื่อง:
`/m/W13-01`

## Env
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- LINE_CHANNEL_ACCESS_TOKEN
- LINE_TARGET_ID
- MQTT_URL (เว้นได้ในขั้นทดสอบ)
- ENABLE_MOCK_PAYMENT=true

## Database
รัน `sql/schema.sql` ใน Supabase SQL editor

## สำคัญ
โหมดนี้เป็นการจำลอง payment เท่านั้น ยังไม่หักเงินจริงและยังไม่ต่อขั้ว Coin/Pulse ของเครื่องซักจริง

ก่อนต่อฮาร์ดแวร์ ต้องยืนยันแรงดันและ pinout ของ LG CWG27MSQRS และใช้ isolated optocoupler/relay เท่านั้น
