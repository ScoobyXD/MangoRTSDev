export type AttachmentPresentationKind =
  | "image"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "pdf"
  | "archive"
  | "text"
  | "audio"
  | "video"
  | "generic";

export type AttachmentPreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "unavailable";

export type AttachmentFilenamePresentation = {
  filename: string;
  baseName: string;
  extensionLabel: string;
};

export type AttachmentPresentationInput = {
  filename?: string;
  mimeType?: string;
};

const EXTENSIONLESS_LABEL = "NO EXT";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "numbers", "ods", "xls", "xlsb", "xlsm", "xlsx"]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docm", "docx", "odt", "pages", "rtf"]);
const PRESENTATION_EXTENSIONS = new Set(["key", "odp", "ppt", "pptm", "pptx"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "cab", "gz", "rar", "tar", "tgz", "xz", "zip", "zst"]);
const TEXT_EXTENSIONS = new Set(["c", "cc", "conf", "cpp", "cs", "css", "go", "h", "hpp", "html", "ini", "java", "js", "json", "jsx", "log", "md", "php", "py", "rb", "rs", "sh", "sql", "text", "toml", "ts", "tsx", "tsv", "txt", "vue", "xml", "yaml", "yml"]);
const AUDIO_EXTENSIONS = new Set(["aac", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "wma"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm", "wmv"]);

export function splitAttachmentFilename(value: string): AttachmentFilenamePresentation {
  const trimmed = value.trim();
  const filename = trimmed.split(/[\\/]/).pop()?.trim() || "Attachment";
  const finalDotIndex = filename.lastIndexOf(".");
  if (finalDotIndex <= 0 || finalDotIndex >= filename.length - 1) {
    return { filename, baseName: filename, extensionLabel: EXTENSIONLESS_LABEL };
  }
  const rawExtension = filename.slice(finalDotIndex + 1).trim();
  const baseName = filename.slice(0, finalDotIndex).trimEnd();
  if (!rawExtension || !baseName) {
    return { filename, baseName: filename, extensionLabel: EXTENSIONLESS_LABEL };
  }
  return {
    filename,
    baseName,
    extensionLabel: `.${rawExtension.toLocaleUpperCase("en-US")}`,
  };
}

export function classifyAttachmentPresentation(input: AttachmentPresentationInput): AttachmentPresentationKind {
  const mimeType = input.mimeType?.trim().toLowerCase().split(";", 1)[0] ?? "";
  const { extensionLabel } = splitAttachmentFilename(input.filename ?? "");
  const extension = extensionLabel === EXTENSIONLESS_LABEL ? "" : extensionLabel.slice(1).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (PRESENTATION_EXTENSIONS.has(extension)) return "presentation";
  if (extension === "pdf") return "pdf";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("spreadsheet") || mimeType.includes("ms-excel") || mimeType.includes("iwork-numbers") || mimeType === "text/csv") return "spreadsheet";
  if (mimeType.includes("wordprocessingml") || mimeType === "application/msword" || mimeType.includes("opendocument.text") || mimeType === "application/rtf") return "document";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint") || mimeType.includes("iwork-keynote")) return "presentation";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("archive") || mimeType === "application/x-tar" || mimeType === "application/gzip") return "archive";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.includes("xml") || mimeType.includes("yaml")) return "text";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "generic";
}

export function classifyAttachmentPreview(input: AttachmentPresentationInput): AttachmentPreviewKind {
  const presentationKind = classifyAttachmentPresentation(input);
  const { extensionLabel } = splitAttachmentFilename(input.filename ?? "");
  const extension = extensionLabel === EXTENSIONLESS_LABEL ? "" : extensionLabel.slice(1).toLowerCase();
  if (extension === "csv" || TEXT_EXTENSIONS.has(extension)) return "text";
  if (presentationKind === "image" || presentationKind === "pdf" || presentationKind === "audio" || presentationKind === "video" || presentationKind === "text") return presentationKind;
  return "unavailable";
}
