const {test}=require('node:test');
const assert=require('node:assert/strict');
const {totals,createBilling}=require('./billing-model.js');
const quote={number:'TTM-2026-QU-144',vat:7,customer:'Test',items:[{desc:'Design',qty:134,price:1000}]};
test('full and half installments, VAT and withholding in satang',()=>{
 const bill=createBilling(quote,{},'2026-10-18');
 assert.equal(bill.number,'TTM-2026-BL-144');assert.equal(bill.withholdingRate,3);
 assert.deepEqual([totals(bill).subtotal,totals(bill).vat,totals(bill).net],[13400000,938000,13936000]);
 bill.billingMode='percent';bill.billingPercent=50;bill.withholdingRate=3;
 assert.deepEqual([totals(bill).subtotal,totals(bill).vat,totals(bill).withholding,totals(bill).net],[6700000,469000,201000,6968000]);
});
test('source snapshot survives billing edits and duplicate numbering',()=>{
 const bill=createBilling(quote,{'TTM-2026-BL-144':{}},'2026-10-18');
 bill.items[0].price=1;
 assert.equal(quote.items[0].price,1000);assert.equal(bill.sourceQuote.items[0].price,1000);
 assert.equal(bill.number,'TTM-2026-BL-144-2');
});
test('round line amounts then taxes and reject invalid percentage',()=>{
 const doc={items:[{qty:3,price:0.335},{qty:1,price:0.1}],vat:7};
 assert.equal(totals(doc).subtotal,111);assert.equal(totals(doc).vat,8);
 assert.equal(totals({...doc,vat:0}).net,111);
 assert.throws(()=>totals({...doc,documentType:'billing',billingPercent:0}));
 assert.throws(()=>createBilling({...quote,number:''}));
});

test('explicit billing amount drives VAT and withholding regardless of quote value',()=>{
 const bill=createBilling(quote,{},'2026-10-18');bill.billingAmount=50000;bill.withholdingRate=3;
 const t=totals(bill);assert.deepEqual([t.subtotal,t.vat,t.withholding,t.net],[5000000,350000,150000,5200000]);
 assert.throws(()=>totals({...bill,billingAmount:''}));assert.throws(()=>totals({...bill,billingAmount:-1}));
});
