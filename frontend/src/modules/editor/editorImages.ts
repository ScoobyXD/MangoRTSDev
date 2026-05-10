export const EDITOR_IMAGE_NODE_ATTRIBUTE = "data-mango-editor-image";
export const EDITOR_IMAGE_ID_ATTRIBUTE = "data-mango-editor-image-id";
export const EDITOR_IMAGE_WRAP_ATTRIBUTE = "data-mango-editor-image-wrap";
export const EDITOR_IMAGE_SELECTED_ATTRIBUTE = "data-mango-editor-image-selected";

const SAFE_IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+=*$/i;
const MAX_STORED_IMAGE_BYTES = 680_000;
const MAX_EDITOR_IMAGE_DIMENSION_PX = 960;
const MIN_EDITOR_IMAGE_WIDTH_PX = 48;
const MIN_EDITOR_IMAGE_HEIGHT_PX = 36;
const EDITOR_IMAGE_INLINE_TEXT_GAP_PX = 12;

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

export function isSafeEditorImageSource(src: string): boolean {
  return SAFE_IMAGE_DATA_URL_PATTERN.test(src.trim());
}

export function createEditorImageFrame(ownerDocument: Document, data: EditorImageData): HTMLSpanElement {
  const frame = ownerDocument.createElement("span");
  frame.setAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE, "true");
  frame.setAttribute(EDITOR_IMAGE_ID_ATTRIBUTE, data.id?.trim() || createEditorImageID());
  frame.setAttribute(EDITOR_IMAGE_WRAP_ATTRIBUTE, "true");
  frame.setAttribute("contenteditable", "false");
  applyEditorImageFloatLayout(frame, data.floatSide ?? "left", data.marginLeft ?? 0);
  frame.style.width = `${clampImageDimension(data.width, MIN_EDITOR_IMAGE_WIDTH_PX)}px`;
  frame.style.height = `${clampImageDimension(data.height, MIN_EDITOR_IMAGE_HEIGHT_PX)}px`;
  frame.style.marginTop = `${clampImageVerticalOffset(data.marginTop ?? 4)}px`;
  frame.style.marginBottom = "8px";
  frame.style.resize = "none";
  frame.style.overflow = "hidden";
  frame.style.position = "relative";
  frame.style.lineHeight = "0";
  frame.style.verticalAlign = "top";
  frame.style.cursor = "move";

  const image = ownerDocument.createElement("img");
  image.src = data.src;
  image.alt = "";
  image.draggable = false;
  image.style.display = "block";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "contain";
  image.style.pointerEvents = "none";
  frame.appendChild(image);
  return frame;
}

export function readEditorImageData(source: HTMLElement): EditorImageData | null {
  if (source.getAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE) !== "true") return null;
  const image = source.querySelector("img[src]") as HTMLImageElement | null;
  const src = image?.getAttribute("src")?.trim() ?? "";
  if (!isSafeEditorImageSource(src)) return null;
  const width = readSafeStylePixels(source.style.width, 220, MIN_EDITOR_IMAGE_WIDTH_PX, MAX_EDITOR_IMAGE_DIMENSION_PX);
  const height = readSafeStylePixels(source.style.height, 160, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_DIMENSION_PX);
  const floatSide = readEditorImageFloatSide(source);
  const marginLeft = readEditorImageInlineOffset(source);
  const marginTop = readSafeStylePixels(source.style.marginTop, 4, -5_000, 5_000);
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

export function readEditorImageFloatSide(source: HTMLElement): EditorImageFloatSide {
  return source.style.float === "right" ? "right" : "left";
}

export function readEditorImageInlineOffset(source: HTMLElement): number {
  const floatSide = readEditorImageFloatSide(source);
  const primaryValue = floatSide === "right" ? source.style.marginRight : source.style.marginLeft;
  const fallbackValue = floatSide === "right" ? source.style.marginLeft : source.style.marginRight;
  return readSafeStylePixels(primaryValue || fallbackValue, 0, 0, 5_000);
}

export function applyEditorImageFloatLayout(frame: HTMLElement, floatSide: EditorImageFloatSide, inlineOffset: number) {
  const offset = clampImageOffset(inlineOffset);
  frame.style.float = floatSide;
  if (floatSide === "right") {
    frame.style.marginLeft = `${EDITOR_IMAGE_INLINE_TEXT_GAP_PX}px`;
    frame.style.marginRight = `${offset}px`;
    return;
  }
  frame.style.marginLeft = `${offset}px`;
  frame.style.marginRight = `${EDITOR_IMAGE_INLINE_TEXT_GAP_PX}px`;
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

export function getEditorImagePointerInteraction(width: number, height: number, pointerX: number, pointerY: number, edgeSize = 14): EditorImagePointerInteraction {
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

export async function createEditorImageDataFromFile(file: File, maxDisplayWidth: number): Promise<EditorImageData> {
  const rawSource = await readFileAsDataURL(file);
  const source = isSafeEditorImageSource(rawSource) ? rawSource : "";
  if (!source) throw new Error("unsupported_image_type");
  const image = await loadImage(source);
  const displayWidth = Math.min(image.naturalWidth || maxDisplayWidth, maxDisplayWidth, MAX_EDITOR_IMAGE_DIMENSION_PX);
  const scale = displayWidth / Math.max(1, image.naturalWidth || displayWidth);
  const displayHeight = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round((image.naturalHeight || displayWidth) * scale));
  const src = imageDataURLByteLength(source) <= MAX_STORED_IMAGE_BYTES
    ? source
    : compressImageToDataURL(image, displayWidth, displayHeight);
  if (!isSafeEditorImageSource(src)) throw new Error("failed_to_prepare_image");
  return {
    src,
    width: clampEditorImageSize(displayWidth, MIN_EDITOR_IMAGE_WIDTH_PX, maxDisplayWidth),
    height: clampEditorImageSize(displayHeight, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_DIMENSION_PX),
  };
}

function createEditorImageID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readSafeStylePixels(value: string, fallback: number, minValue: number, maxValue: number): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, Math.round(parsed)));
}

function clampImageDimension(value: number, minValue: number): number {
  return clampEditorImageSize(value, minValue, MAX_EDITOR_IMAGE_DIMENSION_PX);
}

function clampImageOffset(value: number): number {
  return clampEditorImageOffset(value, 5_000);
}

function clampImageVerticalOffset(value: number): number {
  return clampEditorImageVerticalOffset(value, -5_000, 5_000);
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

function compressImageToDataURL(image: HTMLImageElement, width: number, height: number): string {
  let nextWidth = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.round(width));
  let nextHeight = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round(height));
  let quality = 0.86;
  let output = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, nextWidth, nextHeight);
    context.drawImage(image, 0, 0, nextWidth, nextHeight);
    output = canvas.toDataURL("image/jpeg", quality);
    if (imageDataURLByteLength(output) <= MAX_STORED_IMAGE_BYTES) return output;
    if (quality > 0.58) {
      quality -= 0.1;
    } else {
      nextWidth = Math.max(MIN_EDITOR_IMAGE_WIDTH_PX, Math.round(nextWidth * 0.82));
      nextHeight = Math.max(MIN_EDITOR_IMAGE_HEIGHT_PX, Math.round(nextHeight * 0.82));
    }
  }
  return output;
}

function imageDataURLByteLength(dataURL: string): number {
  const commaIndex = dataURL.indexOf(",");
  const encoded = commaIndex >= 0 ? dataURL.slice(commaIndex + 1) : dataURL;
  return Math.ceil(encoded.length * 0.75);
}
