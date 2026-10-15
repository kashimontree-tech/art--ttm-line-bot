(function(){
const $=id=>document.getElementById(id);let scope="",pass="";
async function folders(){
 scope="";pass="";archivePin="";files=[];$("fileInside").classList.add("hide");$("fileFolders").replaceChildren();$("loading").textContent="กำลังโหลดโฟลเดอร์...";
 try{
 const data=await api("/api/ttm-group/file-folders");
 for(const f of data.folders||[]){
 const btn=document.createElement("button");btn.textContent="📁 "+f.name+" ("+f.count+" ไฟล์)";
 btn.onclick=()=>openFolder(f);$("fileFolders").append(btn)
 }
 $("loading").textContent=(data.folders||[]).length+" โฟลเดอร์"+(data.limited?" (แสดงจาก 1,000 รายการล่าสุด)":"");
 }catch(e){$("loading").textContent=e.message}
}
async function openFolder(f){
 const code=window.prompt("กรอกรหัสเข้าถึงคลังไฟล์ของ "+f.name);if(code===null)return;
 try{
 const r=await fetch("/api/ttm-group/folder-files",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":code.trim()},body:JSON.stringify({scope:f.scope}),cache:"no-store"});
 const data=await r.json();if(!r.ok)throw Error(data.error||"เปิดโฟลเดอร์ไม่สำเร็จ");
 scope=f.scope;pass=code.trim();archivePin=pass;files=data.files||[];
 $("fileFolders").replaceChildren();$("fileInside").classList.remove("hide");$("query").value="";$("type").value="";render();
 $("loading").textContent=f.name+" • "+files.length+" ไฟล์";
 }catch(e){alert(e.message)}
}
window.showFileFolders=folders;
$("fileBack").onclick=folders;
$("refreshFiles").onclick=()=>scope?refreshCurrent():folders();
async function refreshCurrent(){
 if(!scope)return folders();
 const r=await fetch("/api/ttm-group/folder-files",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":pass},body:JSON.stringify({scope}),cache:"no-store"});
 const d=await r.json();if(!r.ok){$("loading").textContent=d.error||"โหลดไม่สำเร็จ";return}
 files=d.files||[];render();$("loading").textContent="โหลดข้อมูลล่าสุด "+files.length+" ไฟล์";
}
})();