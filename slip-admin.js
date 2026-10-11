const crypto=require("crypto");
const XLSX=require("xlsx");
const PDFDocument=require("pdfkit");
function setupSlipAdmin(app,{supabaseRequest,createSupabaseSignedUrl,getThaiPdfFont}) {
 const adminPin=process.env.TTM_ALBUM_ADMIN_PIN;
 function auth(req,res,next) {
  if(!adminPin) return res.status(503).json({error:"Administrator PIN not configured"});
  const a=Buffer.from(String(req.get("x-admin-pin")||"")),b=Buffer.from(adminPin);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:"Incorrect PIN"});
  next();
 }
 app.get("/slip-admin",(req,res)=>res.redirect("/slip-admin.html"));
 app.get("/api/slip-admin/albums",auth,async(req,res)=>{
  try {
   const rows=await supabaseRequest("line_memories?select=id,file_name,mime_type,metadata,storage_bucket,storage_path,created_at,scope_id&order=created_at.desc&limit=1000",{method:"GET"});
   const entries=(rows||[]).filter(x=>/^image\/(jpeg|png)$/i.test(x.mime_type||"")&&x.storage_path);
   const albums=[...new Set(entries.map(x=>x.metadata?.album_name||"ยังไม่จัดอัลบั้ม"))];
   const chosen=String(req.query.album||"");
   const response=[];
   for(const x of entries.filter(x=>!chosen||(x.metadata?.album_name||"ยังไม่จัดอัลบั้ม")===chosen)){
    const meta=x.metadata||{};
    let url=null;
    try{url=await createSupabaseSignedUrl(x.storage_bucket,x.storage_path,3600)}catch(e){console.error("Slip thumbnail signing:",e.message)}
    response.push({id:x.id,name:x.file_name,album:meta.album_name||"ยังไม่จัดอัลบั้ม",amount:Number.isFinite(Number(meta.checked_amount))&&meta.checked_amount!==undefined&&meta.checked_amount!==null?Number(meta.checked_amount):null,reference:meta.slip_reference||"",status:meta.slip_status||"pending",date:meta.slip_date||"",url,created_at:x.created_at});
   }
   res.json({albums,items:response});
  }catch(e){res.status(500).json({error:e.message})}
 });
 app.use("/api/slip-admin",require("express").json({limit:"30kb"}));
 app.patch("/api/slip-admin/items/:id",auth,async(req,res)=>{
  try{
   const id=String(req.params.id);
   if(!/^[a-f0-9-]{36}$/i.test(id))return res.status(400).json({error:"Invalid ID"});
   const rows=await supabaseRequest("line_memories?select=id,metadata&id=eq."+encodeURIComponent(id)+"&limit=1",{method:"GET"});
   if(!rows?.length)return res.status(404).json({error:"Image not found"});
   const old=rows[0].metadata||{},b=req.body||{},meta={...old};
   if(typeof b.album==="string")meta.album_name=b.album.trim().slice(0,80)||null;
   if(typeof b.reference==="string")meta.slip_reference=b.reference.trim().slice(0,100);
   if(typeof b.date==="string")meta.slip_date=b.date.trim().slice(0,32);
   if(b.amount!==undefined) {
    if(b.amount===null||b.amount==="")meta.checked_amount=null;
    else if(Number.isFinite(Number(b.amount))&&Number(b.amount)>=0&&Number(b.amount)<=1e10)meta.checked_amount=Number(b.amount);
    else return res.status(400).json({error:"Invalid amount"});
   }
   if(b.status!==undefined){
    if(!["pending","verified","duplicate","excluded"].includes(b.status))return res.status(400).json({error:"Invalid status"});
    meta.slip_status=b.status;
   }
   await supabaseRequest("line_memories?id=eq."+encodeURIComponent(id),{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({metadata:meta})});
   res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message})}
 });
 app.get("/api/slip-admin/export",auth,async(req,res)=>{
  try {
   const album=String(req.query.album||"");if(!album)return res.status(400).json({error:"Select album"});
   const all=await supabaseRequest("line_memories?select=id,file_name,mime_type,metadata,created_at,storage_bucket,storage_path&order=created_at.asc&limit=1000",{method:"GET"});
   const rows=(all||[]).filter(x=>/^image\/(jpeg|png)$/i.test(x.mime_type||"")&&x.metadata?.album_name===album);
   const unique=[...new Map(rows.map(x=>[x.storage_path,x])).values()];
   const refs=new Set();
   for(const x of unique){
    const ref=String(x.metadata?.slip_reference||"").trim();
    if(ref&&refs.has(ref)&&x.metadata.slip_status==="verified")return res.status(409).json({error:"Duplicate reference among verified slips: "+ref});
    if(ref&&x.metadata?.slip_status==="verified")refs.add(ref);
   }
   const verified=unique.filter(x=>x.metadata?.slip_status==="verified"&&typeof x.metadata?.checked_amount==="number");
   const total=verified.reduce((s,x)=>s+x.metadata.checked_amount,0);
   const headers=["File","Reference","Date","Amount THB","Status","Album","Recorded at"];
   const data=[headers,...unique.map(x=>[x.file_name,x.metadata?.slip_reference||"",x.metadata?.slip_date||"",x.metadata?.checked_amount??"",x.metadata?.slip_status||"pending",album,x.created_at]),["TOTAL VERIFIED","","",total,"Not including pending / excluded / duplicates"]];
   const stamp=new Date().toISOString().slice(0,10);
   if(req.query.format==="xlsx"){
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),"Slips");
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition",`attachment; filename="slips-${stamp}.xlsx"`);
    return res.send(Buffer.from(XLSX.write(wb,{type:"buffer",bookType:"xlsx"})));
   }
   const font=await getThaiPdfFont();
   const doc=new PDFDocument({size:"A4",margin:35});doc.registerFont("Thai",font);const chunks=[];
   doc.on("data",c=>chunks.push(c));
   doc.on("end",()=>{res.type("application/pdf");res.set("Content-Disposition",`attachment; filename="slips-${stamp}.pdf"`);res.send(Buffer.concat(chunks))});
   doc.font("Thai").fontSize(16).text("TTM Slip Album - "+album);
   doc.moveDown().fontSize(11).text("Verified total: "+total.toLocaleString("en-US",{minimumFractionDigits:2})+" THB");
   doc.text("Count: "+unique.length+" | Verified: "+verified.length+" | Needs review: "+(unique.length-verified.length));
   doc.moveDown();for(let i=0;i<unique.length;i++){
    const x=unique[i],m=x.metadata||{};
    doc.fontSize(9).text(`${i+1}. ${x.file_name}  |  ${m.slip_status||"pending"}  |  ${m.checked_amount??"unchecked"} THB`);
    if(doc.y>doc.page.height-60)doc.addPage();
   }
   doc.end();
  }catch(e){res.status(500).json({error:e.message})}
 });
}
module.exports={setupSlipAdmin};
