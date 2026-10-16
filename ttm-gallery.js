(function(){
const $=id=>document.getElementById(id);
let active=null,photoPin="",requestSeq=0,photos=[],selectedDay=null,selectedAlbum=null,albums=[];
async function post(url,data,pass){
 const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":pass,"x-photo-pin":pass},body:JSON.stringify(data),cache:"no-store"});
 const out=await r.json();if(!r.ok)throw Error(out.error||"ไม่สามารถเปิดโฟลเดอร์ได้");return out;
}
async function showFolders(){
 const generation=++requestSeq;
 active=null;photoPin="";photos=[];selectedDay=null;selectedAlbum=null;albums=[];
 $("photoGallery").replaceChildren();$("photoFolders").replaceChildren();
 $("photoCount").textContent="กำลังโหลดโฟลเดอร์...";$("photoMessage").textContent="";
 try{
  const result=await api("/api/ttm-group/photo-folders");
  if(generation!==requestSeq)return; // Discard older simultaneous requests.
  const unique=[...new Map((result.folders||[])
   .filter(f=>String(f.scope||"").startsWith("group:"))
   .map(f=>[f.scope,f])).values()];
  const container=$("photoFolders");
  const fragment=document.createDocumentFragment();
  for(const folder of unique){
   const b=document.createElement("button");
   b.textContent="📁 "+folder.name+" ("+folder.count+" รูป)";
   b.onclick=async()=>{
    const code=await window.ttmAsk("กรอกรหัสผ่านเพื่อเปิดโฟลเดอร์ "+folder.name,{secret:true});
    if(code)await openFolder(folder,code);
   };
   fragment.append(b);
  }
  if(generation!==requestSeq)return;
  container.replaceChildren(fragment);
  $("photoCount").textContent=unique.length+" โฟลเดอร์จาก LINE";
  $("photoMessage").textContent="เลือก LINE กลุ่ม แล้วใส่รหัส เพื่อสร้างอัลบั้มใหม่ได้";
 }catch(err){if(generation===requestSeq)$("photoMessage").textContent=err.message}
}
async function openFolder(folder,pass){
 try{
  const r=await post("/api/ttm-group/photos",{scope:folder.scope},pass);
  active=folder;photoPin=pass;photos=r.photos||[];selectedDay=null;selectedAlbum=null;albums=[];
  try{await loadAlbums()}catch(albumError){console.warn("Albums optional:",albumError);$("photoMessage").textContent="เข้าคลังภาพได้ แต่อัลบั้มยังโหลดไม่สำเร็จ";}
  $("photoFolders").replaceChildren();
  const back=document.createElement("button");back.textContent="← กลับไปโฟลเดอร์";back.onclick=()=>{if(selectedDay!==null||selectedAlbum!==null){selectedDay=null;selectedAlbum=null;renderPhotos()}else showFolders()};$("photoFolders").append(back);
  $("photoCount").textContent=folder.name+" • "+photos.length+" ภาพ";
  await renderPhotos();
 }catch(err){
  $("photoMessage").textContent="เปิดคลังไม่สำเร็จ: "+err.message;
  console.error("Gallery folder open failure",err);
 }
}
async function loadAlbums(){
 if(!active)return;
 const r=await post("/api/ttm-group/albums/list",{scope:active.scope,kind:"photo"},photoPin);
 albums=r.albums||[];
}
async function createAlbum(){
 const name=await window.ttmAsk("ชื่ออัลบั้มใหม่ในกลุ่ม "+active.name);
 if(!name||!name.trim())return;
 try{await post("/api/ttm-group/albums/create",{scope:active.scope,kind:"photo",name:name.trim()},photoPin);await loadAlbums();selectedDay=null;selectedAlbum=null;renderPhotos()}
 catch(err){alert("สร้างอัลบั้มไม่ได้: "+err.message)}
}
async function addToAlbum(item){
 if(!albums.length){alert("กรุณาสร้างอัลบั้มก่อน");return}
 const options=albums.map((a,i)=>(i+1)+". "+a.name).join("\n");
 const choice=await window.ttmAsk("เลือกเลขอัลบั้มที่จะเพิ่มรูปนี้ (ไม่ลบจากวันที่)\n"+options);
 if(choice===null)return;
 const i=Number(choice)-1;
 if(!Number.isInteger(i)||i<0||i>=albums.length){alert("หมายเลขอัลบั้มไม่ถูกต้อง");return}
 try{await post("/api/ttm-group/albums/add",{scope:active.scope,kind:"photo",albumId:albums[i].id,fileId:item.id},photoPin);await loadAlbums();$("photoMessage").textContent="เพิ่มภาพลงอัลบั้ม "+albums[i].name+" แล้ว ✅";if(selectedAlbum)renderPhotos()}
 catch(err){alert("เพิ่มอัลบั้มไม่สำเร็จ: "+err.message)}
}
async function renderPhotos(){
 if(!active)return;
 const q=$("photoSearch").value.toLocaleLowerCase().trim();
 const items=photos.filter(x=>(String(x.name||"")+" "+ttmDay(x.date)+" "+ttmDayLabel(ttmDay(x.date))).toLocaleLowerCase().includes(q));
 const gen=++requestSeq,container=$("photoGallery");container.replaceChildren();
 const back=$("photoFolders").querySelector("button");
 if(back)back.textContent=selectedDay===null&&selectedAlbum===null?"← กลับไป LINE กลุ่ม":"← กลับไปโฟลเดอร์";
 const days=[...new Set(items.map(x=>ttmDay(x.date)))].sort((a,b)=>b.localeCompare(a));
 if(selectedDay!==null&&!days.includes(selectedDay))selectedDay=null;
 if(selectedDay===null&&selectedAlbum===null){
  const create=document.createElement("button");create.textContent="＋ สร้างอัลบั้ม";create.onclick=createAlbum;container.append(create);
  for(const album of albums){const n=album.fileIds.length,b=document.createElement("button");b.className="date-folder";b.textContent="📁 "+album.name+" ("+n+" ภาพ)";b.onclick=()=>{selectedAlbum=album.id;selectedDay=null;renderPhotos()};container.append(b)}
  $("photoCount").textContent=active.name+" • "+days.length+" วันที่ • "+items.length+" ภาพ";
  $("photoMessage").textContent="เลือกโฟลเดอร์วันที่เพื่อดูภาพ";
  for(const day of days){const n=items.filter(x=>ttmDay(x.date)===day).length;
   const b=document.createElement("button");b.className="date-folder";b.textContent="📅 "+ttmDayLabel(day)+" ("+n+" ภาพ)";
   b.onclick=()=>{selectedDay=day;renderPhotos()};container.append(b)}
  return;
 }
 const visible=selectedAlbum!==null?items.filter(x=>albums.find(a=>a.id===selectedAlbum)?.fileIds.includes(x.id)):items.filter(x=>ttmDay(x.date)===selectedDay);
 $("photoCount").textContent=active.name+" / "+(selectedAlbum!==null?(albums.find(a=>a.id===selectedAlbum)?.name||"อัลบั้ม"):ttmDayLabel(selectedDay));
 $("photoMessage").textContent=visible.length+" ภาพในวันที่เลือก";
 for(const item of visible){
  const box=document.createElement("div");box.className="photo";
  const im=document.createElement("img");im.loading="lazy";im.alt=item.name||"รูปภาพ LINE";
  const label=document.createElement("div");label.className="small";label.textContent=item.name||"ไม่ระบุชื่อ";
  const btn=document.createElement("button");btn.textContent="ดู / ดาวน์โหลด";
  btn.onclick=async()=>{const tab=window.open("about:blank","_blank");try{const r=await fetch("/api/ttm-group/file/"+encodeURIComponent(item.id),{headers:{"x-admin-pin":pin,"x-archive-pin":archivePin,"x-photo-pin":photoPin},cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"เปิดภาพไม่ได้");if(tab){tab.opener=null;tab.location.replace(d.url)}else{const a=document.createElement("a");a.href=d.url;a.target="_blank";a.rel="noopener";document.body.append(a);a.click();a.remove()}}catch(err){if(tab)tab.close();alert(err.message)}};
  const add=document.createElement("button");add.textContent="＋ เพิ่มเข้าอัลบั้ม";add.onclick=()=>addToAlbum(item);box.append(im,label,btn,add);container.append(box);item._preview=im;
 }
 for(let start=0;start<visible.length;start+=24){
  if(gen!==requestSeq)return;
  const batch=visible.slice(start,start+24);
  try{
   const result=await post("/api/ttm-group/photo-links",{ids:batch.map(x=>x.id)},photoPin);
   if(gen!==requestSeq)return;
   for(const p of result.items||[]){const original=batch.find(x=>x.id===p.id);if(original?._preview)original._preview.src=p.url}
  }catch(err){$("photoMessage").textContent="บางภาพโหลดตัวอย่างไม่สำเร็จ: "+err.message}
 }
}
$("photoSearch").addEventListener("input",renderPhotos);
const orig=window.tab;window.tab=function(id){orig(id);if(id==="photos")showFolders()};
})();