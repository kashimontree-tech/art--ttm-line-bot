const PDFDocument=require("pdfkit"),XLSX=require("xlsx");
module.exports=function(app,{auth,getThaiPdfFont,uploadSupabaseFile,saveFileMemory,createSupabaseSignedUrl}){
 app.post("/api/ttm-group/convert",auth,require("express").json({limit:"24mb"}),async(req,res)=>{
  try{
   const name=String(req.body?.name||"upload").split(/[\\/]/).pop().slice(0,160);
   const mime=String(req.body?.mime||""),target=String(req.body?.target||"");
   const raw=String(req.body?.base64||"");
   if(!/^[a-zA-Z0-9+/=]+$/.test(raw))return res.status(400).json({error:"Invalid upload"});
   const input=Buffer.from(raw,"base64");
   if(!input.length||input.length>14*1024*1024)return res.status(400).json({error:"File size must be under 14MB"});
   const isImage=/^image\/(png|jpeg)$/.test(mime),isExcel=/\.xlsx?$/i.test(name);
   if(target!=="pdf"||(!isImage&&!isExcel))return res.status(400).json({error:"Supported: image or Excel to PDF"});
   const outName=name.replace(/\.[^.]+$/,"")+".pdf";
   const output=await new Promise(async(resolve,reject)=>{
    try{
     const doc=new PDFDocument({autoFirstPage:false,margin:25}),chunks=[];
     doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);
     if(isImage){doc.addPage({size:"A4"});doc.image(input,25,25,{fit:[545,790]})}
     else{
      const wb=XLSX.read(input,{type:"buffer"}),font=await getThaiPdfFont();doc.registerFont("Thai",font);
      for(const sheet of wb.SheetNames){
       const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:"",raw:false,blankrows:true});
       const max=Math.max(1,...rows.map(r=>r.length));
       for(let offset=0;offset<max;offset+=6){
        const n=Math.min(6,max-offset),width=790/n;
        const page=()=>{doc.addPage({size:"A4",layout:"landscape",margin:25});doc.font("Thai").fontSize(11).text(sheet+" | "+(offset+1)+"-"+(offset+n));doc.moveDown(0.3)};
        page();
        for(const row of rows){
         const cells=Array.from({length:n},(_,i)=>String(row[offset+i]??""));
         const height=Math.max(20,...cells.map(c=>doc.font("Thai").fontSize(7).heightOfString(c||" ",{width:width-10})+9));
         if(height>480)throw Error("Very tall Excel cell; cancelled to avoid clipping");
         if(doc.y+height>565)page();
         const y=doc.y;
         cells.forEach((c,i)=>{const x=25+i*width;doc.rect(x,y,width,height).stroke();doc.font("Thai").fontSize(7).text(c,x+4,y+4,{width:width-8,height:height-8})});
         doc.y=y+height;
        }
       }
      }
     }
     doc.end();
    }catch(err){reject(err)}
   });
   const saved=await uploadSupabaseFile(output,"web:ttm-group","conversion",outName,"application/pdf");
   await saveFileMemory({scopeId:"web:ttm-group",userId:null,displayName:"TTM Group",source:{type:"web"},fileName:outName,lineMessageId:null,openaiFileId:null,mime:"application/pdf",summary:"Converted from "+name,storageBucket:saved.bucket,storagePath:saved.storagePath});
   const url=await createSupabaseSignedUrl(saved.bucket,saved.storagePath,3600);
   res.json({name:outName,url,notice:"Please compare all amounts, cells and layout against original before business use."});
  }catch(err){console.error("TTM Group conversion failed:",err);res.status(500).json({error:"แปลงไฟล์ไม่สำเร็จ: "+err.message})}
 });
};
