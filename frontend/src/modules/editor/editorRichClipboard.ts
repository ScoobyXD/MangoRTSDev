import {
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  createEditorImageFrame,
  editorAttachmentIDFromImageSource,
  isSafeEditorImageSource,
  readEditorImageData,
  type EditorImageClipboardData,
  type EditorImageData,
} from "./editorImages.js";
import {
  EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE,
  sanitizeEditorDocumentHTML,
} from "./richTextEditing.js";

const EDITOR_RICH_CLIPBOARD_IMAGE_CONCURRENCY = 3;
const EDITOR_RICH_CLIPBOARD_FAILED_IMAGE_TEXT = "[Image could not be imported]";

export type EditorRichClipboardImageSourceKind = "attachment" | "data" | "remote" | "blob" | "unsupported";

export type EditorRichClipboardImageRequest = {
  index: number;
  sourceKind: EditorRichClipboardImageSourceKind;
  source: string;
  alt?: string;
  filename?: string;
  width?: number;
  height?: number;
  attachmentData?: EditorImageClipboardData;
};

export type EditorRichClipboardImportResult = {
  html: string;
  imageCount: number;
  importedImageCount: number;
  failedImageCount: number;
};

export type EditorRichClipboardImageResolver = (
  request: EditorRichClipboardImageRequest,
) => Promise<EditorImageData>;

type EditorRichClipboardCandidate = {
  request: EditorRichClipboardImageRequest;
  target: Element;
};

function readClipboardImageSource(image: HTMLImageElement): string {
  const direct = image.getAttribute("src")?.trim() ?? "";
  if (direct) return direct;
  for (const attribute of ["data-src", "data-original-src", "data-original"]) {
    const value = image.getAttribute(attribute)?.trim() ?? "";
    if (value) return value;
  }
  const srcset = image.getAttribute("srcset")?.trim() ?? "";
  if (!srcset || srcset.startsWith("data:")) return "";
  const candidates = srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0]?.trim() ?? "")
    .filter(Boolean);
  return candidates[candidates.length - 1] ?? "";
}

function readClipboardImageDimension(image: HTMLImageElement, dimension: "width" | "height"): number | undefined {
  const attributeValue = Number.parseInt(image.getAttribute(dimension) ?? "", 10);
  if (Number.isFinite(attributeValue) && attributeValue > 0) return attributeValue;
  const styleValue = image.style[dimension].trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)px$/i.exec(styleValue);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function filenameForClipboardImage(source: string, alt: string, attachmentData?: EditorImageClipboardData): string | undefined {
  const durableFilename = attachmentData?.filename?.trim();
  if (durableFilename) return durableFilename;
  if (/^https?:\/\//i.test(source)) {
    try {
      const pathname = new URL(source).pathname;
      const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
      const decoded = decodeURIComponent(lastSegment).trim();
      if (decoded && decoded !== ".") return decoded.slice(0, 240);
    } catch {
      // The backend performs the authoritative URL validation.
    }
  }
  const cleanAlt = alt.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleanAlt ? cleanAlt.slice(0, 200) : undefined;
}

function clipboardImageSourceKind(source: string, attachmentData?: EditorImageClipboardData): EditorRichClipboardImageSourceKind {
  if (attachmentData?.attachmentID?.trim() || editorAttachmentIDFromImageSource(source)) return "attachment";
  if (isSafeEditorImageSource(source)) return "data";
  if (/^https?:\/\//i.test(source)) return "remote";
  if (source.startsWith("blob:")) return "blob";
  return "unsupported";
}

function clipboardImageReplacementTarget(element: Element): Element {
  const parent = element.parentElement;
  if (!(parent instanceof HTMLAnchorElement)) return element;
  const meaningfulChildren = Array.from(parent.childNodes).filter((child) => (
    child.nodeType !== Node.TEXT_NODE || Boolean((child.textContent ?? "").trim())
  ));
  return meaningfulChildren.length === 1 ? parent : element;
}

function collectEditorRichClipboardCandidates(ownerDocument: Document, html: string): {
  template: HTMLTemplateElement;
  candidates: EditorRichClipboardCandidate[];
} {
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;
  const elements = Array.from(template.content.querySelectorAll(
    `span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"], img`,
  ));
  const candidates: EditorRichClipboardCandidate[] = [];
  for (const element of elements) {
    if (element instanceof HTMLImageElement && element.closest(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`)) continue;
    const frame = element instanceof HTMLElement && element.getAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE) === "true"
      ? element
      : null;
    const image = frame?.querySelector("img") ?? element;
    if (!(image instanceof HTMLImageElement)) continue;
    const attachmentData = frame ? readEditorImageData(frame) ?? undefined : undefined;
    const source = attachmentData?.src?.trim() || readClipboardImageSource(image);
    const alt = image.getAttribute("alt")?.trim() ?? "";
    candidates.push({
      target: clipboardImageReplacementTarget(frame ?? image),
      request: {
        index: candidates.length,
        sourceKind: clipboardImageSourceKind(source, attachmentData),
        source,
        alt: alt || undefined,
        filename: filenameForClipboardImage(source, alt, attachmentData),
        width: attachmentData?.width ?? readClipboardImageDimension(image, "width"),
        height: attachmentData?.height ?? readClipboardImageDimension(image, "height"),
        attachmentData,
      },
    });
  }
  return { template, candidates };
}

export function countEditorRichClipboardImages(ownerDocument: Document, html: string): number {
  if (!html.trim()) return 0;
  return collectEditorRichClipboardCandidates(ownerDocument, html).candidates.length;
}

function richClipboardImageCacheKey(request: EditorRichClipboardImageRequest): string {
  const attachmentID = request.attachmentData?.attachmentID?.trim()
    || editorAttachmentIDFromImageSource(request.source);
  if (attachmentID) return `attachment:${attachmentID}`;
  return `${request.sourceKind}:${request.source}`;
}

function createEditorRichClipboardClearBreak(ownerDocument: Document): HTMLBRElement {
  const clearBreak = ownerDocument.createElement("br");
  clearBreak.setAttribute(EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE, "true");
  clearBreak.setAttribute("clear", "all");
  clearBreak.style.clear = "both";
  return clearBreak;
}

function createEditorRichClipboardFailure(ownerDocument: Document, request: EditorRichClipboardImageRequest): HTMLSpanElement {
  const fallback = ownerDocument.createElement("span");
  const alt = request.alt?.trim() ?? "";
  fallback.textContent = alt ? `[Image: ${alt.slice(0, 200)} could not be imported]` : EDITOR_RICH_CLIPBOARD_FAILED_IMAGE_TEXT;
  return fallback;
}

export async function prepareEditorRichClipboardHTML(
  ownerDocument: Document,
  html: string,
  resolveImage: EditorRichClipboardImageResolver,
): Promise<EditorRichClipboardImportResult> {
  const { template, candidates } = collectEditorRichClipboardCandidates(ownerDocument, html);
  if (candidates.length === 0) {
    return {
      html: sanitizeEditorDocumentHTML(html),
      imageCount: 0,
      importedImageCount: 0,
      failedImageCount: 0,
    };
  }

  const results: Array<PromiseSettledResult<EditorImageData> | undefined> = new Array(candidates.length);
  const cachedImports = new Map<string, Promise<EditorImageData>>();
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      const request = candidates[index].request;
      const cacheKey = richClipboardImageCacheKey(request);
      let importPromise = cachedImports.get(cacheKey);
      if (!importPromise) {
        importPromise = resolveImage(request);
        cachedImports.set(cacheKey, importPromise);
      }
      try {
        results[index] = { status: "fulfilled", value: await importPromise };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(EDITOR_RICH_CLIPBOARD_IMAGE_CONCURRENCY, candidates.length) },
    () => worker(),
  ));

  let importedImageCount = 0;
  let failedImageCount = 0;
  candidates.forEach((candidate, index) => {
    const result = results[index];
    if (result?.status === "fulfilled") {
      const resolved = result.value;
      const frame = createEditorImageFrame(ownerDocument, {
        ...resolved,
        alt: resolved.alt ?? candidate.request.alt,
        id: undefined,
      }, { durable: true });
      candidate.target.replaceWith(frame, createEditorRichClipboardClearBreak(ownerDocument));
      importedImageCount += 1;
      return;
    }
    candidate.target.replaceWith(createEditorRichClipboardFailure(ownerDocument, candidate.request));
    failedImageCount += 1;
  });

  return {
    html: sanitizeEditorDocumentHTML(template.innerHTML),
    imageCount: candidates.length,
    importedImageCount,
    failedImageCount,
  };
}
