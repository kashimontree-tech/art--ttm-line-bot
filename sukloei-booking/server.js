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
