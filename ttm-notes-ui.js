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
  if(items.length>20){status.textContent="อัปโหลดได้ไม่เกิน 20 ไฟล์ต่อครั้ง";return}
  button.disabled=true;
  let done=0;
  for(const file of items){
   if(file.size>12*1024*1024){status.textContent="ไฟล์ "+file.name+" ใหญ่เกิน 12 MB (บันทึกไปแล้ว "+done+" ไฟล์)";break}
   try{
    status.textContent="กำลังบันทึก "+(done+1)+"/"+items.length+": "+file.name;
    const base64=await asBase64(file);
    const r=await fetch("/api/ttm-group/import-notes",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":code},body:JSON.stringify({scope,name:file.name,base64})});
    const out=await r.json();
    if(!r.ok)throw new Error(out.error||"อัปโหลดไม่สำเร็จ");
    done++;
   }catch(err){status.textContent="บันทึกได้ "+done+" ไฟล์; "+file.name+" ไม่สำเร็จ: "+err.message;break}
  }
  if(done===items.length){status.textContent="บันทึกสำเร็จ "+done+" ไฟล์ในคลังกลุ่มที่เลือกแล้ว ✅ เปิดคลังภาพหรือคลังไฟล์เพื่อดูตามวันที่";$("notesFiles").value="";$("notesPass").value=""}
  button.disabled=false;
 });
})();