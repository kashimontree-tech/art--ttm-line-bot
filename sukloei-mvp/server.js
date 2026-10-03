import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import mqtt from 'mqtt';
import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const app=express();
app.use(express.json());

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const PORT=Number(process.env.PORT||3000);
const ENABLE_MOCK_PAYMENT=(process.env.ENABLE_MOCK_PAYMENT||'false')==='true';
const DEVICE_API_KEY=process.env.DEVICE_API_KEY||'';
const COIN_BAHT_PER_PULSE=Number(process.env.COIN_BAHT_PER_PULSE||10);
const PULSE_MS=Number(process.env.PULSE_MS||50);

const dbEnabled=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase=dbEnabled?createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false}}
):null;

const MACHINES=[
  {code:'W13-01',name:'เครื่องซัก 13 kg #1',type:'WASHER',capacity:13},
  {code:'W13-02',name:'เครื่องซัก 13 kg #2',type:'WASHER',capacity:13},
  {code:'W18-01',name:'เครื่องซัก 18 kg #1',type:'WASHER',capacity:18},
  {code:'W18-02',name:'เครื่องซัก 18 kg #2',type:'WASHER',capacity:18},
  {code:'D13-01',name:'เครื่องอบ 13 kg #1',type:'DRYER',capacity:13},
  {code:'D13-02',name:'เครื่องอบ 13 kg #2',type:'DRYER',capacity:13},
  {code:'D18-01',name:'เครื่องอบ 18 kg #1',type:'DRYER',capacity:18},
  {code:'D18-02',name:'เครื่องอบ 18 kg #2',type:'DRYER',capacity:18}
];

const OPTIONS=[
  {code:'W13-COLD',category:'wash',type:'WASHER',capacity:13,program:'COLD',name:'น้ำเย็น',label:'ซัก 13 kg น้ำเย็น',price:40},
  {code:'W13-WARM',category:'wash',type:'WASHER',capacity:13,program:'WARM',name:'น้ำอุ่น',label:'ซัก 13 kg น้ำอุ่น',price:50},
  {code:'W13-HOT',category:'wash',type:'WASHER',capacity:13,program:'HOT',name:'น้ำร้อน',label:'ซัก 13 kg น้ำร้อน',price:60},
  {code:'W18-COLD',category:'wash',type:'WASHER',capacity:18,program:'COLD',name:'น้ำเย็น',label:'ซัก 18 kg น้ำเย็น',price:50},
  {code:'W18-WARM',category:'wash',type:'WASHER',capacity:18,program:'WARM',name:'น้ำอุ่น',label:'ซัก 18 kg น้ำอุ่น',price:60},
  {code:'W18-HOT',category:'wash',type:'WASHER',capacity:18,program:'HOT',name:'น้ำร้อน',label:'ซัก 18 kg น้ำร้อน',price:70},
  {code:'D13-STD',category:'dry',type:'DRYER',capacity:13,program:'STANDARD',name:'อบ 13 kg',label:'อบ 13 kg',price:40},
  {code:'D18-STD',category:'dry',type:'DRYER',capacity:18,program:'STANDARD',name:'อบ 18 kg',label:'อบ 18 kg',price:50},
  {code:'IRON-SHIRT',category:'iron',name:'เสื้อเชิ้ต',label:'รีดเสื้อเชิ้ต',price:15},
  {code:'IRON-TSHIRT',category:'iron',name:'เสื้อยืด',label:'รีดเสื้อยืด',price:10},
  {code:'IRON-PANTS',category:'iron',name:'กางเกง',label:'รีดกางเกง',price:15},
  {code:'IRON-SCHOOL-S',category:'iron',name:'ชุดนักเรียนเด็กเล็ก',label:'รีดชุดนักเรียนเด็กเล็ก',price:15},
  {code:'IRON-SCHOOL-L',category:'iron',name:'ชุดนักเรียนเด็กโต',label:'รีดชุดนักเรียนเด็กโต',price:25},
  {code:'IRON-SKIRT-DRESS',category:'iron',name:'กระโปรง / เดรส',label:'รีดกระโปรง / เดรส',price:20},
  {code:'IRON-WORKSET',category:'iron',name:'ชุดทำงาน',label:'รีดชุดทำงาน',price:50},
  {code:'IRON-SUIT',category:'iron',name:'เสื้อสูท / แจ็คเก็ต',label:'รีดเสื้อสูท / แจ็คเก็ต',price:60}
];

const machineByCode=code=>MACHINES.find(x=>x.code===code);
const optionByCode=code=>OPTIONS.find(x=>x.code===code);
const optionsForMachine=m=>OPTIONS.filter(o=>o.type===m.type&&o.capacity===m.capacity);

const memPayments=new Map();
const memCommands=new Map();
const memIronOrders=new Map();

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
  if(token&&to){
    const r=await fetch('https://api.line.me/v2/bot/message/push',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({to,messages:[{type:'text',text}]})
    });
    if(!r.ok) throw new Error('LINE '+r.status+' '+await r.text());
    return {sent:true,mode:'direct'};
  }

  const relayUrl=process.env.LINE_RELAY_URL;
  const relaySecret=process.env.SUKLOEI_RELAY_SECRET;
  if(relayUrl&&relaySecret){
    const r=await fetch(relayUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-sukloei-secret':relaySecret},
      body:JSON.stringify({text})
    });
    if(!r.ok) throw new Error('LINE relay '+r.status+' '+await r.text());
    return {sent:true,mode:'relay'};
  }

  console.log('[LINE disabled]\n'+text);
  return {sent:false,reason:'LINE env missing'};
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
  p.status='PAID';p.paid_at=now;p.command_sent=true;memPayments.set(ref,p);
  return p;
}

async function sendStart(payment){
  const commandId=uuidv4();
  const pulseCount=Math.max(1,Math.round(Number(payment.amount)/COIN_BAHT_PER_PULSE));
  const payload={
    command_id:commandId,
    action:'START',
    pulse_ms:PULSE_MS,
    pulse_count:pulseCount,
    credit_baht:Number(payment.amount),
    option_code:payment.option_code||null,
    payment_ref:payment.payment_ref
  };

  if(mqttClient?.connected){
    mqttClient.publish('laundry/'+payment.machine_code+'/command',JSON.stringify(payload),{qos:1});
  }
  if(dbEnabled){
    await supabase.from('machine_commands').insert({
      command_id:commandId,
      machine_code:payment.machine_code,
      payment_ref:payment.payment_ref,
      action:'START',
      pulse_ms:PULSE_MS,
      status:mqttClient?.connected?'SENT':'QUEUED',
      sent_at:new Date().toISOString()
    });
  }
  memCommands.set(payment.machine_code,{...payload,status:'QUEUED',created_at:new Date().toISOString()});
  return {commandId,mqttSent:!!mqttClient?.connected,pulseCount};
}

function requireDeviceKey(req,res,next){
  const key=String(req.headers['x-device-key']||'');
  if(!DEVICE_API_KEY||key!==DEVICE_API_KEY)return res.status(401).json({error:'unauthorized'});
  next();
}

app.use(express.static(path.join(__dirname,'public')));

app.get('/health',(req,res)=>res.json({
  ok:true,
  machines:MACHINES.length,
  options:OPTIONS.length,
  db:dbEnabled?'supabase':'memory',
  mqtt:!!mqttClient?.connected,
  mock_payment:ENABLE_MOCK_PAYMENT,
  time:new Date().toISOString()
}));

app.get('/api/catalog',(req,res)=>res.json({
  shop:{name:'ซักเลย',open:'24 ชั่วโมง'},
  machines:MACHINES.map(m=>({...m,options:optionsForMachine(m)})),
  ironing:OPTIONS.filter(o=>o.category==='iron')
}));

app.get('/api/machine/:machineCode',(req,res)=>{
  const m=machineByCode(req.params.machineCode);
  if(!m)return res.status(404).json({error:'unknown machine'});
  res.json({...m,options:optionsForMachine(m)});
});

app.get('/api/qr/:machineCode.png',async(req,res)=>{
  try{
    const m=machineByCode(req.params.machineCode);
    if(!m)return res.status(404).send('unknown machine');
    const base=process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`;
    const png=await QRCode.toBuffer(`${base}/m/${m.code}`,{width:720,margin:2});
    res.type('png').send(png);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/m/:machineCode',(req,res)=>{
  if(!machineByCode(req.params.machineCode))return res.status(404).send('Unknown machine');
  res.sendFile(path.join(__dirname,'public','index.html'));
});
app.get('/iron',(req,res)=>res.sendFile(path.join(__dirname,'public','iron.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

app.post('/api/payment/create',async(req,res)=>{
  try{
    const machineCode=String(req.body.machine_code||'');
    const optionCode=String(req.body.option_code||'');
    const m=machineByCode(machineCode);
    const option=optionByCode(optionCode);
    if(!m)return res.status(404).json({error:'unknown machine'});
    if(!option||option.category==='iron')return res.status(400).json({error:'invalid machine option'});
    if(option.type!==m.type||option.capacity!==m.capacity)return res.status(400).json({error:'option does not match machine'});

    const ref='SL-'+Date.now()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
    const p={
      payment_ref:ref,
      machine_code:machineCode,
      option_code:option.code,
      amount:option.price,
      status:'PENDING',
      provider:ENABLE_MOCK_PAYMENT?'mock':'pending-provider',
      command_sent:false,
      created_at:new Date().toISOString()
    };
    await savePayment(p);
    res.json({
      payment_ref:ref,
      machine:m,
      option,
      amount:option.price,
      status:'PENDING'
    });
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.post('/api/payment/mock-paid',async(req,res)=>{
  try{
    if(!ENABLE_MOCK_PAYMENT)return res.status(403).json({error:'mock payment disabled'});
    const ref=String(req.body.payment_ref||'');
    const existing=await findPayment(ref);
    if(!existing)return res.status(404).json({error:'payment not found'});
    if(existing.status==='PAID'&&existing.command_sent)return res.json({ok:true,duplicate:true});

    const option=optionByCode(existing.option_code);
    if(!option||Number(existing.amount)!==Number(option.price))return res.status(400).json({error:'amount mismatch'});

    const paid=await markPaid(ref);
    const command=await sendStart(paid);
    const m=machineByCode(paid.machine_code);
    const line=await linePush(
      '💰 ซักเลย — รับชำระเงินแล้ว\n'+
      'เครื่อง: '+m.name+' ('+m.code+')\n'+
      'โปรแกรม: '+option.label+'\n'+
      'ยอด: '+Number(paid.amount).toFixed(0)+' บาท\n'+
      'Payment: '+paid.payment_ref+'\n'+
      'สถานะ: รอ ESP32 รับคำสั่ง'
    );
    res.json({ok:true,payment_ref:ref,command_id:command.commandId,pulse_count:command.pulseCount,line});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.post('/api/payment/webhook',async(req,res)=>{
  try{
    const {payment_ref,status,amount,provider_txn_id}=req.body;
    if(!payment_ref||status!=='PAID')return res.status(400).json({error:'invalid webhook'});
    const existing=await findPayment(payment_ref);
    if(!existing)return res.status(404).json({error:'payment not found'});
    if(existing.status==='PAID'&&existing.command_sent)return res.json({ok:true,duplicate:true});
    if(Number(amount)!==Number(existing.amount))return res.status(400).json({error:'amount mismatch'});

    const paid=await markPaid(payment_ref);
    if(dbEnabled&&provider_txn_id){
      await supabase.from('payments').update({provider_txn_id}).eq('payment_ref',payment_ref);
    }
    const command=await sendStart(paid);
    const option=optionByCode(paid.option_code);
    await linePush(
      '💰 ซักเลย — Payment Success\nเครื่อง: '+paid.machine_code+
      '\nรายการ: '+(option?.label||paid.option_code)+
      '\nยอด: '+Number(paid.amount).toFixed(0)+' บาท\nPayment: '+paid.payment_ref
    );
    res.json({ok:true,command_id:command.commandId});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.post('/api/iron/order',async(req,res)=>{
  try{
    const items=Array.isArray(req.body.items)?req.body.items:[];
    const clean=[];
    let total=0;
    for(const item of items){
      const option=optionByCode(String(item.option_code||''));
      const qty=Math.max(0,Math.min(99,Number(item.qty)||0));
      if(!option||option.category!=='iron'||qty<=0)continue;
      clean.push({option_code:option.code,name:option.name,qty,unit_price:option.price,amount:qty*option.price});
      total+=qty*option.price;
    }
    if(!clean.length)return res.status(400).json({error:'no items'});
    const orderRef='IR-'+Date.now()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
    const order={order_ref:orderRef,items:clean,total,status:'NEW',created_at:new Date().toISOString()};
    memIronOrders.set(orderRef,order);
    await linePush(
      '👔 ซักเลย — งานรีดใหม่\n'+
      'เลขที่: '+orderRef+'\n'+
      clean.map(x=>'- '+x.name+' x'+x.qty+' = '+x.amount+' บาท').join('\n')+
      '\nรวม: '+total+' บาท'
    );
    res.json({ok:true,...order});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.get('/api/admin/summary',(req,res)=>{
  const payments=[...memPayments.values()];
  const paid=payments.filter(x=>x.status==='PAID');
  const revenue=paid.reduce((s,x)=>s+Number(x.amount||0),0);
  const iron=[...memIronOrders.values()];
  const ironTotal=iron.reduce((s,x)=>s+Number(x.total||0),0);
  res.json({
    paid_transactions:paid.length,
    machine_revenue:revenue,
    iron_orders:iron.length,
    iron_revenue:ironTotal,
    total_revenue:revenue+ironTotal,
    recent_payments:paid.slice(-20).reverse(),
    recent_iron_orders:iron.slice(-20).reverse()
  });
});

app.get('/api/device/:machineCode/next-command',requireDeviceKey,async(req,res)=>{
  try{
    if(!machineByCode(req.params.machineCode))return res.status(404).json({error:'unknown machine'});
    let command=memCommands.get(req.params.machineCode)||null;
    if(dbEnabled){
      const {data,error}=await supabase.from('machine_commands')
        .select('*')
        .eq('machine_code',req.params.machineCode)
        .in('status',['QUEUED','SENT'])
        .order('created_at',{ascending:true})
        .limit(1)
        .maybeSingle();
      if(error)throw error;
      if(data){
        command={
          command_id:data.command_id,
          action:data.action,
          pulse_ms:data.pulse_ms||PULSE_MS,
          pulse_count:command?.pulse_count||1,
          payment_ref:data.payment_ref||null,
          status:data.status
        };
      }
    }
    res.json({ok:true,command:command||null});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.post('/api/device/:machineCode/ack',requireDeviceKey,async(req,res)=>{
  try{
    if(!machineByCode(req.params.machineCode))return res.status(404).json({error:'unknown machine'});
    const {command_id,status}=req.body||{};
    if(!command_id)return res.status(400).json({error:'command_id required'});
    const current=memCommands.get(req.params.machineCode);
    if(current?.command_id===command_id)memCommands.delete(req.params.machineCode);

    if(dbEnabled){
      const {error}=await supabase.from('machine_commands')
        .update({status:status==='STARTED'?'ACK':'FAILED',ack_at:new Date().toISOString()})
        .eq('command_id',command_id);
      if(error)throw error;
    }
    await linePush(
      status==='STARTED'
        ? '🟢 ซักเลย — เครื่องรับเครดิตแล้ว\nเครื่อง: '+req.params.machineCode+'\nCommand: '+command_id
        : '🔴 ซักเลย — เครื่องตอบกลับผิดปกติ\nเครื่อง: '+req.params.machineCode+'\nสถานะ: '+String(status||'UNKNOWN')
    );
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:e.message})}
});

app.listen(PORT,()=>console.log('Sukloei full catalog listening on '+PORT));
