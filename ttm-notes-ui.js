(function(){
 const $=id=>document.getElementById(id);
 let fetching=false;
 window.loadNotesGroups=async function(){
  if(fetching)return;
  fetching=true;
  const select=$("notesGroup"),existing=select.value;
  try{
   const data=await api("/api/ttm-group/file-folders");
   select.replaceChildren();
   const empty=document.createElement("option");empty.value="";empty.textContent="เลือก LINE กลุ่ม";select.append(empty);
   for(const f of data.folders||[]){
    if(!String(f.scope||"").startsWith("group:"))continue;
    const o=document.createElement("option");o.value=f.scope;o.textContent=f.name;select.append(o);
   }
   if([...select.options].some(x=>x.value===existing))select.value=existing;
  }catch(err){$("notesStatus").textContent="โหลดรายชื่อกลุ่มไม่สำเร็จ: "+err.message}
  finally{fetching=false}
 };
 const fileKind=file=>/\\.(png|jpg|jpeg|webp|heic)$/i.test(file.name)?"photo":"file";
 const getKind=()=>{
  const selected=[...$("notesFiles").files];
  if(!selected.length)return null;
  const kinds=[...new Set(selected.map(fileKind))];
  if(kinds.length>1)throw new Error("กรุณานำเข้าภาพกับเอกสารแยกครั้ง เพื่อเลือกอัลบั้มให้ถูกประเภท");
  return kinds[0];
 };
 const albumPost=async(url,data)=>{
  const r=await fetch(url,{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":$("notesPass").value.trim()},body:JSON.stringify(data)});
  const out=await r.json();if(!r.ok)throw new Error(out.error||"โหลดอัลบั้มไม่ได้");return out;
 };
 const refreshAlbums=async()=>{
  const scope=$("notesGroup").value,code=$("notesPass").value.trim();
  if(!scope||!code)throw new Error("เลือก LINE กลุ่มและกรอกรหัสกลุ่มก่อน");
  const kind=$("notesAlbumKind").value;
  const select=$("notesAlbum"),previous=select.value;
  const result=await albumPost("/api/ttm-group/albums/list",{scope,kind});
  select.replaceChildren();
  const first=document.createElement("option");first.value="";first.textContent="เก็บในโฟลเดอร์วันที่เท่านั้น";select.append(first);
  for(const a of result.albums||[]){const option=document.createElement("option");option.value=a.id;option.textContent="📁 "+a.name;select.append(option)}
  if([...select.options].some(x=>x.value===previous))select.value=previous;
  $("notesAlbumStatus").textContent="พบ "+(result.albums||[]).length+" อัลบั้มสำหรับ"+(kind==="photo"?"รูปภาพ":"เอกสาร");
 };
 $("notesLoadAlbums").onclick=async()=>{try{await refreshAlbums()}catch(e){$("notesAlbumStatus").textContent=e.message}};
 $("notesNewAlbum").onclick=async()=>{
  try{
   const scope=$("notesGroup").value,code=$("notesPass").value.trim(),kind=$("notesAlbumKind").value;
   if(!scope||!code)throw new Error("เลือกกลุ่มและใส่รหัสก่อนสร้างอัลบั้ม");
   const name=await window.ttmAsk("ตั้งชื่ออัลบั้มย่อยใหม่");
   if(!name)return;
   await albumPost("/api/ttm-group/albums/create",{scope,kind,name:name.trim()});
   await refreshAlbums();
   const target=[...$("notesAlbum").options].find(o=>o.textContent==="📁 "+name.trim());
   if(target)$("notesAlbum").value=target.value;
  }catch(e){$("notesAlbumStatus").textContent=e.message}
 };
 const resetAlbum=()=>{$("notesAlbum").replaceChildren(new Option("เก็บในโฟลเดอร์วันที่เท่านั้น",""));$("notesAlbumStatus").textContent="เลือกไฟล์แล้วกดโหลดอัลบั้ม"};
 $("notesGroup").addEventListener("change",()=>{resetAlbum();if($("notesPass").value.trim())refreshAlbums().catch(e=>$("notesAlbumStatus").textContent=e.message)});
 $("notesPass").addEventListener("change",()=>{refreshAlbums().catch(e=>$("notesAlbumStatus").textContent=e.message)});
 $("notesAlbumKind").addEventListener("change",()=>{resetAlbum();if($("notesGroup").value&&$("notesPass").value.trim())refreshAlbums().catch(e=>$("notesAlbumStatus").textContent=e.message)});
 $("notesFiles").addEventListener("change",()=>{
  try{const kind=getKind();if(kind&&kind!==$("notesAlbumKind").value){$("notesAlbumKind").value=kind;resetAlbum();refreshAlbums().catch(e=>$("notesAlbumStatus").textContent=e.message)}}
  catch(e){$("notesAlbumStatus").textContent=e.message}
 });
 const asBase64=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error("อ่านไฟล์ในเครื่องไม่สำเร็จ"));
  reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");
  reader.readAsDataURL(file);
 });
 $("notesForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const scope=$("notesGroup").value,code=$("notesPass").value.trim(),items=[...$("notesFiles").files];
  const status=$("notesStatus"),button=$("notesSubmit");
  if(!scope||!code||!items.length){status.textContent="กรุณาเลือกกลุ่ม ใส่รหัส และเลือกไฟล์";return}
  try{const actual=getKind();if(actual!==$("notesAlbumKind").value){status.textContent="ชนิดอัลบั้มไม่ตรงกับไฟล์ กรุณาเลือกอัลบั้มใหม่";return}}catch(err){status.textContent=err.message;return}
  if(items.length>20){status.textContent="อัปโหลดได้ไม่เกิน 20 ไฟล์ต่อครั้ง";return}
  button.disabled=true;
  let done=0,warnings=[];
  for(const file of items){
   if(file.size>12*1024*1024){status.textContent="ไฟล์ "+file.name+" ใหญ่เกิน 12 MB (บันทึกไปแล้ว "+done+" ไฟล์)";break}
   try{
    status.textContent="กำลังบันทึก "+(done+1)+"/"+items.length+": "+file.name;
    const base64=await asBase64(file);
    const r=await fetch("/api/ttm-group/import-notes",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":code},body:JSON.stringify({scope,name:file.name,base64,albumId:$("notesAlbum").value||null})});
    const out=await r.json();
    if(!r.ok)throw new Error(out.error||"อัปโหลดไม่สำเร็จ");
    done++;if(out.warning)warnings.push(file.name+": "+out.warning);
   }catch(err){status.textContent="บันทึกได้ "+done+" ไฟล์; "+file.name+" ไม่สำเร็จ: "+err.message;break}
  }
  if(done===items.length){status.textContent=warnings.length?"บันทึกไฟล์แล้ว "+done+" ไฟล์ แต่ "+warnings.join("; "):"บันทึกสำเร็จ "+done+" ไฟล์"+($("notesAlbum").value?" ลงอัลบั้มย่อยและโฟลเดอร์วันที่":" ในโฟลเดอร์วันที่")+" ✅";$("notesFiles").value="";$("notesPass").value=""}
  button.disabled=false;
 });
})();