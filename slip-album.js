const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
async function readSlip(image, apiKey) {
 const mime = image.mime || "image/jpeg";
 const response = await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
  body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL || "gpt-5.4",
   instructions:"Extract one Thai bank transfer slip. Return ONLY JSON with fields amount (number or null), date (string or null), reference (string or null), sender (string or null), receiver (string or null), confidence (high|medium|low). Extract transferred amount, NOT account balances. When ambiguous use null, never guess.",
   input:[{role:"user",content:[{type:"input_text",text:"Read the transfer slip and return JSON."},{type:"input_image",image_url:"data:"+mime+";base64,"+image.bytes.toString("base64")}]}],max_output_tokens:320})
 });
 if(!response.ok) throw Error("Slip recognition "+response.status);
 const data=await response.json();
 const raw=data.output_text || (data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("");
 const candidate=raw.match(/\{[\s\S]*\}/)?.[0];
 if(!candidate) throw Error("Missing recognition data");
 const parsed=JSON.parse(candidate);
 const amount=typeof parsed.amount==="number" && Number.isFinite(parsed.amount)&&parsed.amount>=0 ? parsed.amount : null;
 return {amount,date:String(parsed.date||""),reference:String(parsed.reference||""),sender:String(parsed.sender||""),receiver:String(parsed.receiver||""),confidence:["high","medium","low"].includes(parsed.confidence)?parsed.confidence:"low"};
}
function makeExports(items) {
 const total=items.reduce((n,x)=>n+(x.amount!==null && x.confidence==="high"?x.amount:0),0);
 const excluded=items.filter(x=>x.amount===null || x.confidence!=="high").length;
 const rows=[["No.","File","Date","Reference","Sender","Receiver","Amount (THB)","Verification"]];
 items.forEach((x,i)=>rows.push([i+1,x.fileName,x.date,x.reference,x.sender,x.receiver,x.amount===null?"":x.amount,x.confidence==="high"?"AI read - verify":"Needs review"]));
 rows.push(["","","","","","HIGH CONFIDENCE TOTAL",total,"Not reconciled"]);
 rows.push(["","","","","","NEEDS REVIEW COUNT",excluded,""]);
 const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(rows);
 ws["!cols"]=[{wch:7},{wch:34},{wch:22},{wch:30},{wch:28},{wch:28},{wch:18},{wch:25}];
 XLSX.utils.book_append_sheet(wb,ws,"Slip Summary");
 const excel=Buffer.from(XLSX.write(wb,{type:"buffer",bookType:"xlsx"}));
 return {excel,total,excluded};
}
function makeReportPdf(items,font) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:"A4",margin:35,autoFirstPage:false}),parts=[];
  doc.on("data",x=>parts.push(x));doc.on("end",()=>resolve(Buffer.concat(parts)));doc.on("error",reject);
  try {
   doc.registerFont("Thai",font);doc.addPage();doc.font("Thai").fontSize(17).text("TTM - Slip Album & Summary");
   doc.fontSize(10).text("Amounts are AI-extracted and require reconciliation.");
   const confirmed=items.filter(x=>x.amount!==null&&x.confidence==="high");
   const total=confirmed.reduce((n,x)=>n+x.amount,0);
   doc.moveDown().fontSize(13).text("High-confidence subtotal: "+total.toLocaleString("en-US",{minimumFractionDigits:2})+" THB");
   doc.fontSize(11).text("Slips: "+items.length+" | Need review: "+(items.length-confirmed.length));
   for(let i=0;i<items.length;i++){
    const x=items[i];doc.addPage();
    doc.font("Thai").fontSize(12).text("Slip "+(i+1)+" / "+items.length);
    doc.fontSize(9).text("File: "+x.fileName);
    doc.text("Amount: "+(x.amount===null?"Needs review":x.amount.toLocaleString("en-US",{minimumFractionDigits:2})+" THB")+" | Confidence: "+x.confidence);
    doc.text("Date: "+(x.date||"-")+"  Reference: "+(x.reference||"-"));
    const top=doc.y+12;doc.image(x.bytes,35,top,{fit:[doc.page.width-70,doc.page.height-top-35],align:"center"});
   }
   doc.end();
  }catch(e){reject(e);}
 });
}
module.exports={readSlip,makeExports,makeReportPdf};
