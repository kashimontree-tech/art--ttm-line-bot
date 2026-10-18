(function(root){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const finite=value=>Number.isFinite(Number(value))?Number(value):0;
  const cents=value=>Math.round((finite(value)+Number.EPSILON)*100);
  function totals(doc){
    const lines=(doc.items||[]).map(item=>cents(finite(item.qty)*finite(item.price)));
    const original=lines.reduce((sum,value)=>sum+value,0);
    const billing=doc.documentType==='billing';
    const amountMode=billing&&doc.billingMode==='amount';
    const percent=amountMode?100:(billing?finite(doc.billingPercent??100):100);
    if(percent<=0||percent>100)throw Error('สัดส่วนวางบิลต้องมากกว่า 0 และไม่เกิน 100%');
    const vatRate=finite(doc.vat),whtRate=billing?3:0;
    if(vatRate<0||vatRate>100||whtRate<0||whtRate>100)throw Error('อัตราภาษีต้องอยู่ระหว่าง 0–100%');
    const subtotal=amountMode?cents(doc.billingAmount):Math.round(original*percent/100);
    if(amountMode&&(!Number.isFinite(Number(doc.billingAmount))||subtotal<=0))throw Error('กรุณากรอกยอดวางบิลก่อน VAT มากกว่า 0 บาท');
    const vat=Math.round(subtotal*vatRate/100),withholding=Math.round(subtotal*whtRate/100);
    return {lines,original,percent:amountMode?(original?subtotal/original*100:0):percent,subtotal,vat,withholding,gross:subtotal+vat,net:subtotal+vat-withholding};
  }
  function createBilling(quote,existing={},date){
    if(quote.documentType==='billing')throw Error('กรุณาเปิดใบเสนอราคาต้นทางก่อน');
    if(!String(quote.number||'').trim()||!(quote.items||[]).some(i=>String(i.desc||'').trim())||totals(quote).subtotal<=0)throw Error('กรุณากรอกเลขใบเสนอราคา รายการ และยอดเงินให้ครบก่อน');
    const source=clone(quote),base=String(quote.number).replace(/QU/i,'BL');
    const prefix=base===quote.number?'BL-'+base:base;
    let number=prefix,index=2;while(existing[number])number=prefix+'-'+index++;
    return {...clone(quote),documentType:'billing',number,date,dueDate:date,billingMode:'amount',billingAmount:totals(quote).subtotal/100,billingPercent:100,withholdingRate:3,withholdingDefaultVersion:1,sourceNumber:quote.number,sourceQuote:source,pdfFileName:number,notes:''};
  }
  const api={totals,createBilling};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TTMBilling=api;
})(typeof globalThis==='object'?globalThis:this);
