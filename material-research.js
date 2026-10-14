function isMaterialResearch(text){
 return /(?:กระเบื้อง|tile|แกรนิตโต้|กาวซีเมนต์|ยาแนว|วัสดุก่อสร้าง)/i.test(text||"") &&
 /(?:ราคา|เปรียบเทียบ|เทียบราคา|เช็คราคา|ค้นเว็บ|เว็บไซต์|คำนวณ|จำนวน|ต้นทุน|ตร\.?ม|ตารางเมตร)/i.test(text||"");
}
function tileEstimate(text){
 const t=String(text||"");
 const area=Number((t.match(/(\d+(?:\.\d+)?)\s*(?:ตร\.?ม\.?|ตารางเมตร|sqm|m2)/i)||[])[1]);
 const size=t.match(/(\d{2,3})\s*[x×*]\s*(\d{2,3})\s*(?:ซม\.?|cm)?/i);
 if(!Number.isFinite(area)||area<=0||!size)return null;
 const w=Number(size[1]),h=Number(size[2]);
 if(w<10||h<10||w>200||h>200)return null;
 const waste=Number((t.match(/เผื่อ(?:เศษ)?\s*(\d+(?:\.\d+)?)\s*%/)||[])[1]||5);
 const quantity=Math.ceil(area*(1+Math.min(30,Math.max(0,waste))/100)/((w/100)*(h/100)));
 return {area,width:w,height:h,waste,quantity};
}
async function researchMaterials(text,{key,model,displayName}){
 const calc=tileEstimate(text);
 const prompt=[
   "คุณเป็นผู้ช่วยจัดซื้อ TTM ค้นหาราคาวัสดุก่อสร้างไทยจากหน้าเว็บที่เข้าถึงได้ในขณะนี้ ใช้ผลการค้นหาจริงเท่านั้น",
   "ถ้าเป็นกระเบื้อง ให้เปรียบเทียบอย่างน้อย 2 ตัวเลือกเมื่อมีข้อมูล โดยระบุขนาด ยี่ห้อ รุ่น ราคา หน่วยขาย จำนวนแผ่นต่อกล่อง (ถ้าทราบ) เว็บไซต์ URL และวันที่ตรวจ",
   "ห้ามประดิษฐ์ราคา หรืออ้างว่าเป็นราคาวันนี้โดยไม่มีแหล่งข้อมูล ตรวจราคา/หน่วยและ VAT รวมถึงค่าส่งก่อนสรุป ใช้สูตรพื้นที่/พื้นที่แผ่น พร้อมเผื่อเศษ",
   "กรณีค้นราคาสดไม่ได้ ให้บอกตรงๆ และคำนวณเฉพาะปริมาณจากโจทย์ หรือขอข้อมูลที่ขาด",
   "ผลลัพธ์เป็นภาษาไทยสำหรับ LINE ไม่เกิน 3500 ตัวอักษร อย่าใส่ข้อความเชิงระบบ",
   calc?`ข้อมูลคำนวณที่ตรวจด้วยสูตร: พื้นที่ ${calc.area} ตร.ม. ขนาด ${calc.width}x${calc.height} ซม. เผื่อเศษ ${calc.waste}% ใช้ไม่น้อยกว่า ${calc.quantity} แผ่น (ไม่รวมการปัดเต็มกล่อง)`:"",
   "คำขอผู้ใช้: "+text
 ].filter(Boolean).join("\n");
 const response=await fetch("https://api.openai.com/v1/responses",{
   method:"POST",
   headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
   body:JSON.stringify({model:model||"gpt-5.4",tools:[{type:"web_search_preview"}],tool_choice:"auto",input:prompt,max_output_tokens:1450})
 });
 if(!response.ok)throw Error("Material search "+response.status+": "+(await response.text()).slice(0,300));
 const data=await response.json();
 let outputs=[];
 for(const item of data.output||[])for(const c of item.content||[])if(c.type==="output_text")outputs.push(c.text);
 const answer=outputs.join("\n").trim();
 if(!answer)throw Error("No grounded material-search result");
 return `${displayName||"พี่"}ครับ\n${answer}`.slice(0,4900);
}
module.exports={isMaterialResearch,researchMaterials,tileEstimate};
