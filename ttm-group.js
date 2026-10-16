const crypto=require("crypto");
module.exports=function(app,{supabaseRequest,createSupabaseSignedUrl,getThaiPdfFont,uploadSupabaseFile,saveFileMemory}){
 const secret=process.env.TTM_GROUP_ADMIN_PIN||process.env.TTM_ALBUM_ADMIN_PIN;
 function auth(req,res,next){if(!secret)return res.status(503).json({error:"Admin PIN not configured"});const a=Buffer.from(String(req.get("x-admin-pin")||""));const b=Buffer.from(secret);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:"Invalid PIN"});next()}
 const express=require("express");
 const archiveAccess=req=>{const expected=String(process.env.TTM_ARCHIVE_PIN||"");const provided=String(req.get("x-archive-pin")||"");const a=Buffer.from(provided),b=Buffer.from(expected);return b.length>=4&&a.length===b.length&&crypto.timingSafeEqual(a,b)};
 function archiveAuth(req,res,next){if(!archiveAccess(req))return res.status(403).json({error:"ต้องกรอกรหัสคลังไฟล์และคลังภาพ"});next()}
 const groupPins=()=>{try{return JSON.parse(process.env.TTM_PHOTO_GROUP_PINS||"{}")}catch{return {}}};
 async function allowed(scope,provided){
  const registry=await supabaseRequest("ttm_group_registry?select=folder_pin&scope_id=eq."+encodeURIComponent(scope)+"&limit=1",{method:"GET"});
  const expected=registry?.[0]?.folder_pin||groupPins()[scope]||process.env.TTM_ARCHIVE_PIN;
  if(typeof expected!=="string"||expected.length<3)return false;
  const a=Buffer.from(String(provided||"")),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
 }
 const groupNames=new Map();
 async function groupName(scope){if(!scope.startsWith("group:"))return scope;const id=scope.slice(6);if(groupNames.has(id))return groupNames.get(id);try{const t=process.env.LINE_CHANNEL_ACCESS_TOKEN;if(!t)return scope;const r=await fetch("https://api.line.me/v2/bot/group/"+encodeURIComponent(id)+"/summary",{headers:{Authorization:"Bearer "+t}});if(!r.ok)return scope;const d=await r.json();const name=String(d.groupName||"").trim();if(name){groupNames.set(id,name);return name}}catch(e){console.error("Group name lookup:",e.message)}return scope}
 app.get("/api/ttm-group/photo-folders",auth,async(req,res)=>{try{const rows=await supabaseRequest("line_memories?select=scope_id,mime_type,storage_path&storage_path=not.is.null&order=created_at.desc&limit=1000",{method:"GET"});const counts=new Map();for(const f of rows||[])if(/^image\//i.test(f.mime_type||""))counts.set(f.scope_id,(counts.get(f.scope_id)||0)+1);const registered=await supabaseRequest("ttm_group_registry?select=scope_id,group_name",{method:"GET"});for(const g of registered||[])if(!counts.has(g.scope_id))counts.set(g.scope_id,0);const folders=[];for(const [scope,count] of counts){const g=(registered||[]).find(x=>x.scope_id===scope);folders.push({scope,name:g?.group_name||await groupName(scope),count})}res.set("Cache-Control","no-store").json({folders,limited:(rows||[]).length===1000})}catch(e){res.status(500).json({error:"Folder list unavailable"})}});
 app.post("/api/ttm-group/photos",auth,express.json({limit:"4kb"}),async(req,res)=>{const scope=String(req.body?.scope||"");if(!await allowed(scope,req.get("x-photo-pin")))return res.status(403).json({error:"รหัสของกลุ่มไม่ถูกต้อง หรือยังไม่ได้กำหนดรหัส"});try{const rows=await supabaseRequest("line_memories?select=id,file_name,mime_type,scope_id,created_at,storage_bucket,storage_path&scope_id=eq."+encodeURIComponent(scope)+"&storage_path=not.is.null&order=created_at.desc&limit=1000",{method:"GET"});res.set("Cache-Control","no-store").json({photos:(rows||[]).filter(x=>/^image\//i.test(x.mime_type||"")&&x.storage_bucket).map(x=>({id:x.id,name:x.file_name,date:x.created_at})),limited:(rows||[]).length===1000})}catch(e){res.status(500).json({error:"Could not list group photos"})}});
 app.get("/api/ttm-group/session",auth,(req,res)=>res.set("Cache-Control","no-store").json({ok:true}));
 app.get("/ttm-logo.webp",(req,res)=>res.type("image/webp").sendFile(require("path").join(__dirname,"ttm-logo.webp")));
 app.get("/ttm-convert-ui.js",(req,res)=>res.type("application/javascript").sendFile(require("path").join(__dirname,"ttm-convert-ui.js")));
 app.get("/ttm-files-ui.js",(req,res)=>res.set("Cache-Control","no-store").type("application/javascript").sendFile(require("path").join(__dirname,"ttm-files-ui.js")));
 app.get("/ttm-gallery.js",(req,res)=>res.set("Cache-Control","no-store").type("application/javascript").sendFile(require("path").join(__dirname,"ttm-gallery.js")));
 app.get("/ttm-notes-ui.js",(req,res)=>res.type("application/javascript").sendFile(require("path").join(__dirname,"ttm-notes-ui.js")));
 app.get("/ttm-manifest.webmanifest",(req,res)=>res.type("application/manifest+json").set("Cache-Control","no-cache").send(JSON.stringify({name:"ART TTM Group",short_name:"ART TTM",start_url:"/ttm-group",scope:"/",display:"standalone",background_color:"#f4f7f5",theme_color:"#126148",icons:[{src:"/ttm-logo.webp",sizes:"any",type:"image/webp",purpose:"any"}]})));
 app.get("/ttm-sw.js",(req,res)=>res.type("application/javascript").set("Cache-Control","no-cache").send("self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});"));
 app.get("/ttm-group",(req,res)=>res.set("Cache-Control","no-store").sendFile(require("path").join(__dirname,"ttm-group.html")));
 app.get("/api/ttm-group/file-folders",auth,async(req,res)=>{try{const rows=await supabaseRequest("line_memories?select=scope_id,mime_type,storage_path&storage_path=not.is.null&order=created_at.desc&limit=1000",{method:"GET"});const counts=new Map();for(const f of rows||[]){const scope=String(f.scope_id||"");if(!scope.startsWith("group:"))continue;if(!counts.has(scope))counts.set(scope,0);if(!/^image\//i.test(f.mime_type||""))counts.set(scope,counts.get(scope)+1)}const registered=await supabaseRequest("ttm_group_registry?select=scope_id,group_name",{method:"GET"});for(const g of registered||[])if(!counts.has(g.scope_id))counts.set(g.scope_id,0);const folders=[];for(const [scope,count] of counts){const g=(registered||[]).find(x=>x.scope_id===scope);folders.push({scope,name:g?.group_name||await groupName(scope),count})}res.set("Cache-Control","no-store").json({folders,limited:(rows||[]).length===1000})}catch(e){res.status(500).json({error:"Cannot list file folders"})}});
 app.post("/api/ttm-group/folder-files",auth,express.json({limit:"4kb"}),async(req,res)=>{const scope=String(req.body?.scope||"");if(!await allowed(scope,req.get("x-archive-pin")))return res.status(403).json({error:"รหัสโฟลเดอร์ไม่ถูกต้อง"});try{const rows=await supabaseRequest("line_memories?select=id,file_name,mime_type,scope_id,created_at,storage_bucket,storage_path&scope_id=eq."+encodeURIComponent(scope)+"&storage_path=not.is.null&order=created_at.desc&limit=1000",{method:"GET"});res.set("Cache-Control","no-store").json({files:(rows||[]).filter(f=>f.file_name&&f.storage_bucket&&f.storage_path&&!/^image\//i.test(f.mime_type||"")).map(f=>({id:f.id,name:f.file_name,type:f.mime_type,group:f.scope_id,date:f.created_at})),limited:(rows||[]).length===1000})}catch(e){res.status(500).json({error:"Cannot list group files"})}});
 // Import files manually exported from LINE Notes (LINE has no Notes read API).
 app.post("/api/ttm-group/import-notes",auth,express.json({limit:"19mb"}),async(req,res)=>{
  try{
   const scope=String(req.body?.scope||"");
   const pass=String(req.get("x-archive-pin")||"");
   if(!/^group:C[a-f0-9]{32}$/i.test(scope))return res.status(400).json({error:"เลือก LINE กลุ่มที่ถูกต้อง"});
   if(!await allowed(scope,pass))return res.status(403).json({error:"รหัสเข้าคลังของกลุ่มไม่ถูกต้อง"});
   const raw=String(req.body?.base64||"");
   if(!raw||raw.length>17*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))return res.status(400).json({error:"ข้อมูลไฟล์ไม่ถูกต้องหรือมีขนาดเกินกำหนด"});
   const bytes=Buffer.from(raw,"base64");
   if(!bytes.length||bytes.length>12*1024*1024)return res.status(413).json({error:"รองรับไฟล์ไม่เกิน 12 MB ต่อไฟล์"});
   const name=String(req.body?.name||"").replace(/[\\/\x00-\x1f]/g,"_").trim().slice(0,160);
   if(!name||name==="."||name==="..")return res.status(400).json({error:"ต้องระบุชื่อไฟล์"});
   const ext=name.split(".").pop().toLowerCase();
   const types={pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",doc:"application/msword",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",xls:"application/vnd.ms-excel",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",ppt:"application/vnd.ms-powerpoint",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",heic:"image/heic",txt:"text/plain",csv:"text/csv",zip:"application/zip"};
   if(!types[ext])return res.status(415).json({error:"ประเภทไฟล์นี้ยังไม่รองรับ"});
   const mime=types[ext];
   const kind=/^image\\//i.test(mime)?"photo":"file";
   const albumId=String(req.body?.albumId||"");
   if(albumId){
    if(!/^[a-f0-9-]{36}$/i.test(albumId))return res.status(400).json({error:"รหัสอัลบั้มไม่ถูกต้อง"});
    const matching=await supabaseRequest("ttm_group_albums?select=id&scope_id=eq."+encodeURIComponent(scope)+"&kind=eq."+kind+"&id=eq."+albumId+"&limit=1",{method:"GET"});
    if(!matching?.length)return res.status(400).json({error:"อัลบั้มไม่อยู่ในกลุ่มหรือประเภทไฟล์นี้"});
   }
   const saved=await uploadSupabaseFile(bytes,scope,crypto.randomUUID(),name,mime);
   await saveFileMemory({scopeId:scope,userId:null,displayName:"TTM Notes Import",source:{type:"group",groupId:scope.slice(6)},fileName:name,lineMessageId:null,openaiFileId:null,mime,summary:"นำเข้าจาก LINE Notes ผ่าน TTM Group โดยผู้ดูแล",storageBucket:saved.bucket,storagePath:saved.storagePath});
   let albumSaved=!albumId;
   if(albumId){
    try{
     const rows=await supabaseRequest("line_memories?select=id&scope_id=eq."+encodeURIComponent(scope)+"&storage_path=eq."+encodeURIComponent(saved.storagePath)+"&limit=1",{method:"GET"});
     const fileId=rows?.[0]?.id;
     if(!fileId)throw new Error("Saved file memory record not found");
     await supabaseRequest("ttm_group_album_items?on_conflict=album_id,file_id",{method:"POST",prefer:"resolution=ignore-duplicates,return=minimal",body:JSON.stringify([{album_id:albumId,scope_id:scope,file_id:fileId}])});
     albumSaved=true;
    }catch(albumError){console.error("LINE Notes album assignment failed:",albumError)}
   }
   res.set("Cache-Control","no-store").json({ok:true,name,size:bytes.length,albumSaved,warning:albumSaved?null:"ไฟล์อยู่ในคลังตามวันที่แล้ว แต่เพิ่มลงอัลบั้มไม่สำเร็จ กรุณาเปิดคลังเพื่อจัดเข้าอัลบั้ม"});
  }catch(err){console.error("LINE Notes import failed:",err);res.status(500).json({error:"บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่หรือตรวจสอบพื้นที่จัดเก็บ"})}
 });

 // Named album management is scoped to the authenticated LINE group; original media remains in storage.
 app.post("/api/ttm-group/albums/list",auth,express.json({limit:"4kb"}),async(req,res)=>{
  try {
   const scope=String(req.body?.scope||""),kind=String(req.body?.kind||"");
   if(!/^group:C[a-f0-9]{32}$/i.test(scope)||!["photo","file"].includes(kind))return res.sendStatus(400);
   if(!await allowed(scope,req.get("x-archive-pin")))return res.sendStatus(403);
   const albums=await supabaseRequest("ttm_group_albums?select=id,name,created_at&scope_id=eq."+encodeURIComponent(scope)+"&kind=eq."+kind+"&order=created_at.desc",{method:"GET"});
   const links=await supabaseRequest("ttm_group_album_items?select=album_id,file_id&scope_id=eq."+encodeURIComponent(scope),{method:"GET"});
   res.set("Cache-Control","no-store").json({albums:(albums||[]).map(a=>({...a,fileIds:(links||[]).filter(x=>x.album_id===a.id).map(x=>x.file_id)}))});
  }catch(e){console.error("List group albums:",e);res.status(500).json({error:"ไม่สามารถโหลดอัลบั้มได้"})}
 });
 app.post("/api/ttm-group/albums/create",auth,express.json({limit:"4kb"}),async(req,res)=>{
  try{
   const scope=String(req.body?.scope||""),kind=String(req.body?.kind||""),name=String(req.body?.name||"").trim();
   if(!/^group:C[a-f0-9]{32}$/i.test(scope)||!["photo","file"].includes(kind)||!name||name.length>100)return res.sendStatus(400);
   if(!await allowed(scope,req.get("x-archive-pin")))return res.sendStatus(403);
   const result=await supabaseRequest("ttm_group_albums?on_conflict=scope_id,kind,name",{method:"POST",prefer:"resolution=ignore-duplicates,return=representation",body:JSON.stringify([{scope_id:scope,kind,name}])});
   res.set("Cache-Control","no-store").json({ok:true,created:!!result?.length});
  }catch(e){console.error("Create group album:",e);res.status(500).json({error:"สร้างอัลบั้มไม่สำเร็จ"})}
 });
 app.post("/api/ttm-group/albums/add",auth,express.json({limit:"4kb"}),async(req,res)=>{
  try{
   const scope=String(req.body?.scope||""),kind=String(req.body?.kind||""),albumId=String(req.body?.albumId||""),fileId=String(req.body?.fileId||"");
   if(!/^group:C[a-f0-9]{32}$/i.test(scope)||!["photo","file"].includes(kind)||![albumId,fileId].every(x=>/^[a-f0-9-]{36}$/i.test(x)))return res.sendStatus(400);
   if(!await allowed(scope,req.get("x-archive-pin")))return res.sendStatus(403);
   const albums=await supabaseRequest("ttm_group_albums?select=id&scope_id=eq."+encodeURIComponent(scope)+"&kind=eq."+kind+"&id=eq."+albumId,{method:"GET"});
   const found=await supabaseRequest("line_memories?select=id,mime_type,storage_path&scope_id=eq."+encodeURIComponent(scope)+"&id=eq."+fileId+"&limit=1",{method:"GET"});
   if(!albums?.length||!found?.[0]?.storage_path||(/^image\\//i.test(found[0].mime_type||"")!==(kind==="photo")))return res.sendStatus(404);
   await supabaseRequest("ttm_group_album_items?on_conflict=album_id,file_id",{method:"POST",prefer:"resolution=ignore-duplicates,return=minimal",body:JSON.stringify([{album_id:albumId,scope_id:scope,file_id:fileId}])});
   res.set("Cache-Control","no-store").json({ok:true});
  }catch(e){console.error("Add to group album:",e);res.status(500).json({error:"เพิ่มลงอัลบั้มไม่สำเร็จ"})}
 });
 app.get("/api/ttm-group/files",auth,(req,res)=>res.status(410).json({error:"โปรดเปิดผ่านโฟลเดอร์ LINE กลุ่ม"}));
 app.get("/api/ttm-group/file/:id",auth,async(req,res)=>{try{if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.sendStatus(400);const rows=await supabaseRequest("line_memories?select=file_name,mime_type,scope_id,storage_bucket,storage_path&id=eq."+encodeURIComponent(req.params.id)+"&limit=1",{method:"GET"});const f=rows?.[0];if(!f?.storage_bucket||!f?.storage_path)return res.sendStatus(404);if(/^image\//i.test(f.mime_type||"")){if(!await allowed(f.scope_id,req.get("x-photo-pin")))return res.status(403).json({error:"Group photo password required"})}else if(!await allowed(f.scope_id,req.get("x-archive-pin")))return res.status(403).json({error:"Group file password required"});const url=await createSupabaseSignedUrl(f.storage_bucket,f.storage_path,3600);res.set("Cache-Control","no-store").json({url,name:f.file_name})}catch(e){res.status(500).json({error:"Download unavailable"})}});
 require("./ttm-convert")(app,{auth,getThaiPdfFont,uploadSupabaseFile,saveFileMemory,createSupabaseSignedUrl});
 app.post("/api/ttm-group/photo-links",auth,require("express").json({limit:"16kb"}),async(req,res)=>{try{const ids=Array.isArray(req.body?.ids)?req.body.ids.slice(0,24):[];if(!ids.length||ids.some(x=>typeof x!=="string"||!/^[a-f0-9-]{36}$/i.test(x)))return res.status(400).json({error:"Invalid photo IDs"});const rows=await supabaseRequest("line_memories?select=id,file_name,mime_type,scope_id,storage_bucket,storage_path&id=in.("+ids.join(",")+")",{method:"GET"});const items=[];for(const x of rows||[]){if(!/^image\//i.test(x.mime_type||"")||!x.storage_bucket||!x.storage_path||!await allowed(x.scope_id,req.get("x-photo-pin")))continue;try{items.push({id:x.id,url:await createSupabaseSignedUrl(x.storage_bucket,x.storage_path,3600),name:x.file_name})}catch(e){console.error("Photo sign:",e.message)}}res.set("Cache-Control","no-store").json({items})}catch(e){res.status(500).json({error:"Unable to load images"})}});
};
