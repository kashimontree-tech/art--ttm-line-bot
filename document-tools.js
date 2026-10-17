"use strict";
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const {Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType} = require("docx");
const PptxGenJS = require("pptxgenjs");

function requestedDocument(text) {
  const t=String(text||"");
  if (!/(?:ทำ|สร้าง|จัดทำ|เขียน|สรุป|ออกแบบ|ร่าง|ส่งออก|export)/i.test(t)) return null;
  if(/(?:ส่ง|ขอ|ดาวน์โหลด|ค้นหา).{0,100}(?:ที่ทำไว้|ที่สร้างไว้|เดิม|กลับมา)/u.test(t))return null;
  // Existing conversion commands must keep their original-specific route.
  if (/(?:แปลง|convert)/i.test(t)) return null;
  if (/power\s*point|pptx|พาวเวอร์พอย|เพาเวอร์พอย|สไลด์|พรีเซนต์/i.test(t)) return "pptx";
  if (/\bword\b|docx|เวิร์ด/i.test(t)) return "docx";
  if (/excel|xlsx|เอ็กเซล|เอ็กซ์เซล/i.test(t)) return "xlsx";
  if (/pdf|พีดีเอฟ/i.test(t) && !/สลิป|อัลบั้ม/.test(t)) return "pdf";
  return null;
}

function validateSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Document data is not an object");
  const str=(v,max=8000)=>{if(typeof v!=="string"||v.length>max)throw Error("Invalid or oversized document text");return v;};
  const spec={title:str(raw.title,240),fileName:typeof raw.fileName==="string"?raw.fileName:"Art_TTM",sections:[],sheets:[],slides:[]};
  const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)throw Error("Invalid document array");return v;};
  for(const x of list(raw.sections||[],50))spec.sections.push({heading:str(x.heading||"",300),text:str(x.text||"",12000)});
  for(const x of list(raw.sheets||[],10)){
    const rows=list(x.rows,501).map(row=>list(row,20).map(cell=>{
      if(typeof cell==="number"&&Number.isFinite(cell))return cell;
      if(cell===null)return "";
      return str(cell,4000);
    }));
    spec.sheets.push({name:str(x.name,31),rows});
  }
  for(const x of list(raw.slides||[],20))spec.slides.push({title:str(x.title,180),bullets:list(x.bullets||[],8).map(v=>str(v,350))});
  if(!spec.sections.length&&!spec.sheets.length&&!spec.slides.length)throw Error("Document contains no content");
  return spec;
}

function safeName(name,extension) {
  const stem=String(name||"Art_TTM").replace(/\.[a-z0-9]{2,5}$/i,"").replace(/[\\/<>:"|?*\x00-\x1f]/g,"_").trim().slice(0,110)||"Art_TTM";
  return stem+"."+extension;
}

async function renderDocument(raw,format,{thaiFont}={}) {
  const spec=validateSpec(raw);
  let bytes,mime;
  if(format==="docx"){
    const children=[new Paragraph({text:spec.title,heading:HeadingLevel.TITLE})];
    for(const section of spec.sections){
      if(section.heading)children.push(new Paragraph({text:section.heading,heading:HeadingLevel.HEADING_1}));
      for(const line of section.text.split("\n"))children.push(new Paragraph({children:[new TextRun({text:line,font:"Noto Sans Thai",size:24})],spacing:{after:120}}));
    }
    for(const sheet of spec.sheets){
      children.push(new Paragraph({text:sheet.name,heading:HeadingLevel.HEADING_1}));
      if(sheet.rows.length)children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:sheet.rows.map((row,i)=>new TableRow({tableHeader:i===0,children:row.map(v=>new TableCell({children:[new Paragraph({children:[new TextRun({text:String(v),font:"Noto Sans Thai",size:20,bold:i===0})]})]}))}))}));
    }
    bytes=await Packer.toBuffer(new Document({creator:"Art TTM",title:spec.title,styles:{default:{document:{run:{font:"Noto Sans Thai",size:24}}}},sections:[{children}]}));
    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }else if(format==="pptx"){
    const pptx=new PptxGenJS();pptx.layout="LAYOUT_WIDE";pptx.author="Art TTM";pptx.subject=spec.title;pptx.title=spec.title;
    pptx.lang="th-TH";pptx.theme={headFontFace:"Noto Sans Thai",bodyFontFace:"Noto Sans Thai",lang:"th-TH"};
    const slides=spec.slides.length?spec.slides:spec.sections.map(x=>({title:x.heading||spec.title,bullets:x.text.split("\n").filter(Boolean)}));
    if(!slides.length)throw Error("Presentation has no slides");
    for(const section of slides){
      // Paginate by text length as well as bullet count; never silently drop content.
      const pieces=section.bullets.flatMap(s=>String(s).match(/[\s\S]{1,160}/g)||[""]);
      for(let offset=0;offset<Math.max(1,pieces.length);offset+=4){
        const slide=pptx.addSlide();slide.background={color:"F7FAF8"};
        slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:0.22,h:7.5,fill:{color:"176A4A"},line:{color:"176A4A"}});
        slide.addText(section.title+(offset?" (ต่อ)":""),{x:0.7,y:0.55,w:11.9,h:1,fontFace:"Noto Sans Thai",fontSize:28,bold:true,color:"17533D",breakLine:false,fit:"shrink"});
        slide.addText(pieces.slice(offset,offset+4).map(text=>({text,options:{bullet:{indent:18},breakLine:true}})),{x:0.8,y:1.9,w:11.6,h:4.6,fontSize:23,color:"253B32",paraSpaceAfterPt:20,margin:6,fit:"shrink"});
        slide.addText("TTM HOME DESIGN & BUILD-IN  |  By Art TTM",{x:0.8,y:7,w:11.5,h:0.25,fontSize:10,color:"577166"});
      }
    }
    bytes=Buffer.from(await pptx.write({outputType:"nodebuffer"}));mime="application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }else if(format==="xlsx"){
    const wb=XLSX.utils.book_new();const names=new Set();
    const sheets=spec.sheets.length?spec.sheets:[{name:"สรุป",rows:[[spec.title],...spec.sections.map(x=>[x.heading,x.text])]}];
    for(const [i,sheet] of sheets.entries()){
      let name=sheet.name.replace(/[\\/\[\]*?:]/g,"_").slice(0,26)||"Sheet";
      if(names.has(name))name+="_"+(i+1);names.add(name);
      const ws=XLSX.utils.aoa_to_sheet(sheet.rows);ws["!cols"]=Array.from({length:Math.max(1,...sheet.rows.map(x=>x.length))},()=>({wch:28}));
      XLSX.utils.book_append_sheet(wb,ws,name);
    }
    bytes=Buffer.from(XLSX.write(wb,{type:"buffer",bookType:"xlsx"}));mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }else if(format==="pdf"){
    if(!thaiFont)throw Error("Thai PDF font is unavailable");
    bytes=await new Promise((resolve,reject)=>{
      const doc=new PDFDocument({size:"A4",margin:45,info:{Title:spec.title,Author:"Art TTM"}}),chunks=[];
      doc.on("data",c=>chunks.push(c));doc.on("error",reject);doc.on("end",()=>resolve(Buffer.concat(chunks)));
      doc.font(thaiFont).fontSize(21).fillColor("#17533D").text(spec.title);doc.moveDown();
      for(const section of spec.sections){
        if(section.heading)doc.fontSize(15).fillColor("#17533D").text(section.heading);
        doc.fontSize(12).fillColor("#202C25").text(section.text,{lineGap:5});doc.moveDown();
      }
      for(const sheet of spec.sheets){doc.fontSize(15).text(sheet.name);for(const row of sheet.rows)doc.fontSize(10).text(row.map(String).join("  |  "),{lineGap:4});doc.moveDown();}
      doc.end();
    });mime="application/pdf";
  }else throw Error("Unsupported document format");
  if(!bytes?.length)throw Error("Empty generated document");
  return {bytes,mime,fileName:safeName(spec.fileName,format),title:spec.title};
}

module.exports={requestedDocument,validateSpec,safeName,renderDocument};
