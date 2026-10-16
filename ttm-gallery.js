(function(){
const $=id=>document.getElementById(id);
let active=null,photoPin="",requestSeq=0,photos=[],selectedDay=null;
async function post(url,data,pass){
 const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":archivePin,"x-photo-pin":pass},body:JSON.stringify(data),cache:"no-store"});
 const out=await r.json();if(!r.ok)throw Error(out.error||"ไม่สามารถเปิดโฟลเดอร์ได้");return out;
}
async function showFolders(){
 active=null;photoPin="";photos=[];selectedDay=null;requestSeq++;
 $("photoGallery").replaceChildren();$("photoFolders").replaceChildren();
 $("photoCount").textContent="กำลังโหลดโฟลเดอร์...";$("photoMessage").textContent="";
 try{
  const result=await api("/api/ttm-group/photo-folders");
  const folders=result.folders||[];
  $("photoCount").textContent=folders.length+" โฟลเดอร์จาก LINE";
  for(const folder of folders){
   const b=document.createElement("button");b.textContent="📁 "+folder.name+" ("+folder.count+" รูป)";
   b.onclick=()=>{const code=window.prompt("กรอกรหัสผ่านเพื่อเปิดโฟลเดอร์ "+folder.name);if(code!==null&&code.trim())openFolder(folder,code.trim())};$("photoFolders").append(b);
  }
  $("photoMessage").textContent="เลือกโฟลเดอร์ที่ต้องการดูรูป";
 }catch(err){$("photoMessage").textContent=err.message}
}
async function openFolder(folder,pass){
 try{
  const r=await post("/api/ttm-group/photos",{scope:folder.scope},pass);
  active=folder;photoPin=pass;photos=r.photos||[];selectedDay=null;
  $("photoFolders").replaceChildren();
  const back=document.createElement("button");back.textContent="← กลับไปโฟลเดอร์";back.onclick=()=>{if(selectedDay!==null){selectedDay=null;renderPhotos()}else showFolders()};$("photoFolders").append(back);
  $("photoCount").textContent=folder.name+" • "+photos.length+" ภาพ";
  await renderPhotos();
 }catch(err){
  $("photoMessage").textContent=err.message;
 }
}
async function renderPhotos(){
 if(!active)return;
 const q=$("photoSearch").value.toLocaleLowerCase().trim();
 const items=photos.filter(x=>(String(x.name||"")+" "+ttmDay(x.date)+" "+ttmDayLabel(ttmDay(x.date))).toLocaleLowerCase().includes(q));
 const gen=++requestSeq,container=$("photoGallery");container.replaceChildren();
 const back=$("photoFolders").querySelector("button");
 if(back)back.textContent=selectedDay===null?"← กลับไป LINE กลุ่ม":"← กลับไปโฟลเดอร์วันที่";
 const days=[...new Set(items.map(x=>ttmDay(x.date)))].sort((a,b)=>b.localeCompare(a));
 if(selectedDay!==null&&!days.includes(selectedDay))selectedDay=null;
 if(selectedDay===null){
  $("photoCount").textContent=active.name+" • "+days.length+" วันที่ • "+items.length+" ภาพ";
  $("photoMessage").textContent="เลือกโฟลเดอร์วันที่เพื่อดูภาพ";
  for(const day of days){const n=items.filter(x=>ttmDay(x.date)===day).length;
   const b=document.createElement("button");b.className="date-folder";b.textContent="📅 "+ttmDayLabel(day)+" ("+n+" ภาพ)";
   b.onclick=()=>{selectedDay=day;renderPhotos()};container.append(b)}
  return;
 }
 const visible=items.filter(x=>ttmDay(x.date)===selectedDay);
 $("photoCount").textContent=active.name+" / "+ttmDayLabel(selectedDay);
 $("photoMessage").textContent=visible.length+" ภาพในวันที่เลือก";
 for(const item of visible){
  const box=document.createElement("div");box.className="photo";
  const im=document.createElement("img");im.loading="lazy";im.alt=item.name||"รูปภาพ LINE";
  const label=document.createElement("div");label.className="small";label.textContent=item.name||"ไม่ระบุชื่อ";
  const btn=document.createElement("button");btn.textContent="ดู / ดาวน์โหลด";
  btn.onclick=async()=>{const tab=window.open("about:blank","_blank");try{const r=await fetch("/api/ttm-group/file/"+encodeURIComponent(item.id),{headers:{"x-admin-pin":pin,"x-archive-pin":archivePin,"x-photo-pin":photoPin},cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"เปิดภาพไม่ได้");if(tab){tab.opener=null;tab.location.replace(d.url)}else{const a=document.createElement("a");a.href=d.url;a.target="_blank";a.rel="noopener";document.body.append(a);a.click();a.remove()}}catch(err){if(tab)tab.close();alert(err.message)}};
  box.append(im,label,btn);container.append(box);item._preview=im;
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