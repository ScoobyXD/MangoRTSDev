import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyAttachmentPresentation,
  classifyAttachmentPreview,
  splitAttachmentFilename,
} from "../../../../frontend/src/modules/attachments/attachmentPresentation.js";

test("attachment filename presentation isolates and normalizes only the final extension", () => {
  assert.deepEqual(splitAttachmentFilename("  Quarterly.Report.Final.xlsx  "), {
    filename: "Quarterly.Report.Final.xlsx",
    baseName: "Quarterly.Report.Final",
    extensionLabel: ".XLSX",
  });
  assert.deepEqual(splitAttachmentFilename("C:\\uploads\\archive.tar.gz"), {
    filename: "archive.tar.gz",
    baseName: "archive.tar",
    extensionLabel: ".GZ",
  });
  assert.deepEqual(splitAttachmentFilename("report. pdf"), {
    filename: "report. pdf",
    baseName: "report",
    extensionLabel: ".PDF",
  });
});

test("attachment filename presentation handles hidden, terminal-dot, and empty names", () => {
  assert.equal(splitAttachmentFilename(".env").extensionLabel, "NO EXT");
  assert.equal(splitAttachmentFilename("report.").extensionLabel, "NO EXT");
  assert.deepEqual(splitAttachmentFilename("   "), {
    filename: "Attachment",
    baseName: "Attachment",
    extensionLabel: "NO EXT",
  });
});

test("recognized final extensions are authoritative over generic or spoofed MIME types", () => {
  assert.equal(classifyAttachmentPresentation({ filename: "budget.csv", mimeType: "audio/mpeg" }), "spreadsheet");
  assert.equal(classifyAttachmentPresentation({ filename: "photo.JPG", mimeType: "application/octet-stream" }), "image");
  assert.equal(classifyAttachmentPresentation({ filename: "brief.docx", mimeType: "video/mp4" }), "document");
  assert.equal(classifyAttachmentPresentation({ filename: "deck.pptx", mimeType: "text/plain" }), "presentation");
  assert.equal(classifyAttachmentPresentation({ filename: "contract.pdf", mimeType: "application/octet-stream" }), "pdf");
  assert.equal(classifyAttachmentPresentation({ filename: "source.ts", mimeType: "application/octet-stream" }), "text");
  assert.equal(classifyAttachmentPresentation({ filename: "bundle.7z", mimeType: "application/octet-stream" }), "archive");
  assert.equal(classifyAttachmentPresentation({ filename: "recording.mp3", mimeType: "application/octet-stream" }), "audio");
  assert.equal(classifyAttachmentPresentation({ filename: "clip.mp4", mimeType: "application/octet-stream" }), "video");
});

test("MIME type classifies extensionless attachments and unknown inputs stay generic", () => {
  assert.equal(classifyAttachmentPresentation({ filename: "camera-upload", mimeType: "image/webp" }), "image");
  assert.equal(classifyAttachmentPresentation({ filename: "notes", mimeType: "text/plain; charset=utf-8" }), "text");
  assert.equal(classifyAttachmentPresentation({ filename: "opaque", mimeType: "application/octet-stream" }), "generic");
});

test("attachment preview classification permits browser-safe formats and rejects binary document formats", () => {
  assert.equal(classifyAttachmentPreview({ filename: "photo.png", mimeType: "application/octet-stream" }), "image");
  assert.equal(classifyAttachmentPreview({ filename: "report.pdf", mimeType: "application/octet-stream" }), "pdf");
  assert.equal(classifyAttachmentPreview({ filename: "records.csv", mimeType: "application/vnd.ms-excel" }), "text");
  assert.equal(classifyAttachmentPreview({ filename: "payload.json", mimeType: "application/json" }), "text");
  assert.equal(classifyAttachmentPreview({ filename: "track", mimeType: "audio/mpeg" }), "audio");
  assert.equal(classifyAttachmentPreview({ filename: "movie.webm", mimeType: "application/octet-stream" }), "video");
  assert.equal(classifyAttachmentPreview({ filename: "proposal.docx", mimeType: "application/octet-stream" }), "unavailable");
  assert.equal(classifyAttachmentPreview({ filename: "archive.zip", mimeType: "application/zip" }), "unavailable");
  assert.equal(classifyAttachmentPreview({ filename: "opaque.bin", mimeType: "application/octet-stream" }), "unavailable");
});
