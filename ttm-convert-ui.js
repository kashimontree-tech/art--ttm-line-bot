document.getElementById("convertForm").addEventListener("submit",async function(e){
 e.preventDefault();
 const file=document.getElementById("convertFile").files[0],status=document.getElementById("convertStatus"),output=document.getElementById("convertResult");
 if(!file)return;
 status.textContent="กำลังแปลงไฟล์...";output.replaceChildren();
 try{
  if(file.size>14*1024*1024)throw Error("ไฟล์เกิน 14MB");
  const bytes=new Uint8Array(await file.arrayBuffer());let str="";
  for(let i=0;i<bytes.length;i+=4096)str+=String.fromCharCode(...bytes.subarray(i,i+4096));
  const res=await fetch("/api/ttm-group/convert",{method:"POST",headers:{"Content-Type":"application/json","x-admin-pin":pin},body:JSON.stringify({name:file.name,mime:file.type||(/\.png$/i.test(file.name)?"image/png":/\.jpe?g$/i.test(file.name)?"image/jpeg":""),target:"pdf",base64:btoa(str)})});
  const result=await res.json();if(!res.ok)throw Error(result.error||"Conversion failed");
  status.textContent="แปลงสำเร็จและบันทึกเข้าคลังแล้ว โปรดตรวจเทียบต้นฉบับ";
  const link=document.createElement("a");link.href=result.url;link.target="_blank";link.rel="noopener";link.textContent="ดาวน์โหลด "+result.name;output.append(link);if(window.showFileFolders)window.showFileFolders();
 }catch(err){status.textContent="เกิดข้อผิดพลาด: "+err.message}
});