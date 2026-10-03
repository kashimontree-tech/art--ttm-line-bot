import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const app=express();
app.use(express.json());

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const PORT=Number(process.env.PORT||3000);
const MACHINE_CODE=process.env.MACHINE_CODE||'W13-01';
const MACHINE_PRICE=Number(process.env.MACHINE_PRICE||40);
const ENABLE_MOCK_PAYMENT=(process.env.ENABLE_MOCK_PAYMENT||'false')==='true';

const dbEnabled=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase=dbEnabled?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}):null;

const memPayments=new Map();

let mqttClient=null;
if(process.env.MQTT_URL){
  mqttClient=mqtt.connect(process.env.MQTT_URL,{
    username:process.env.MQTT_USERNAME||undefined,
    password:process.env.MQTT_PASSWORD||undefined,
    clientId:'sukloei-server-'+Math.random().toString(16).slice(2)
  });
  mqttClient.on('connect',()=>console.log('[MQTT] connected'));
  mqttClient.on('error',e=>console.error('[MQTT]',e.message));
}

async function linePush(text){
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to=process.env.LINE_TARGET_ID;
  if(!token||!to){
    console.log('[LINE disabled]\n'+text);
    return {sent:false,reason:'LINE env missing'};
  }
  const r=await fetch('https://api.line.me/v2/bot/message/push',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({to,messages:[{type:'text',text}]})
  });
  if(!r.ok) throw new Error('LINE '+r.status+' '+await r.text());
  return {sent:true};
}

async function savePayment(p){
  if(dbEnabled){
    const {error}=await supabase.from('payments').insert(p);
    if(error) throw error;
  }else memPayments.set(p.payment_ref,p);
}

async function findPayment(ref){
  if(dbEnabled){
    const {data,error}=await supabase.from('payments').select('*').eq('payment_ref',ref).single();
    if(error) throw error;
    return data;
  }
  return memPayments.get(ref);
}

async function markPaid(ref){
  const now=new Date().toISOString();
  if(dbEnabled){
    const {data,error}=await supabase.from('payments')
      .update({status:'PAID',paid_at:now,command_sent:true})
      .eq('payment_ref',ref).eq('status','PENDING')
      .select().single();
    if(error) throw error;
    return data;
  }
  const p=memPayments.get(ref);
  if(!p) return null;
  if(p.status==='PAID') return p;
  p.status='PAID'; p.paid_at=now; p.command_sent=true; memPayments.set(ref,p);
  return p;
}

async function sendStart(payment){
  const commandId=uuidv4();
  const payload={command_id:commandId,action:'START',pulse_ms:400,payment_ref:payment.payment_ref};
  if(mqttClient?.connected){
    mqttClient.publish('laundry/'+payment.machine_code+'/command',JSON.stringify(payload),{qos:1});
  }
  if(dbEnabled){
    await supabase.from('machine_commands').insert({
      command_id:commandId,
      machine_code:payment.machine_code,
      payment_ref:payment.payment_ref,
      action:'START',
      pulse_ms:400,
      status:mqttClient?.connected?'SENT':'QUEUED',
      sent_at:new Date().toISOString()
    });
  }
  return {commandId,mqttSent:!!mqttClient?.connected};
}

app.use(express.static(path.join(__dirname,'public')));

app.get('/health',(req,res)=>res.json({
  ok:true,
  machine:MACHINE_CODE,
  db:dbEnabled?'supabase':'memory',
  mqtt:!!mqttClient?.connected,
  mock_payment:ENABLE_MOCK_PAYMENT,
  time:new Date().toISOString()
}));

app.get('/m/:machineCode',(req,res)=>{
  if(req.params.machineCode!==MACHINE_CODE) return res.status(404).send('Unknown machine');
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.post('/api/payment/create',async(req,res)=>{
  try{
    const machineCode=req.body.machine_code||MACHINE_CODE;
    if(machineCode!==MACHINE_CODE) return res.status(404).json({error:'unknown machine'});
    const ref='SL-'+Date.now()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
    const p={
      payment_ref:ref,
      machine_code:machineCode,
      amount:MACHINE_PRICE,
      status:'PENDING',
      provider:ENABLE_MOCK_PAYMENT?'mock':'pending-provider',
      command_sent:false,
      created_at:new Date().toISOString()
    };
    await savePayment(p);
    res.json({payment_ref:ref,machine_code:machineCode,amount:MACHINE_PRICE,status:'PENDING'});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.post('/api/payment/mock-paid',async(req,res)=>{
  try{
    if(!ENABLE_MOCK_PAYMENT) return res.status(403).json({error:'mock payment disabled'});
    const ref=req.body.payment_ref;
    const existing=await findPayment(ref);
    if(!existing) return res.status(404).json({error:'payment not found'});
    if(existing.status==='PAID'&&existing.command_sent) return res.json({ok:true,duplicate:true});
    if(Number(existing.amount)!==MACHINE_PRICE) return res.status(400).json({error:'amount mismatch'});

    const paid=await markPaid(ref);
    const command=await sendStart(paid);
    const line=await linePush(
      '💰 ซักเลย — รับชำระเงินแล้ว\n'+
      'เครื่อง: เครื่องซัก 13 kg #1 ('+paid.machine_code+')\n'+
      'ยอด: '+Number(paid.amount).toFixed(0)+' บาท\n'+
      'Payment: '+paid.payment_ref+'\n'+
      'สถานะ: ส่งคำสั่งเริ่มเครื่องแล้ว'+(command.mqttSent?'':' (MQTT ยังไม่เชื่อม)'
      )
    );
    res.json({ok:true,payment_ref:ref,command_id:command.commandId,mqtt_sent:command.mqttSent,line});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.post('/api/payment/webhook',async(req,res)=>{
  try{
    const {payment_ref,status,amount,provider_txn_id}=req.body;
    if(!payment_ref||status!=='PAID') return res.status(400).json({error:'invalid webhook'});
    const existing=await findPayment(payment_ref);
    if(!existing) return res.status(404).json({error:'payment not found'});
    if(existing.status==='PAID'&&existing.command_sent) return res.json({ok:true,duplicate:true});
    if(Number(amount)!==Number(existing.amount)) return res.status(400).json({error:'amount mismatch'});
    const paid=await markPaid(payment_ref);
    if(dbEnabled&&provider_txn_id){
      await supabase.from('payments').update({provider_txn_id}).eq('payment_ref',payment_ref);
    }
    const command=await sendStart(paid);
    await linePush('💰 ซักเลย — Payment Success\nเครื่อง: '+paid.machine_code+'\nยอด: '+Number(paid.amount).toFixed(0)+' บาท\nPayment: '+paid.payment_ref);
    res.json({ok:true,command_id:command.commandId});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.listen(PORT,()=>console.log('Sukloei MVP listening on '+PORT));
