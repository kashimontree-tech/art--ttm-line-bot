import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const app=express();
app.use(express.json());

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const PORT=Number(process.env.PORT||3000);

const SUPABASE_URL=process.env.SUPABASE_URL||'https://mmsspzwobyrojzqdiynh.supabase.co';
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_eZ4L-l-oYOjh4hx_MgkSmA_jHBKlOGg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false}});

const LINE_RELAY_URL=String(process.env.LINE_RELAY_URL||'');
const LINE_RELAY_SECRET=String(process.env.SUKLOEI_RELAY_SECRET||'');

async function linePush(text){
  if(!LINE_RELAY_URL||!LINE_RELAY_SECRET){
    console.log('[LINE relay disabled]',text);
    return {sent:false};
  }
  const r=await fetch(LINE_RELAY_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-sukloei-secret':LINE_RELAY_SECRET},
    body:JSON.stringify({text})
  });
  if(!r.ok) throw new Error('LINE relay '+r.status+' '+await r.text());
  return {sent:true};
}

function thTime(iso){
  return new Date(iso).toLocaleString('th-TH',{
    timeZone:'Asia/Bangkok',
    day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:false
  });
}

app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  next();
});
app.use(express.static(path.join(__dirname,'public')));

function bangkokIso(dateStr,timeStr){
  return new Date(`${dateStr}T${timeStr}:00+07:00`).toISOString();
}

app.get('/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.get('/api/machines',async(req,res)=>{
  const {data,error}=await supabase.rpc('booking_get_machines');
  if(error)return res.status(500).json({error:error.message});
  res.json(data||[]);
});

app.get('/api/availability',async(req,res)=>{
  try{
    const date=String(req.query.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'invalid date'});

    const start=new Date(date+'T00:00:00+07:00').toISOString();
    const end=new Date(new Date(date+'T00:00:00+07:00').getTime()+24*60*60*1000).toISOString();

    const [{data:machines,error:mErr},{data:bookings,error:bErr}]=await Promise.all([
      supabase.rpc('booking_get_machines'),
      supabase.rpc('booking_get_busy_slots',{p_date:date})
    ]);
    if(mErr)throw mErr;if(bErr)throw bErr;

    res.json({
      date,
      machines:(machines||[]).map(m=>({
        ...m,
        bookings:(bookings||[]).filter(b=>b.machine_code===m.machine_code)
      }))
    });
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/bookings',async(req,res)=>{
  try{
    const {
      machine_code,customer_name,customer_phone,date,time,note,
      home_service=false,home_address='',within_5km_confirmed=false
    }=req.body||{};

    if(!machine_code||!customer_name||!customer_phone||!date||!time)
      return res.status(400).json({error:'กรอกข้อมูลไม่ครบ'});

    const {data,error}=await supabase.rpc('booking_create',{
      p_machine_code:String(machine_code),
      p_customer_name:String(customer_name),
      p_customer_phone:String(customer_phone),
      p_date:String(date),
      p_time:String(time),
      p_note:String(note||''),
      p_home_service:Boolean(home_service),
      p_home_address:String(home_address||''),
      p_within_5km:Boolean(within_5km_confirmed)
    });

    if(error){
      const msg=String(error.message||'จองไม่สำเร็จ');
      const status=msg.includes('มีคนจองแล้ว')?409:400;
      return res.status(status).json({error:msg});
    }

    try{
      await linePush(
        '📅 ร้านซักเลย — มีรายการจองใหม่\n'+
        'ชื่อ: '+String(customer_name)+'\n'+
        'โทร: '+String(customer_phone)+'\n'+
        'เครื่อง: '+String(data.machine?.name||machine_code)+' ('+String(machine_code)+')\n'+
        'เวลา: '+thTime(data.booking.start_at)+' - '+new Date(data.booking.end_at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false})+' น.\n'+
        'Booking: '+String(data.booking.booking_ref)+
        (data.home_service?.enabled?'\n🚚 รับ–ส่งถึงบ้าน +40 บาท':'')
      );
    }catch(e){console.error('Booking LINE alert failed:',e.message)}
    res.json({ok:true,...data});
  }catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

app.post('/api/bookings/combo',async(req,res)=>{
  try{
    const {
      washer_code,dryer_code,customer_name,customer_phone,date,time,note,
      home_service=false,home_address='',within_5km_confirmed=false
    }=req.body||{};

    if(!washer_code||!dryer_code||!customer_name||!customer_phone||!date||!time)
      return res.status(400).json({error:'กรอกข้อมูลจองซัก+อบไม่ครบ'});

    const {data,error}=await supabase.rpc('booking_create_combo',{
      p_washer_code:String(washer_code),
      p_dryer_code:String(dryer_code),
      p_customer_name:String(customer_name),
      p_customer_phone:String(customer_phone),
      p_date:String(date),
      p_time:String(time),
      p_note:String(note||''),
      p_home_service:Boolean(home_service),
      p_home_address:String(home_address||''),
      p_within_5km:Boolean(within_5km_confirmed)
    });

    if(error){
      const msg=String(error.message||'จองซัก+อบไม่สำเร็จ');
      const status=msg.includes('มีคนจองแล้ว')?409:400;
      return res.status(status).json({error:msg});
    }

    try{
      await linePush(
        '📅 ร้านซักเลย — จองซัก+อบพร้อมกัน\n'+
        'ชื่อ: '+String(customer_name)+'\n'+
        'โทร: '+String(customer_phone)+'\n'+
        '🧺 '+String(data.washer?.name||washer_code)+' '+new Date(data.washer_booking.start_at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false})+'-'+new Date(data.washer_booking.end_at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false})+' น.\n'+
        '♨️ '+String(data.dryer?.name||dryer_code)+' '+new Date(data.dryer_booking.start_at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false})+'-'+new Date(data.dryer_booking.end_at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false})+' น.\n'+
        'ชุดจอง: '+String(data.combo_group_ref)+
        (data.home_service?.enabled?'\n🚚 รับ–ส่งถึงบ้าน +40 บาท':'')
      );
    }catch(e){console.error('Combo booking LINE alert failed:',e.message)}
    res.json({ok:true,...data});
  }catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

app.get('/api/bookings/:ref',async(req,res)=>{
  const {data,error}=await supabase.from('machine_bookings')
    .select('*,booking_machines(*)').eq('booking_ref',req.params.ref).single();
  if(error)return res.status(404).json({error:'ไม่พบรายการจอง'});
  res.json(data);
});

app.post('/api/bookings/:ref/cancel',async(req,res)=>{
  const {data,error}=await supabase.from('machine_bookings')
    .update({status:'CANCELLED'})
    .eq('booking_ref',req.params.ref)
    .eq('status','BOOKED')
    .select().single();
  if(error)return res.status(404).json({error:'ไม่พบรายการที่ยกเลิกได้'});
  res.json({ok:true,booking:data});
});

app.get('/api/admin/bookings',async(req,res)=>{
  const pin=String(req.headers['x-admin-pin']||'');
  const date=String(req.query.date||'');
  const useDate=/^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date(Date.now()+7*3600*1000).toISOString().slice(0,10);

  const {data,error}=await supabase.rpc('booking_list_queue_private',{
    p_date:useDate,
    p_pin:pin
  });
  if(error){
    const msg=String(error.message||'');
    if(msg.toLowerCase().includes('unauthorized')) return res.status(401).json({error:'PIN ไม่ถูกต้อง'});
    return res.status(500).json({error:msg});
  }
  res.json(data||[]);
});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

app.listen(PORT,()=>console.log('Sukloei booking listening on '+PORT));
