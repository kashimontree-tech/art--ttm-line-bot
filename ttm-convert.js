const PDFDocument=require("pdfkit"),XLSX=require("xlsx");
const fs=require("fs/promises"),os=require("os"),path=require("path"),{execFile}=require("child_process"),{promisify}=require("util");
const run=promisify(execFile);
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
   let output;
   if(isExcel){
     const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ttmconv-"));
     try{
       const ext=path.extname(name).toLowerCase();const src=path.join(tmp,"original"+ext);
       await fs.writeFile(src,input);
       try{await run("libreoffice",["-env:UserInstallation=file://"+path.join(tmp,"lo-profile"),"--headless","--convert-to","pdf:calc_pdf_Export","--outdir",tmp,src],{timeout:90000,maxBuffer:1024*1024})}
       catch(e){throw Error("ยังไม่มีเครื่องมือแปลง Excel แบบรักษารูปแบบติดตั้งบนเซิร์ฟเวอร์ จึงหยุดแปลงเพื่อไม่ให้เอกสารผิดต้นฉบับ")}
       output=await fs.readFile(path.join(tmp,"original.pdf"));
       if(output.length<100||output.subarray(0,4).toString()!=="%PDF")throw Error("PDF output validation failed");
     }finally{await fs.rm(tmp,{recursive:true,force:true})}
   }else{
     output=await new Promise((resolve,reject)=>{
       try{
         const doc=new PDFDocument({autoFirstPage:false,margin:25}),chunks=[];
         doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);
         doc.addPage({size:"A4"});doc.image(input,25,25,{fit:[545,790]});doc.end();
       }catch(e){reject(e)}
     });
   }
   const saved=await uploadSupabaseFile(output,"web:ttm-group","conversion",outName,"application/pdf");
   await saveFileMemory({scopeId:"web:ttm-group",userId:null,displayName:"TTM Group",source:{type:"web"},fileName:outName,lineMessageId:null,openaiFileId:null,mime:"application/pdf",summary:"Converted from "+name,storageBucket:saved.bucket,storagePath:saved.storagePath});
   const url=await createSupabaseSignedUrl(saved.bucket,saved.storagePath,3600);
   res.json({name:outName,url,notice:"Please compare all amounts, cells and layout against original before business use."});
  }catch(err){console.error("TTM Group conversion failed:",err);res.status(500).json({error:"แปลงไฟล์ไม่สำเร็จ: "+err.message})}
 });
};
