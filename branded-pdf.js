const PDFDocument=require("pdfkit");
const XLSX=require("xlsx");
const sharp=require("sharp");
const fs=require("fs");
const path=require("path");

async function renderBrandedExcelPdf(bytes,fileName,thaiFont){
 const wb=XLSX.read(bytes,{type:"buffer",cellDates:false});
 const meeting=/(meeting.?minutes|ประชุม)/iu.test(fileName||"")||wb.SheetNames.some(n=>/ข้อมูลการประชุม|มติที่ประชุม|เนื้อหาต้นฉบับ/.test(n));
 const logoPath=path.join(__dirname,"ttm-logo.webp");
 if(!fs.existsSync(logoPath))throw Error("QC_LOGO_MISSING: TTM company logo absent");
 const logo=await sharp(logoPath).resize({width:400,withoutEnlargement:true}).png().toBuffer();
 if(!logo.length)throw Error("QC_LOGO_UNREADABLE");
 const pages=[];
 for(const name of wb.SheetNames){
  const ws=wb.Sheets[name];
  const matrix=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:"",blankrows:false})
   .map(r=>(r||[]).map(v=>String(v??"").trim()));
  const relevant=matrix.filter(row=>row.some(v=>v!==""));
  if(!relevant.length)continue;
  let cols=Math.max(...relevant.map(r=>r.length));
  while(cols>1 && relevant.every(r=>!r[cols-1]))cols--;
  const colsPerBand=meeting?Math.min(cols,4):Math.min(cols,7);
  for(let start=0;start<cols;start+=colsPerBand){
   const end=Math.min(cols,start+colsPerBand);
   const rows=relevant.map(r=>Array.from({length:end-start},(_,k)=>r[start+k]||"")).filter(row=>row.some(Boolean));
   if(rows.length)pages.push({sheet:name,start,end,cols,rows});
  }
 }
 if(!pages.length)throw Error("QC_NO_SOURCE_CONTENT");
 const doc=new PDFDocument({size:"A4",layout:meeting?"portrait":"landscape",margin:0,autoFirstPage:false,bufferPages:true});
 doc.registerFont("Thai",thaiFont);
 const out=[];
 const done=new Promise((resolve,reject)=>{doc.on("data",c=>out.push(c));doc.on("end",()=>resolve(Buffer.concat(out)));doc.on("error",reject)});
 let pageCounter=0,logicalRows=0;
 const newPage=(name,continuation)=>{
  doc.addPage();pageCounter++;
  const W=doc.page.width;
  doc.rect(0,0,W,103).fill("#f0f7f3");
  doc.rect(0,0,8,103).fill("#126148");
  doc.image(logo,43,17,{fit:[75,75]});
  doc.font("Thai").fillColor("#12543d").fontSize(16).text("TTM HOME DESIGN & BUILD-IN",130,25,{width:W-168,lineBreak:false});
  doc.fontSize(9).fillColor("#537264").text("COMPANY DOCUMENT  |  ART TTM",130,56,{width:W-170,lineBreak:false});
  doc.font("Thai").fillColor("#12543d").fontSize(15).text(name+(continuation?" (ต่อ)":""),47,121,{width:W-94,lineBreak:false});
  doc.moveTo(47,156).lineTo(W-47,156).strokeColor("#bbd6c7").stroke();
  return 173;
 };
 for(const part of pages){
   const width=(meeting?595.28:841.89)-94;
   const n=part.end-part.start;
   const sizes=n===2?[0.29,0.71]:Array.from({length:n},()=>1/n);
   const widths=sizes.map(x=>x*width);
   const xs=[47];for(let i=1;i<n;i++)xs.push(xs[i-1]+widths[i-1]);
   let y=null,rowsOnPage=0;
   const title=part.sheet+(part.cols>part.end-part.start?" | คอลัมน์ "+(part.start+1)+"-"+part.end:"");
   for(let ri=0;ri<part.rows.length;ri++){
    const row=part.rows[ri];
    doc.font("Thai").fontSize(meeting?10.5:9);
    const heights=row.map((str,i)=>doc.heightOfString(str||" ",{width:widths[i]-17,lineGap:2,align:"left"}));
    const rh=Math.max(31,Math.ceil(Math.max(...heights))+15);
    if(rh> (meeting?842:595)-245)throw Error("QC_OVERLONG_ROW: "+part.sheet+" row "+(ri+1));
    if(y===null || y+rh>(meeting?842:595)-69){
      y=newPage(title,ri>0);rowsOnPage=0;
      // Put continuation table header only for structured, 3+ column BOQ pages.
      if(ri>0 && n>=3 && part.rows.length>1){
        const head=part.rows[0];let headerH=35;
        for(let i=0;i<n;i++){doc.rect(xs[i],y,widths[i],headerH).fillAndStroke("#126148","#d7e4da");doc.fillColor("#ffffff").font("Thai").fontSize(9).text(head[i]||"",xs[i]+8,y+8,{width:widths[i]-16,height:headerH-16});}
        y+=headerH;
      }
    }
    const header=ri===0&&n>=3;
    for(let i=0;i<n;i++){
      doc.rect(xs[i],y,widths[i],rh).fillAndStroke(header?"#126148":rowsOnPage%2===0?"#ffffff":"#f2f7f4","#d4e3da");
      doc.font("Thai").fontSize(meeting?10.5:9).fillColor(header?"#ffffff":"#263a31").text(row[i]||"",xs[i]+8,y+7,{width:widths[i]-16,height:rh-14,lineGap:2});
    }
    y+=rh;rowsOnPage++;logicalRows++;
   }
 }
 if(pageCounter===0||logicalRows===0)throw Error("QC_EMPTY_PDF");
 const actual=doc.bufferedPageRange().count;
 if(actual!==pageCounter)throw Error("QC_UNEXPECTED_BLANK_PAGE: expected "+pageCounter+" actual "+actual);
 for(let p=0;p<actual;p++){
  doc.switchToPage(p);
  const W=doc.page.width,H=doc.page.height;
  doc.moveTo(47,H-52).lineTo(W-47,H-52).strokeColor("#d5e3dc").stroke();
  doc.font("Thai").fontSize(8).fillColor("#66786d").text("TTM  |  โปรดตรวจสอบข้อมูลกับต้นฉบับก่อนนำไปใช้งาน",47,H-44,{width:W-215,lineBreak:false});
  doc.text("หน้า "+(p+1)+" / "+actual,W-130,H-44,{width:83,align:"right",lineBreak:false});
 }
 doc.end();
 const pdf=await done;
 if(pdf.length<2500||pdf.subarray(0,5).toString()!=="%PDF-")throw Error("QC_INVALID_PDF");
 return pdf;
}
module.exports={renderBrandedExcelPdf};
