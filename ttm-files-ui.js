(function(){
const $=id=>document.getElementById(id);let scope="",pass="",folderRequest=0;
async function folders(){
 const generation=++folderRequest;
 scope="";pass="";archivePin="";files=[];selectedFileDate=null;selectedFileAlbum=null;fileAlbums=[];$("fileInside").classList.add("hide");$("fileFolders").replaceChildren();$("loading").textContent="กำลังโหลดโฟลเดอร์...";
 try{
 const data=await api("/api/ttm-group/file-folders");
 if(generation!==folderRequest)return;
 const unique=[...new Map((data.folders||[]).filter(f=>String(f.scope||"").startsWith("group:")).map(f=>[f.scope,f])).values()];
 for(const f of unique){
 const btn=document.createElement("button");btn.textContent="📁 "+f.name+" ("+f.count+" ไฟล์)";
 btn.onclick=()=>openFolder(f);$("fileFolders").append(btn)
 }
 $("loading").textContent=unique.length+" โฟลเดอร์"+(data.limited?" (แสดงจาก 1,000 รายการล่าสุด)":"");
 }catch(e){$("loading").textContent=e.message}
}
async function openFolder(f){
 ++folderRequest;
 const code=await window.ttmAsk("กรอกรหัสเข้าถึงคลังไฟล์ของ "+f.name,{secret:true});if(!code)return;
 try{
 const r=await fetch("/api/ttm-group/folder-files",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":code.trim()},body:JSON.stringify({scope:f.scope}),cache:"no-store"});
 const data=await r.json();if(!r.ok)throw Error(data.error||"เปิดโฟลเดอร์ไม่สำเร็จ");
 scope=f.scope;pass=code.trim();archivePin=pass;files=data.files||[];selectedFileDate=null;selectedFileAlbum=null;fileAlbums=[];
 try{await loadAlbums()}catch(albumError){console.warn("File albums optional:",albumError)}
 $("fileFolders").replaceChildren();$("fileInside").classList.remove("hide");$("query").value="";$("type").value="";render();
 $("loading").textContent=f.name+" • "+files.length+" ไฟล์";
 }catch(e){alert(e.message)}
}
async function albumPost(url,payload){
 const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":pass},body:JSON.stringify({scope,kind:"file",...payload}),cache:"no-store"});
 const out=await r.json();if(!r.ok)throw Error(out.error||"เกิดข้อผิดพลาด");return out;
}
async function loadAlbums(){
 const r=await albumPost("/api/ttm-group/albums/list",{});
 fileAlbums=r.albums||[];
}
$("fileCreateAlbum").onclick=async()=>{
 if(!scope)return;
 const name=await window.ttmAsk("ตั้งชื่ออัลบั้มใหม่");if(!name?.trim())return;
 try{await albumPost("/api/ttm-group/albums/create",{name:name.trim()});await loadAlbums();selectedFileAlbum=null;selectedFileDate=null;render()}
 catch(e){alert("สร้างอัลบั้มไม่ได้: "+e.message)}
};
window.addFileToAlbum=async function(f){
 if(!fileAlbums.length){alert("กรุณาสร้างอัลบั้มก่อน");return}
 const opts=fileAlbums.map((a,i)=>(i+1)+". "+a.name).join("\n");
 const chosen=await window.ttmAsk("เลือกเลขอัลบั้มสำหรับไฟล์นี้\n"+opts);
 if(chosen===null)return;const i=Number(chosen)-1;
 if(!Number.isInteger(i)||i<0||i>=fileAlbums.length){alert("เลขอัลบั้มไม่ถูกต้อง");return}
 try{await albumPost("/api/ttm-group/albums/add",{albumId:fileAlbums[i].id,fileId:f.id});await loadAlbums();render();$("loading").textContent="เพิ่มไฟล์ลงอัลบั้มสำเร็จ ✅"}
 catch(e){alert("เพิ่มไฟล์ไม่ได้: "+e.message)}
};
window.showFileFolders=folders;
$("fileBack").onclick=()=>{if(selectedFileDate!==null||selectedFileAlbum!==null){selectedFileDate=null;selectedFileAlbum=null;render();$("loading").textContent="เลือกโฟลเดอร์วันที่"}else folders()};
$("refreshFiles").onclick=()=>scope?refreshCurrent():folders();
async function refreshCurrent(){
 if(!scope)return folders();
 const r=await fetch("/api/ttm-group/folder-files",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin,"x-archive-pin":pass},body:JSON.stringify({scope}),cache:"no-store"});
 const d=await r.json();if(!r.ok){$("loading").textContent=d.error||"โหลดไม่สำเร็จ";return}
 files=d.files||[];try{await loadAlbums()}catch(e){console.warn("File album refresh:",e)}render();$("loading").textContent="โหลดข้อมูลล่าสุด "+files.length+" ไฟล์";
}
})();