import os, time, subprocess, tempfile, requests

SERVER=os.environ.get("CAMERA_MONITOR_URL","https://sukloei-camera-monitor.onrender.com").rstrip("/")
TOKEN=os.environ["CAMERA_INGEST_TOKEN"]
INTERVAL=int(os.environ.get("SNAPSHOT_INTERVAL","15"))

CAMERAS=[
    ("CAM-01",os.environ.get("CAM01_RTSP","")),
    ("CAM-02",os.environ.get("CAM02_RTSP",""))
]

def capture(rtsp):
    fd,path=tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    try:
        cmd=[
            "ffmpeg","-loglevel","error","-rtsp_transport","tcp",
            "-i",rtsp,"-frames:v","1","-q:v","3","-y",path
        ]
        subprocess.run(cmd,check=True,timeout=15)
        with open(path,"rb") as f:
            return f.read()
    finally:
        try: os.remove(path)
        except OSError: pass

while True:
    for camera_id,rtsp in CAMERAS:
        if not rtsp:
            continue
        try:
            image=capture(rtsp)
            r=requests.post(
                f"{SERVER}/api/ingest/{camera_id}",
                data=image,
                headers={"Content-Type":"image/jpeg","x-camera-token":TOKEN},
                timeout=15
            )
            print(camera_id,r.status_code,r.text[:120])
        except Exception as e:
            print(camera_id,"ERROR",e)
    time.sleep(INTERVAL)
