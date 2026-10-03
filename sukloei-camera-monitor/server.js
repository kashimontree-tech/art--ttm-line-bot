import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const app=express();
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const PORT=Number(process.env.PORT||3000);
const ADMIN_PIN=String(process.env.ADMIN_PIN||'');
const CAMERA_INGEST_TOKEN=String(process.env.CAMERA_INGEST_TOKEN||'');
const LINE_RELAY_URL=String(process.env.LINE_RELAY_URL||'');
const LINE_RELAY_SECRET=String(process.env.SUKLOEI_RELAY_SECRET||'');

const CAMERA_IDS=['CAM-01','CAM-02'];
const state=new Map(CAMERA_IDS.map(id=>[id,{
  id,
  lastSeen:null,
  lastFile:null,
  lastBytes:0,
  offlineAlerted:false
}]));

const dir=path.join(os.tmpdir(),'sukloei-cameras');
fs.mkdirSync(dir,{recursive:true});

app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  next();
});
app.use(express.static(path.join(__dirname,'public')));

function ownerAuth(req,res,next){
  const pin=String(req.headers['x-admin-pin']||req.query.pin||'');
  if(!ADMIN_PIN || pin!==ADMIN_PIN) return res.status(401).json({error:'unauthorized'});
  next();
}

function ingestAuth(req,res,next){
  const token=String(req.headers['x-camera-token']||'');
  if(!CAMERA_INGEST_TOKEN || token!==CAMERA_INGEST_TOKEN) return res.status(401).json({error:'unauthorized'});
  next();
}

async function linePush(text){
  if(!LINE_RELAY_URL||!LINE_RELAY_SECRET) return;
  try{
    const r=await fetch(LINE_RELAY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-sukloei-secret':LINE_RELAY_SECRET},
      body:JSON.stringify({text})
    });
    if(!r.ok) console.error('LINE relay',r.status,await r.text());
  }catch(e){
    console.error('LINE push failed',e.message);
  }
}

app.get('/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.post('/api/ingest/:cameraId',
  ingestAuth,
  express.raw({type:['image/jpeg','image/jpg','application/octet-stream'],limit:'5mb'}),
  (req,res)=>{
    const id=req.params.cameraId;
    if(!state.has(id)) return res.status(404).json({error:'unknown camera'});
    if(!Buffer.isBuffer(req.body)||req.body.length<1000) return res.status(400).json({error:'invalid image'});
    const file=path.join(dir,id+'.jpg');
    fs.writeFileSync(file,req.body);
    const s=state.get(id);
    const wasOffline=s.lastSeen && (Date.now()-new Date(s.lastSeen).getTime()>180000);
    s.lastSeen=new Date().toISOString();
    s.lastFile=file;
    s.lastBytes=req.body.length;
    if(wasOffline||s.offlineAlerted){
      s.offlineAlerted=false;
      linePush('🟢 ซักเลย — กล้องกลับมาออนไลน์\nกล้อง: '+id);
    }
    res.json({ok:true,camera:id,bytes:req.body.length});
  }
);

app.get('/api/cameras',ownerAuth,(req,res)=>{
  const now=Date.now();
  const cameras=[...state.values()].map(s=>{
    const age=s.lastSeen?Math.round((now-new Date(s.lastSeen).getTime())/1000):null;
    return {
      id:s.id,
      online:age!==null && age<=180,
      last_seen:s.lastSeen,
      age_seconds:age,
      has_image:!!s.lastFile
    };
  });
  res.json({cameras});
});

app.get('/api/latest/:cameraId.jpg',ownerAuth,(req,res)=>{
  const s=state.get(req.params.cameraId);
  if(!s) return res.status(404).end();
  if(!s.lastFile||!fs.existsSync(s.lastFile)) return res.status(404).end();
  res.type('jpg').sendFile(s.lastFile);
});

setInterval(()=>{
  const now=Date.now();
  for(const s of state.values()){
    if(!s.lastSeen) continue;
    const age=now-new Date(s.lastSeen).getTime();
    if(age>180000 && !s.offlineAlerted){
      s.offlineAlerted=true;
      linePush('🔴 ซักเลย — กล้องออฟไลน์เกิน 3 นาที\nกล้อง: '+s.id);
    }
  }
},30000);

app.listen(PORT,()=>console.log('Sukloei camera monitor listening on '+PORT));
