const test = require("node:test");
const assert = require("node:assert/strict");
const { unsupportedDocumentReason } = require("./attachment-support");

test("archive files are rejected before document analysis", () => {
  assert.match(unsupportedDocumentReason("drawings.ZIP", "application/zip"), /Archive files/);
  assert.match(unsupportedDocumentReason("backup.7z", "application/octet-stream"), /Archive files/);
});

test("generic audio/video files remain rejected", () => {
  assert.match(unsupportedDocumentReason("clip.bin", "video/mp4"), /Audio\/video/);
  assert.match(unsupportedDocumentReason("voice.m4a", "application/octet-stream"), /Audio\/video/);
});

test("supported-looking documents continue to the reader", () => {
  assert.equal(unsupportedDocumentReason("boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), null);
  assert.equal(unsupportedDocumentReason("guide.pdf", "application/pdf"), null);
});
