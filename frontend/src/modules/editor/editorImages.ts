export const EDITOR_IMAGE_NODE_ATTRIBUTE = "data-mango-editor-image";
export const EDITOR_IMAGE_ID_ATTRIBUTE = "data-mango-editor-image-id";
export const EDITOR_IMAGE_WRAP_ATTRIBUTE = "data-mango-editor-image-wrap";
export const EDITOR_IMAGE_SELECTED_ATTRIBUTE = "data-mango-editor-image-selected";

const SAFE_IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+=*$/i;
const MAX_STORED_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_STORED_IMAGE_BYTES = 512 * 1024;
const TARGET_EDITOR_DOCUMENT_HTML_BYTES = 12 * 1024 * 1024;
const MAX_EDITOR_IMAGE_WIDTH_PX = 960;
const MAX_EDITOR_IMAGE_HEIGHT_PX = 1_600;
const MAX_COMPRESSED_IMAGE_EDGE_PX = 4_096;
const MIN_EDITOR_IMAGE_WIDTH_PX = 48;
const MIN_EDITOR_IMAGE_HEIGHT_PX = 36;
export const EDITOR_IMAGE_MAX_WIDTH_INSET_PX = 32;
export const DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX = 4;

export type EditorImageFloatSide = "left" | "right";
export type EditorImagePointerInteraction =
  | { kind: "drag" }
  | { kind: "resize"; horizontal: -1 | 0 | 1; vertical: -1 | 0 | 1 };

export type EditorImageData = {
  src: string;
  id?: string;
  width: number;
  height: number;
  marginLeft?: number;
  marginTop?: number;
  floatSide?: EditorImageFloatSide;
};

export type EditorImageClipboardData = Omit<EditorImageData, "width" | "height"> & {
  width?: number;
  height?: number;
};

export function isSafeEditorImageSource(src: string): boolean {
  return SAFE_IMAGE_DATA_URL_PATTERN.test(src.trim());
}

export function createEditorImageFrame(ownerDocument: Document, data: EditorImageData): HTMLSpanElement {
  const frame = ownerDocument.createElement("span");
  frame.setAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE, "true");
  frame.setAttribute(EDITOR_IMAGE_ID_ATTRIBUTE, data.id?.trim() || createEditorImageID());
  frame.setAttribute(EDITOR_IMAGE_WRAP_ATTRIBUTE, "false");
  frame.setAttribute("contenteditable", "false");
  applyEditorImageFloatLayout(frame, data.floatSide ?? "left", data.marginLeft ?? 0);
  applyEditorImageFrameSize(frame, data.width, data.height);
  frame.style.marginTop = `${clampImageVerticalOffset(data.marginTop ?? DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX)}px`;
  frame.style.marginBottom = "8px";
  frame.style.resize = "none";
  frame.style.overflow = "hidden";
  frame.style.position = "relative";
  frame.style.lineHeight = "0";
  frame.style.verticalAlign = "top";
  frame.style.cursor = "move";

  const image = ownerDocument.createElement("img");
  image.alt = "";
  image.draggable = false;
  image.style.display = "block";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "fill";
  image.style.pointerEvents = "none";
  image.src = data.src;
  frame.appendChild(image);
  return frame;
}

export function readEditorImageData(source: HTMLElement): EditorImageData | null {
  if (source.getAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE) !== "true") return null;
  const image = source.querySelector("img[src]") as HTMLImageElement | null;
  const src = image?.getAttribute("src")?.trim() ?? "";
  if (!isSafeEditorImageSource(src)) return null;
  const width = readSafeStylePixels(source.style.width, 220, MIN_EDITOR_IMAGE_WIDTH_PX, MAX_EDITOR_IMAGE_WIDTH_PX);
  const height = readSafeStylePixels(source.style.height, 160, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_HEIGHT_PX);
  const floatSide = readEditorImageFloatSide(source);
  const marginLeft = readEditorImageInlineOffset(source);
  const marginTop = readSafeStylePixels(source.style.marginTop, DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX, -5_000, 5_000);
  return {
    src,
    id: source.getAttribute(EDITOR_IMAGE_ID_ATTRIBUTE) ?? undefined,
    width,
    height,
    marginLeft,
    marginTop,
    floatSide,
  };
}

export function createEditorImageClipboardHTML(ownerDocument: Document, data: EditorImageData): string {
  const frame = createEditorImageFrame(ownerDocument, { ...data, id: undefined });
  frame.removeAttribute(EDITOR_IMAGE_SELECTED_ATTRIBUTE);
  return frame.outerHTML;
}

export function createStandaloneImageClipboardHTML(src: string, alt = "Image"): string {
  if (!isSafeEditorImageSource(src)) return "";
  return `<img src="${src}" alt="${escapeHTMLAttribute(alt)}">`;
}

export function writeImageClipboardData(clipboardData: DataTransfer, src: string, html: string, plainText = "Image"): boolean {
  if (!isSafeEditorImageSource(src) || !html.trim()) return false;
  clipboardData.setData("text/html", html);
  clipboardData.setData("text/plain", plainText.trim() || "Image");
  return true;
}

export function writeImageToSystemClipboard(src: string, html: string, plainText = "Image"): boolean {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") return false;
  const imageBlob = createEditorImageBlob(src);
  if (!imageBlob) return false;
  const supportsType = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
  const itemPayload: Record<string, Blob> = {};
  const addClipboardType = (type: string, blob: Blob) => {
    if (typeof supportsType === "function" && !supportsType(type)) return;
    itemPayload[type] = blob;
  };
  addClipboardType(imageBlob.type, imageBlob);
  addClipboardType("text/html", new Blob([html], { type: "text/html" }));
  addClipboardType("text/plain", new Blob([plainText.trim() || "Image"], { type: "text/plain" }));
  if (Object.keys(itemPayload).length === 0) return false;
  void clipboard.write([
    new ClipboardItem(itemPayload),
  ]).catch(() => undefined);
  return true;
}

export function readEditorImageClipboardDataFromHTML(ownerDocument: Document, html: string): EditorImageClipboardData | null {
  if (!html.trim()) return null;
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;

  const copiedFrame = template.content.querySelector(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`);
  if (copiedFrame instanceof HTMLElement) {
    const data = readEditorImageData(copiedFrame);
    return data ? { ...data, id: undefined } : null;
  }

  const image = template.content.querySelector("img[src]") as HTMLImageElement | null;
  if (!image) return null;
  const src = image.getAttribute("src")?.trim() ?? "";
  if (!isSafeEditorImageSource(src)) return null;

  const width = readOptionalImageDimension(image.getAttribute("width") ?? image.style.width, MIN_EDITOR_IMAGE_WIDTH_PX, MAX_EDITOR_IMAGE_WIDTH_PX);
  const height = readOptionalImageDimension(image.getAttribute("height") ?? image.style.height, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_HEIGHT_PX);
  return { src, width, height };
}

export function findEditorImageFrame(root: HTMLElement, target: EventTarget | null): HTMLSpanElement | null {
  if (!(target instanceof Element)) return null;
  const frame = target.closest(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`);
  return frame instanceof HTMLSpanElement && root.contains(frame) ? frame : null;
}

export function clearEditorImageSelection(root: HTMLElement) {
  root.querySelectorAll(`span[${EDITOR_IMAGE_SELECTED_ATTRIBUTE}="true"]`).forEach((node) => {
    if (node instanceof HTMLElement) node.removeAttribute(EDITOR_IMAGE_SELECTED_ATTRIBUTE);
  });
}

export function selectEditorImageFrame(root: HTMLElement, frame: HTMLElement) {
  clearEditorImageSelection(root);
  frame.setAttribute(EDITOR_IMAGE_SELECTED_ATTRIBUTE, "true");
}

export function getSelectedEditorImageFrame(root: HTMLElement): HTMLSpanElement | null {
  const frame = root.querySelector(`span[${EDITOR_IMAGE_SELECTED_ATTRIBUTE}="true"]`);
  return frame instanceof HTMLSpanElement && root.contains(frame) ? frame : null;
}

export function clampEditorImageOffset(value: number, maxValue: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxValue, Math.round(value)));
}

export function clampEditorImageVerticalOffset(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(minValue, Math.min(maxValue, Math.round(value)));
}

export function clampEditorImageSize(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return minValue;
  return Math.max(minValue, Math.min(maxValue, Math.round(value)));
}

export function getEditorImageStorageBudgetForDocumentBytes(currentDocumentBytes: number): number {
  if (!Number.isFinite(currentDocumentBytes) || currentDocumentBytes <= 0) return MAX_STORED_IMAGE_BYTES;
  const remainingHTMLBytes = TARGET_EDITOR_DOCUMENT_HTML_BYTES - Math.round(currentDocumentBytes);
  const estimatedRawImageBytes = Math.floor(remainingHTMLBytes * 0.68);
  return clampEditorImageSize(estimatedRawImageBytes, MIN_STORED_IMAGE_BYTES, MAX_STORED_IMAGE_BYTES);
}

export function estimateEditorDocumentBytes(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return value.length;
}

export function readEditorImageFloatSide(source: HTMLElement): EditorImageFloatSide {
  return source.style.float === "right" || source.style.marginLeft === "auto" ? "right" : "left";
}

export function readEditorImageInlineOffset(source: HTMLElement): number {
  const floatSide = readEditorImageFloatSide(source);
  const primaryValue = floatSide === "right" ? source.style.marginRight : source.style.marginLeft;
  const fallbackValue = floatSide === "right" ? source.style.marginLeft : source.style.marginRight;
  return readSafeStylePixels(primaryValue || fallbackValue, 0, 0, 5_000);
}

export function applyEditorImageFloatLayout(frame: HTMLElement, floatSide: EditorImageFloatSide, inlineOffset: number) {
  const offset = clampImageOffset(inlineOffset);
  frame.style.float = "none";
  frame.style.clear = "both";
  frame.style.display = "block";
  if (floatSide === "right") {
    frame.style.marginLeft = "auto";
    frame.style.marginRight = `${offset}px`;
    return;
  }
  frame.style.marginLeft = `${offset}px`;
  frame.style.marginRight = "0";
}

export function getEditorImageHorizontalLimit(containerWidth: number, imageWidth: number): number {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(imageWidth)) return 0;
  return Math.max(0, Math.round(containerWidth - imageWidth));
}

export function getEditorImageFloatSideForVisualLeft(containerWidth: number, imageWidth: number, visualLeft: number): EditorImageFloatSide {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(imageWidth) || !Number.isFinite(visualLeft)) return "left";
  return visualLeft + imageWidth / 2 > containerWidth / 2 ? "right" : "left";
}

export function getEditorImageInlineOffsetForVisualLeft(containerWidth: number, imageWidth: number, floatSide: EditorImageFloatSide, visualLeft: number): number {
  const maxLeft = getEditorImageHorizontalLimit(containerWidth, imageWidth);
  const left = clampEditorImageOffset(visualLeft, maxLeft);
  return floatSide === "right"
    ? clampEditorImageOffset(maxLeft - left, maxLeft)
    : left;
}

export function getEditorImageVisualLeftForInlineOffset(containerWidth: number, imageWidth: number, floatSide: EditorImageFloatSide, inlineOffset: number): number {
  const maxLeft = getEditorImageHorizontalLimit(containerWidth, imageWidth);
  const offset = clampEditorImageOffset(inlineOffset, maxLeft);
  return floatSide === "right" ? maxLeft - offset : offset;
}

export function getEditorImagePointerInteraction(width: number, height: number, pointerX: number, pointerY: number, edgeSize = 8): EditorImagePointerInteraction {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { kind: "drag" };
  const safeEdgeSize = Math.max(6, Math.min(edgeSize, width / 2, height / 2));
  const horizontal = pointerX <= safeEdgeSize ? -1 : pointerX >= width - safeEdgeSize ? 1 : 0;
  const vertical = pointerY <= safeEdgeSize ? -1 : pointerY >= height - safeEdgeSize ? 1 : 0;
  return horizontal || vertical ? { kind: "resize", horizontal, vertical } : { kind: "drag" };
}

export function getEditorImageCursorForInteraction(interaction: EditorImagePointerInteraction): string {
  if (interaction.kind === "drag") return "move";
  const { horizontal, vertical } = interaction;
  if (horizontal && vertical) return horizontal === vertical ? "nwse-resize" : "nesw-resize";
  if (horizontal) return "ew-resize";
  return "ns-resize";
}

export function readEditorImageAspectRatio(frame: HTMLElement, fallbackRatio = 1): number {
  const width = readSafeStylePixels(frame.style.width, 0, MIN_EDITOR_IMAGE_WIDTH_PX, MAX_EDITOR_IMAGE_WIDTH_PX);
  const height = readSafeStylePixels(frame.style.height, 0, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_HEIGHT_PX);
  if (width > 0 && height > 0) return width / height;
  const image = frame.querySelector("img[src]") as HTMLImageElement | null;
  const naturalWidth = image?.naturalWidth ?? 0;
  const naturalHeight = image?.naturalHeight ?? 0;
  if (naturalWidth > 0 && naturalHeight > 0) return naturalWidth / naturalHeight;
  return Number.isFinite(fallbackRatio) && fallbackRatio > 0 ? fallbackRatio : 1;
}

export function createEditorImageBlob(src: string): Blob | null {
  if (!isSafeEditorImageSource(src) || typeof atob === "undefined" || typeof Blob === "undefined") return null;
  const commaIndex = src.indexOf(",");
  if (commaIndex < 0) return null;
  const mimeMatch = /^data:([^;,]+);base64/i.exec(src.slice(0, commaIndex));
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const binary = atob(src.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function createEditorImageDataFromFile(file: File, maxDisplayWidth: number, maxStoredBytes = MAX_STORED_IMAGE_BYTES): Promise<EditorImageData> {
  const rawSource = await readFileAsDataURL(file);
  return createEditorImageDataFromSource(rawSource, maxDisplayWidth, { maxStoredBytes });
}

export async function createEditorImageDataFromSource(
  rawSource: string,
  maxDisplayWidth: number,
  options: {
    maxStoredBytes?: number;
    preferredWidth?: number;
    preferredHeight?: number;
    marginLeft?: number;
    marginTop?: number;
    floatSide?: EditorImageFloatSide;
  } = {},
): Promise<EditorImageData> {
  const source = isSafeEditorImageSource(rawSource) ? rawSource : "";
  if (!source) throw new Error("unsupported_image_type");
  const image = await loadImage(source);
  const dimensions = resolveEditorImageDisplaySize(image, maxDisplayWidth, options.preferredWidth, options.preferredHeight);
  const maxImageBytes = clampEditorImageSize(options.maxStoredBytes ?? MAX_STORED_IMAGE_BYTES, MIN_STORED_IMAGE_BYTES, MAX_STORED_IMAGE_BYTES);
  const src = imageDataURLByteLength(source) <= maxImageBytes
    ? source
    : compressImageToDataURL(image, maxImageBytes);
  if (!isSafeEditorImageSource(src)) throw new Error("failed_to_prepare_image");
  return {
    src,
    width: dimensions.width,
    height: dimensions.height,
    marginLeft: options.marginLeft,
    marginTop: options.marginTop,
    floatSide: options.floatSide,
  };
}

function createEditorImageID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHTMLAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readSafeStylePixels(value: string, fallback: number, minValue: number, maxValue: number): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, Math.round(parsed)));
}

function readOptionalImageDimension(value: string, minValue: number, maxValue: number): number | undefined {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(minValue, Math.min(maxValue, Math.round(parsed)));
}

function clampImageDimension(value: number, minValue: number): number {
  const maxValue = minValue === MIN_EDITOR_IMAGE_HEIGHT_PX ? MAX_EDITOR_IMAGE_HEIGHT_PX : MAX_EDITOR_IMAGE_WIDTH_PX;
  return clampEditorImageSize(value, minValue, maxValue);
}

function clampImageOffset(value: number): number {
  return clampEditorImageOffset(value, 5_000);
}

function clampImageVerticalOffset(value: number): number {
  return clampEditorImageVerticalOffset(value, -5_000, 5_000);
}

function applyEditorImageFrameSize(frame: HTMLElement, width: number, height: number) {
  const nextWidth = clampImageDimension(width, MIN_EDITOR_IMAGE_WIDTH_PX);
  const nextHeight = clampImageDimension(height, MIN_EDITOR_IMAGE_HEIGHT_PX);
  frame.style.width = `${nextWidth}px`;
  frame.style.height = `${nextHeight}px`;
  frame.style.aspectRatio = `${nextWidth} / ${nextHeight}`;
}

function resolveEditorImageDisplaySize(image: HTMLImageElement, maxDisplayWidth: number, preferredWidth?: number, preferredHeight?: number): { width: number; height: number } {
  const naturalWidth = Math.max(1, image.naturalWidth || preferredWidth || maxDisplayWidth || 220);
  const naturalHeight = Math.max(1, image.naturalHeight || preferredHeight || naturalWidth);
  const naturalAspectRatio = naturalWidth / naturalHeight;
  let width = preferredWidth && preferredWidth > 0 ? preferredWidth : Math.min(naturalWidth, maxDisplayWidth, MAX_EDITOR_IMAGE_WIDTH_PX);
  let height = preferredHeight && preferredHeight > 0 ? preferredHeight : Math.round(width / naturalAspectRatio);

  if (preferredWidth && preferredWidth > 0 && (!preferredHeight || preferredHeight <= 0)) height = Math.round(preferredWidth / naturalAspectRatio);
  if (preferredHeight && preferredHeight > 0 && (!preferredWidth || preferredWidth <= 0)) width = Math.round(preferredHeight * naturalAspectRatio);

  const maxWidth = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.min(maxDisplayWidth || MAX_EDITOR_IMAGE_WIDTH_PX, MAX_EDITOR_IMAGE_WIDTH_PX));
  const scale = Math.min(1, maxWidth / Math.max(1, width), MAX_EDITOR_IMAGE_HEIGHT_PX / Math.max(1, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  return {
    width: clampEditorImageSize(width, MIN_EDITOR_IMAGE_WIDTH_PX, maxWidth),
    height: clampEditorImageSize(height, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_HEIGHT_PX),
  };
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : ""));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("failed_to_read_image")));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("failed_to_load_image")));
    image.src = src;
  });
}

function compressImageToDataURL(image: HTMLImageElement, maxStoredBytes: number): string {
  const naturalWidth = Math.max(1, image.naturalWidth || MAX_EDITOR_IMAGE_WIDTH_PX);
  const naturalHeight = Math.max(1, image.naturalHeight || naturalWidth);
  const edgeScale = Math.min(1, MAX_COMPRESSED_IMAGE_EDGE_PX / Math.max(naturalWidth, naturalHeight));
  const startWidth = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.round(naturalWidth * edgeScale));
  const startHeight = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round(naturalHeight * edgeScale));
  const pngOutput = compressImageLosslessFirst(image, startWidth, startHeight, maxStoredBytes);
  if (imageDataURLByteLength(pngOutput) <= maxStoredBytes) return pngOutput;
  return compressImageLossy(image, startWidth, startHeight, maxStoredBytes, pngOutput);
}

function compressImageLosslessFirst(image: HTMLImageElement, startWidth: number, startHeight: number, maxStoredBytes: number): string {
  let nextWidth = startWidth;
  let nextHeight = startHeight;
  let output = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    output = renderImageToDataURL(image, nextWidth, nextHeight, "image/png");
    if (imageDataURLByteLength(output) <= maxStoredBytes) return output;
    nextWidth = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.round(nextWidth * 0.88));
    nextHeight = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round(nextHeight * 0.88));
  }
  return output;
}

function compressImageLossy(image: HTMLImageElement, startWidth: number, startHeight: number, maxStoredBytes: number, fallbackOutput: string): string {
  let nextWidth = startWidth;
  let nextHeight = startHeight;
  let quality = 0.94;
  let output = fallbackOutput;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    output = renderImageToDataURL(image, nextWidth, nextHeight, "image/jpeg", quality);
    if (imageDataURLByteLength(output) <= maxStoredBytes) return output;
    if (quality > 0.78) {
      quality -= 0.04;
    } else if (quality > 0.62) {
      quality -= 0.08;
    } else {
      nextWidth = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.round(nextWidth * 0.86));
      nextHeight = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round(nextHeight * 0.86));
      quality = 0.86;
    }
  }
  return output;
}

function renderImageToDataURL(image: HTMLImageElement, width: number, height: number, type: "image/png" | "image/jpeg", quality?: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.round(width));
  canvas.height = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return "";
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

function imageDataURLByteLength(dataURL: string): number {
  const commaIndex = dataURL.indexOf(",");
  const encoded = commaIndex >= 0 ? dataURL.slice(commaIndex + 1) : dataURL;
  return Math.ceil(encoded.length * 0.75);
}
