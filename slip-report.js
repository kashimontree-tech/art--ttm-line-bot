const PDFDocument = require("pdfkit");

async function createSlipPdf(images) {
  if (!images.length) throw new Error("No slip images");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size:"A4",margin:32,autoFirstPage:false});
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      for (const image of images) {
        doc.addPage();
        doc.image(image.bytes, 32, 32, {
          fit:[doc.page.width - 64, doc.page.height - 64],
          align:"center",valign:"center"
        });
      }
      doc.end();
    } catch (err) { reject(err); }
  });
}
module.exports = {createSlipPdf};
