# ซักเลย Camera Monitor

ระบบนี้แยกจากเว็บจองและเว็บสแกนจ่าย

## หลักการ
กล้อง Yoosee อยู่ใน LAN ของร้าน จึงให้เครื่องเล็ก/PC ที่ร้านอ่าน RTSP แล้วส่งภาพนิ่งขึ้น Cloud ทุก 15 วินาที

Flow:
Yoosee RTSP -> edge_agent.py -> Render Camera Monitor -> Owner dashboard + LINE offline alerts

## กล้อง
- CAM-01
- CAM-02

## RTSP
Yoosee หลายรุ่นใช้ RTSP port 554 และ path /onvif1 หรือ /onvif2
ต้องเปิด RTSP ในแอป/เฟิร์มแวร์ของกล้องก่อน

ตัวอย่าง:
rtsp://admin:PASSWORD@192.168.1.100:554/onvif1

## Edge Agent
ต้องมี ffmpeg และ Python ติดตั้งในเครื่องที่อยู่ Wi-Fi/LAN เดียวกับกล้อง

Environment:
CAMERA_MONITOR_URL=https://sukloei-camera-monitor.onrender.com
CAMERA_INGEST_TOKEN=...
CAM01_RTSP=rtsp://...
CAM02_RTSP=rtsp://...
SNAPSHOT_INTERVAL=15

จากนั้น:
pip install -r requirements.txt
python edge_agent.py
