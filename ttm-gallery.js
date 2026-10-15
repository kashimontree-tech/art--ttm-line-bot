(function(){
const get=x=>document.getElementById(x);let renderSeq=0,activeGroup=null;
async function showPhotos(){
 const target=get("photoGallery");if(!target)return;
 const q=(get("photoSearch").value||"").toLocaleLowerCase();
 const all=files.filter(f=>/^image\//i.test(f.type||"")||/\.(jpe?g|png|webp|gif)$/i.test(f.name||""));
 const folders=get("photoFolders");folders.replaceChildren();
 const groups=[...new Set(all.map(f=>f.group||"ไม่ระบุกลุ่ม"))].sort();
 const back=document.createElement("button");back.textContent="📁 ทุกกลุ่ม";back.onclick=()=>{activeGroup=null;showPhotos()};folders.append(back);
 for(const group of groups){const b=document.createElement("button");const count=all.filter(f=>(f.group||"ไม่ระบุกลุ่ม")===group).length;b.textContent="📂 "+group+" ("+count+")";b.style.background=activeGroup===group?"#126148":"#e4eee8";b.style.color=activeGroup===group?"white":"#14563f";b.onclick=()=>{activeGroup=group;showPhotos()};folders.append(b)}
 const selected=all.filter(f=>activeGroup===null?false:(f.group||"ไม่ระบุกลุ่ม")===activeGroup).filter(f=>(f.name+" "+f.group).toLocaleLowerCase().includes(q));
 get("photoCount").textContent=activeGroup===null?"เลือกโฟลเดอร์ LINE กลุ่มที่ต้องการ ("+groups.length+" กลุ่ม · "+all.length+" ภาพ)":activeGroup+" — "+selected.length+" ภาพ";
 const current=++renderSeq;target.replaceChildren();
 if(!selected.length){get("photoMessage").textContent=activeGroup===null?"เลือกโฟลเดอร์กลุ่มเพื่อดูภาพ":"ไม่พบภาพตามคำค้น";return}
 get("photoMessage").textContent="กำลังเตรียมภาพตัวอย่าง...";
 for(const f of selected){
  const box=document.createElement("div");box.className="photo";
  const img=document.createElement("img");img.alt="ภาพ "+f.name;img.loading="lazy";
  const detail=document.createElement("div");detail.className="small";detail.textContent=f.name+" | "+(f.group||"");
  const view=document.createElement("button");view.textContent="ดู / ดาวน์โหลด";view.onclick=async()=>{
   try{const data=await api("/api/ttm-group/file/"+encodeURIComponent(f.id));window.open(data.url,"_blank","noopener")}catch(e){alert(e.message)}
  };
  box.append(img,detail,view);target.append(box);f._thumb=img;
 }
 for(let offset=0;offset<selected.length;offset+=24){
  if(current!==renderSeq)return;
  const batch=selected.slice(offset,offset+24);
  try{
   const res=await fetch("/api/ttm-group/photo-links",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin},body:JSON.stringify({ids:batch.map(x=>x.id)})});
   if(!res.ok)throw Error("Preview unavailable");
   const data=await res.json();
   if(current!==renderSeq)return;
   for(const entry of data.items||[]){const item=batch.find(x=>x.id===entry.id);if(item?._thumb)item._thumb.src=entry.url}
  }catch(e){get("photoMessage").textContent="บางภาพแสดงตัวอย่างไม่ได้ แต่ยังลองกดดู / ดาวน์โหลดได้"}
 }
 if(current===renderSeq&&!get("photoMessage").textContent.includes("ไม่ได้"))get("photoMessage").textContent="แตะปุ่มใต้ภาพเพื่อเปิดภาพต้นฉบับหรือบันทึกลงเครื่อง";
}
get("photoSearch").addEventListener("input",()=>showPhotos());
const original=window.tab;window.tab=function(id){original(id);if(id==="photos")showPhotos()};
})();