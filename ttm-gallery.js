(function(){
const get=x=>document.getElementById(x);let renderSeq=0;
async function showPhotos(){
 const target=get("photoGallery");if(!target)return;
 const q=(get("photoSearch").value||"").toLocaleLowerCase();
 const selected=files.filter(f=>/^image\//i.test(f.type||"")||/\.(jpe?g|png|webp|gif)$/i.test(f.name||"")).filter(f=>(f.name+" "+f.group).toLocaleLowerCase().includes(q));
 get("photoCount").textContent=selected.length+" ภาพที่บันทึกไว้ (จากรายการที่โหลด)";
 const current=++renderSeq;target.replaceChildren();
 if(!selected.length){get("photoMessage").textContent="ไม่พบภาพตามคำค้น";return}
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