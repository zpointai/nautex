import mammoth from "mammoth";
import * as XLSX from "xlsx";

export interface UploadedDocumentPayload {
  name?: unknown;
  data?: unknown;
  text?: unknown;
  mimeType?: unknown;
  type?: unknown;
}

export interface ExtractedDocument {
  fileName: string | null;
  mimeType: string;
  text: string;
  warnings: string[];
}

function getFileName(file: unknown) {
  if (!file || typeof file !== "object") return null;
  const name = (file as UploadedDocumentPayload).name;
  return typeof name === "string" ? name : null;
}

function getMimeType(file: unknown) {
  if (!file || typeof file !== "object") return "";
  const payload = file as UploadedDocumentPayload;
  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : typeof payload.type === "string" ? payload.type : "";
  return mimeType.toLowerCase();
}

function getBuffer(file: unknown) {
  if (!file || typeof file !== "object") return null;
  const payload = file as UploadedDocumentPayload;
  if (typeof payload.data !== "string") return null;
  try {
    return Buffer.from(payload.data, "base64");
  } catch {
    return null;
  }
}

function ext(fileName: string | null) {
  const match = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function workbookToText(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false, cellDates: false });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return [`# Sheet: ${sheetName}`, csv].join("\n");
  }).join("\n\n");
}

async function pdfToText(buffer: Buffer) {
  // PDF.js needs a DOMMatrix even for text extraction. Supply a JavaScript
  // implementation so desktop text extraction does not require native Canvas.
  // Raster rendering and OCR are not part of this document extraction path.
  if (typeof globalThis.DOMMatrix === "undefined") {
    const { default: DOMMatrix } = await import("@thednp/dommatrix");
    Object.defineProperty(globalThis, "DOMMatrix", { value: DOMMatrix, configurable: true, writable: true });
  }
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    // Generated page separators are not source text. They must not make a
    // scanned/empty PDF appear to contain selectable document content.
    const parsed = await parser.getText({ pageJoiner: "" });
    return parsed.text ?? "";
  } finally {
    await parser.destroy();
  }
}

export async function extractUploadedDocument(file: unknown): Promise<ExtractedDocument> {
  const fileName = getFileName(file);
  const mimeType = getMimeType(file);
  const extension = ext(fileName);
  const warnings: string[] = [];

  if (!file || typeof file !== "object") {
    return { fileName, mimeType, text: "", warnings: ["No file payload was provided."] };
  }

  const payload = file as UploadedDocumentPayload;
  if (typeof payload.text === "string" && payload.text.trim()) {
    return { fileName, mimeType, text: payload.text, warnings };
  }

  const buffer = getBuffer(file);
  if (!buffer) {
    return { fileName, mimeType, text: "", warnings: ["The uploaded file payload could not be decoded."] };
  }

  try {
    if (mimeType.includes("pdf") || extension === "pdf") {
      const text = await pdfToText(buffer);
      if (!text.trim()) warnings.push("PDF text extraction returned no selectable text. The document may be scanned or image-only.");
      return { fileName, mimeType: mimeType || "application/pdf", text, warnings };
    }

    if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || ["xlsx", "xls", "csv"].includes(extension)) {
      const text = workbookToText(buffer);
      if (!text.trim()) warnings.push("Spreadsheet extraction returned no rows.");
      return { fileName, mimeType, text, warnings };
    }

    if (mimeType.includes("wordprocessingml") || extension === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value ?? "";
      const mammothWarnings = result.messages?.map((message) => message.message).filter(Boolean) ?? [];
      return { fileName, mimeType, text, warnings: [...warnings, ...mammothWarnings] };
    }

    return { fileName, mimeType, text: buffer.toString("utf8"), warnings };
  } catch (error) {
    return {
      fileName,
      mimeType,
      text: "",
      warnings: [error instanceof Error ? error.message : "Document extraction failed."],
    };
  }
}
