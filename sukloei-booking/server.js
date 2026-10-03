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

app.use(express.static(path.join(__dirname,'public')));

function bangkokIso(dateStr,timeStr){
  return new Date(`${dateStr}T${timeStr}:00+07:00`).toISOString();
}

app.get('/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.get('/api/machines',async(req,res)=>{
  const {data,error}=await supabase.from('booking_machines')
    .select('*').eq('active',true).order('machine_type').order('capacity_kg').order('machine_code');
  if(error)return res.status(500).json({error:error.message});
  res.json(data);
});

app.get('/api/availability',async(req,res)=>{
  try{
    const date=String(req.query.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'invalid date'});

    const start=new Date(date+'T00:00:00+07:00').toISOString();
    const end=new Date(new Date(date+'T00:00:00+07:00').getTime()+24*60*60*1000).toISOString();

    const [{data:machines,error:mErr},{data:bookings,error:bErr}]=await Promise.all([
      supabase.from('booking_machines').select('*').eq('active',true).order('machine_type').order('capacity_kg').order('machine_code'),
      supabase.from('machine_bookings').select('*')
        .lt('start_at',end).gt('end_at',start).eq('status','BOOKED')
    ]);
    if(mErr)throw mErr;if(bErr)throw bErr;

    res.json({
      date,
      machines:machines.map(m=>({
        ...m,
        bookings:bookings.filter(b=>b.machine_code===m.machine_code)
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
    if(home_service && !String(home_address).trim())
      return res.status(400).json({error:'กรุณากรอกที่อยู่สำหรับรับ-ส่ง'});
    if(home_service && !within_5km_confirmed)
      return res.status(400).json({error:'กรุณายืนยันว่าที่อยู่ในรัศมี 5 กม.'});

    const {data:machine,error:mErr}=await supabase.from('booking_machines')
      .select('*').eq('machine_code',machine_code).eq('active',true).single();
    if(mErr||!machine)return res.status(404).json({error:'ไม่พบเครื่อง'});

    const startAt=bangkokIso(date,time);
    const startDate=new Date(startAt);
    if(Number.isNaN(startDate.getTime()))return res.status(400).json({error:'วันเวลาผิด'});
    const serviceMinutes=Number(machine.service_minutes||machine.duration_minutes||40);
    const bufferMinutes=Number(machine.buffer_minutes||10);
    const reservedMinutes=serviceMinutes+bufferMinutes;
    const endAt=new Date(startDate.getTime()+reservedMinutes*60000).toISOString();

    const {data:conflicts,error:cErr}=await supabase.from('machine_bookings')
      .select('id,booking_ref,start_at,end_at')
      .eq('machine_code',machine_code)
      .eq('status','BOOKED')
      .lt('start_at',endAt)
      .gt('end_at',startAt);
    if(cErr)throw cErr;
    if(conflicts?.length)return res.status(409).json({error:'ช่วงเวลานี้มีคนจองแล้ว'});

    const ref='BK-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
    const {data,error}=await supabase.from('machine_bookings').insert({
      booking_ref:ref,
      machine_code,
      customer_name:String(customer_name).trim().slice(0,100),
      customer_phone:String(customer_phone).trim().slice(0,30),
      start_at:startAt,
      end_at:endAt,
      note:String(note||'').trim().slice(0,300),
      home_service:Boolean(home_service),
      home_address:home_service?String(home_address).trim().slice(0,500):null,
      home_service_fee:home_service?40:0,
      within_5km_confirmed:home_service?Boolean(within_5km_confirmed):false
    }).select().single();
    if(error)throw error;

    res.json({
      ok:true,
      booking:data,
      machine,
      home_service:{
        enabled:Boolean(home_service),
        fee_baht:home_service?40:0,
        radius_km:5
      },
      reservation:{
        service_minutes:serviceMinutes,
        buffer_minutes:bufferMinutes,
        reserved_minutes:reservedMinutes
      }
    });
  }catch(e){res.status(500).json({error:e.message})}
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
  const date=String(req.query.date||'');
  let q=supabase.from('machine_bookings').select('*,booking_machines(*)').order('start_at',{ascending:true});
  if(/^\d{4}-\d{2}-\d{2}$/.test(date)){
    q=q.gte('start_at',new Date(date+'T00:00:00+07:00').toISOString())
       .lte('start_at',new Date(date+'T23:59:59+07:00').toISOString());
  }else{
    q=q.gte('start_at',new Date(Date.now()-24*3600*1000).toISOString()).limit(200);
  }
  const {data,error}=await q;
  if(error)return res.status(500).json({error:error.message});
  res.json(data);
});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

app.listen(PORT,()=>console.log('Sukloei booking listening on '+PORT));
