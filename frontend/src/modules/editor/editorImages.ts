export const EDITOR_IMAGE_NODE_ATTRIBUTE = "data-mango-editor-image";
export const EDITOR_IMAGE_ID_ATTRIBUTE = "data-mango-editor-image-id";
export const EDITOR_IMAGE_WRAP_ATTRIBUTE = "data-mango-editor-image-wrap";
export const EDITOR_IMAGE_SELECTED_ATTRIBUTE = "data-mango-editor-image-selected";
export const EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE = "data-mango-editor-attachment-id";
export const EDITOR_IMAGE_FILENAME_ATTRIBUTE = "data-mango-editor-filename";
export const EDITOR_IMAGE_MIME_TYPE_ATTRIBUTE = "data-mango-editor-mime-type";
export const EDITOR_IMAGE_BYTE_SIZE_ATTRIBUTE = "data-mango-editor-byte-size";

const SAFE_IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+=*$/i;
const EDITOR_ATTACHMENT_IMAGE_SOURCE_PREFIX = "mango-attachment:";
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
  attachmentID?: string;
  filename?: string;
  mimeType?: string;
  byteSize?: number;
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

export type EditorAttachmentImageObjectURLLoader = (
  attachmentID: string,
  variant: "display" | "original",
  options?: { signal?: AbortSignal },
) => Promise<string>;

type EditorAttachmentHydrationOwner = {
  loadObjectURL: EditorAttachmentImageObjectURLLoader;
  options: EditorAttachmentHydrationOptions;
  disposeGeneration: (() => void) | null;
  cleanup: () => void;
};

export type EditorAttachmentHydrationOptions = Readonly<{
  eager?: boolean;
}>;

type EditorAttachmentHydrationTask = {
  cancelled: boolean;
  order: number;
  priority: number;
  run: () => Promise<void>;
};

const EDITOR_ATTACHMENT_HYDRATION_ROOT_MARGIN = "800px 0px";
const EDITOR_ATTACHMENT_HYDRATION_MAX_CONCURRENCY = 4;
const EDITOR_ATTACHMENT_HYDRATION_RETRY_DELAYS_MS = [100, 500] as const;
const editorAttachmentHydrationQueue: EditorAttachmentHydrationTask[] = [];
const editorAttachmentHydrationOwnerByRoot = new WeakMap<HTMLElement, EditorAttachmentHydrationOwner>();
let editorAttachmentHydrationActive = 0;
let editorAttachmentHydrationOrder = 0;

function drainEditorAttachmentHydrationQueue(): void {
  while (editorAttachmentHydrationActive < EDITOR_ATTACHMENT_HYDRATION_MAX_CONCURRENCY && editorAttachmentHydrationQueue.length > 0) {
    editorAttachmentHydrationQueue.sort((left, right) => left.priority - right.priority || left.order - right.order);
    const task = editorAttachmentHydrationQueue.shift();
    if (!task || task.cancelled) continue;
    editorAttachmentHydrationActive += 1;
    void task.run().finally(() => {
      editorAttachmentHydrationActive -= 1;
      drainEditorAttachmentHydrationQueue();
    });
  }
}

function enqueueEditorAttachmentHydration(priority: number, run: () => Promise<void>): () => void {
  const task: EditorAttachmentHydrationTask = {
    cancelled: false,
    order: editorAttachmentHydrationOrder += 1,
    priority,
    run,
  };
  editorAttachmentHydrationQueue.push(task);
  drainEditorAttachmentHydrationQueue();
  return () => { task.cancelled = true; };
}

export function isSafeEditorImageSource(src: string): boolean {
  return SAFE_IMAGE_DATA_URL_PATTERN.test(src.trim());
}

function isSafeEditorAttachmentImageDisplaySource(src: string, attachmentID: string): boolean {
  const cleanSrc = src.trim();
  if (isSafeEditorImageSource(cleanSrc)) return true;
  if (cleanSrc.startsWith("blob:")) return true;
  return cleanSrc === editorAttachmentImageSource(attachmentID);
}

export function editorAttachmentImageSource(attachmentID: string): string {
  const cleanAttachmentID = attachmentID.trim();
  return cleanAttachmentID ? `${EDITOR_ATTACHMENT_IMAGE_SOURCE_PREFIX}${encodeURIComponent(cleanAttachmentID)}` : "";
}

export function editorAttachmentIDFromImageSource(src: string): string {
  const cleanSrc = src.trim();
  if (!cleanSrc.startsWith(EDITOR_ATTACHMENT_IMAGE_SOURCE_PREFIX)) return "";
  const encodedAttachmentID = cleanSrc.slice(EDITOR_ATTACHMENT_IMAGE_SOURCE_PREFIX.length).trim();
  if (!encodedAttachmentID) return "";
  try {
    return decodeURIComponent(encodedAttachmentID).trim();
  } catch {
    return encodedAttachmentID;
  }
}

export function isEditorAttachmentImageSource(src: string): boolean {
  return editorAttachmentIDFromImageSource(src) !== "";
}

export function createEditorImageFrame(ownerDocument: Document, data: EditorImageData, options: { durable?: boolean } = {}): HTMLSpanElement {
  const attachmentID = data.attachmentID?.trim() ?? "";
  const frame = ownerDocument.createElement("span");
  frame.setAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE, "true");
  frame.setAttribute(EDITOR_IMAGE_ID_ATTRIBUTE, data.id?.trim() || createEditorImageID());
  frame.setAttribute(EDITOR_IMAGE_WRAP_ATTRIBUTE, "false");
  if (attachmentID) {
    frame.setAttribute(EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE, attachmentID);
    setOptionalEditorImageAttribute(frame, EDITOR_IMAGE_FILENAME_ATTRIBUTE, data.filename);
    setOptionalEditorImageAttribute(frame, EDITOR_IMAGE_MIME_TYPE_ATTRIBUTE, data.mimeType);
    setOptionalEditorImageAttribute(frame, EDITOR_IMAGE_BYTE_SIZE_ATTRIBUTE, data.byteSize);
  }
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
  image.src = resolveEditorImageFrameSource(data.src, attachmentID, Boolean(options.durable));
  frame.appendChild(image);
  return frame;
}

export function resolveEditorImageFrameSource(src: string, attachmentID: string, durable: boolean): string {
  const cleanSrc = src.trim();
  if (attachmentID) {
    if (durable) return editorAttachmentImageSource(attachmentID);
    return isSafeEditorAttachmentImageDisplaySource(cleanSrc, attachmentID) ? cleanSrc : editorAttachmentImageSource(attachmentID);
  }
  return isSafeEditorImageSource(cleanSrc) ? cleanSrc : "";
}

export function readEditorImageData(source: HTMLElement): EditorImageData | null {
  if (source.getAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE) !== "true") return null;
  const image = source.querySelector("img[src]") as HTMLImageElement | null;
  const src = image?.getAttribute("src")?.trim() ?? "";
  const attachmentID = source.getAttribute(EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE)?.trim()
    || editorAttachmentIDFromImageSource(src);
  if (attachmentID) {
    if (src && !isSafeEditorAttachmentImageDisplaySource(src, attachmentID)) return null;
  } else if (!isSafeEditorImageSource(src)) {
    return null;
  }
  const width = readSafeStylePixels(source.style.width, 220, MIN_EDITOR_IMAGE_WIDTH_PX, MAX_EDITOR_IMAGE_WIDTH_PX);
  const height = readSafeStylePixels(source.style.height, 160, MIN_EDITOR_IMAGE_HEIGHT_PX, MAX_EDITOR_IMAGE_HEIGHT_PX);
  const floatSide = readEditorImageFloatSide(source);
  const marginLeft = readEditorImageInlineOffset(source);
  const marginTop = readSafeStylePixels(source.style.marginTop, DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX, -5_000, 5_000);
  return {
    src: src || editorAttachmentImageSource(attachmentID),
    id: source.getAttribute(EDITOR_IMAGE_ID_ATTRIBUTE) ?? undefined,
    attachmentID: attachmentID || undefined,
    filename: source.getAttribute(EDITOR_IMAGE_FILENAME_ATTRIBUTE)?.trim() || undefined,
    mimeType: source.getAttribute(EDITOR_IMAGE_MIME_TYPE_ATTRIBUTE)?.trim() || undefined,
    byteSize: readOptionalPositiveInteger(source.getAttribute(EDITOR_IMAGE_BYTE_SIZE_ATTRIBUTE)),
    width,
    height,
    marginLeft,
    marginTop,
    floatSide,
  };
}

export function createEditorImageClipboardHTML(ownerDocument: Document, data: EditorImageData): string {
  const frame = createEditorImageFrame(ownerDocument, { ...data, id: undefined }, { durable: true });
  frame.removeAttribute(EDITOR_IMAGE_SELECTED_ATTRIBUTE);
  return frame.outerHTML;
}

export function createStandaloneImageClipboardHTML(src: string, alt = "Image"): string {
  if (!isSafeEditorImageSource(src)) return "";
  return `<img src="${src}" alt="${escapeHTMLAttribute(alt)}">`;
}

export function writeImageClipboardData(clipboardData: DataTransfer, _src: string, html: string, plainText = "Image"): boolean {
  if (!html.trim()) return false;
  try {
    clipboardData.setData("text/html", html);
    clipboardData.setData("text/plain", plainText.trim() || "Image");
    return true;
  } catch {
    return false;
  }
}

export function writeImageToSystemClipboard(src: string, html: string, plainText = "Image"): boolean {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard?.write || typeof ClipboardItem === "undefined" || !html.trim()) return false;
  const imageBlob = createEditorImageBlob(src);
  const supportsType = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
  const itemPayload: Record<string, Blob> = {};
  const addClipboardType = (type: string, blob: Blob) => {
    if (typeof supportsType === "function" && !supportsType(type)) return;
    itemPayload[type] = blob;
  };
  if (imageBlob) addClipboardType(imageBlob.type, imageBlob);
  itemPayload["text/html"] = new Blob([html], { type: "text/html" });
  itemPayload["text/plain"] = new Blob([plainText.trim() || "Image"], { type: "text/plain" });
  try {
    void clipboard.write([new ClipboardItem(itemPayload)]).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export type EditorImageTransferHTMLKind = "none" | "single-image" | "other";

export function shouldUseEditorImageFileTransferShortcut(
  hasImageFile: boolean,
  htmlKind: EditorImageTransferHTMLKind,
  plainText: string,
): boolean {
  if (!hasImageFile) return false;
  if (htmlKind === "single-image") return true;
  if (htmlKind === "other") return false;
  return !plainText.trim();
}

const EDITOR_CLIPBOARD_IGNORABLE_ELEMENT_TAGS = new Set(["BR", "LINK", "META", "SCRIPT", "STYLE", "TITLE"]);
const EDITOR_CLIPBOARD_STRUCTURAL_ELEMENT_TAGS = new Set([
  "HR",
  "INPUT",
  "LI",
  "OL",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

function editorClipboardNodeHasContentOutsideImage(node: Node, imageNode: Element): boolean {
  if (node === imageNode) return false;
  if (node.nodeType === Node.TEXT_NODE) return Boolean((node.textContent ?? "").trim());
  if (node.nodeType !== Node.ELEMENT_NODE) return false;

  const element = node as Element;
  if (EDITOR_CLIPBOARD_IGNORABLE_ELEMENT_TAGS.has(element.tagName)) return false;
  for (const child of Array.from(element.childNodes)) {
    if (editorClipboardNodeHasContentOutsideImage(child, imageNode)) return true;
  }
  return EDITOR_CLIPBOARD_STRUCTURAL_ELEMENT_TAGS.has(element.tagName);
}

export function editorClipboardHTMLContainsOnlyOneImage(ownerDocument: Document, html: string): boolean {
  if (!html.trim()) return false;
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;

  const editorFrames = Array.from(template.content.querySelectorAll(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`));
  const standaloneImages = Array.from(template.content.querySelectorAll("img[src]"))
    .filter((image) => !image.closest(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`));
  const imageNodes = [...editorFrames, ...standaloneImages];
  if (imageNodes.length !== 1) return false;

  const imageNode = imageNodes[0];
  return !Array.from(template.content.childNodes)
    .some((node) => editorClipboardNodeHasContentOutsideImage(node, imageNode));
}

export function readEditorImageClipboardDataFromHTML(ownerDocument: Document, html: string): EditorImageClipboardData | null {
  if (!editorClipboardHTMLContainsOnlyOneImage(ownerDocument, html)) return null;
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

export function editorImageFrameNeedsAttachmentHydration(frame: HTMLElement): boolean {
  const data = readEditorImageData(frame);
  if (!data?.attachmentID) return false;
  const image = frame.querySelector("img[src]") as HTMLImageElement | null;
  const src = image?.getAttribute("src")?.trim() ?? "";
  return !src || isEditorAttachmentImageSource(src);
}

export function setEditorImageFrameDisplaySource(frame: HTMLElement, src: string): boolean {
  const data = readEditorImageData(frame);
  if (!data?.attachmentID) return false;
  const cleanSrc = src.trim();
  if (!cleanSrc || !isSafeEditorAttachmentImageDisplaySource(cleanSrc, data.attachmentID)) return false;
  const image = frame.querySelector("img") as HTMLImageElement | null;
  if (!image) return false;
  frame.setAttribute(EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE, data.attachmentID);
  image.src = cleanSrc;
  return true;
}

function startEditorAttachmentImageHydrationGeneration(
  root: HTMLElement,
  loadObjectURL: EditorAttachmentImageObjectURLLoader,
  options: EditorAttachmentHydrationOptions,
): () => void {
  const frames = Array.from(root.querySelectorAll(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"], span[${EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE}]`))
    .filter((node): node is HTMLSpanElement => node instanceof HTMLSpanElement);
  const framesByAttachmentID = new Map<string, HTMLSpanElement[]>();
  for (const frame of frames) {
    if (!editorImageFrameNeedsAttachmentHydration(frame)) continue;
    const attachmentID = readEditorImageData(frame)?.attachmentID?.trim() ?? "";
    if (!attachmentID) continue;
    const matchingFrames = framesByAttachmentID.get(attachmentID) ?? [];
    matchingFrames.push(frame);
    framesByAttachmentID.set(attachmentID, matchingFrames);
  }

  let disposed = false;
  const objectURLs = new Set<string>();
  const hydratedFramesByObjectURL = new Map<string, Array<{ attachmentID: string; frame: HTMLSpanElement }>>();
  const activeControllers = new Set<AbortController>();
  const cancelQueuedTasks = new Set<() => void>();
  const scheduledAttachmentIDs = new Set<string>();
  const retryCountByAttachmentID = new Map<string, number>();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  let observer: IntersectionObserver | null = null;

  const scheduleAttachment = (attachmentID: string, priority: number) => {
    if (disposed || scheduledAttachmentIDs.has(attachmentID)) return;
    scheduledAttachmentIDs.add(attachmentID);
    const attachmentFrames = framesByAttachmentID.get(attachmentID) ?? [];
    attachmentFrames.forEach((frame) => observer?.unobserve(frame));
    const cancel = enqueueEditorAttachmentHydration(priority, async () => {
      if (disposed) return;
      const controller = new AbortController();
      activeControllers.add(controller);
      let objectURL = "";
      try {
        objectURL = await loadObjectURL(attachmentID, "display", { signal: controller.signal });
        if (disposed) {
          URL.revokeObjectURL(objectURL);
          return;
        }
        let applied = false;
        for (const frame of attachmentFrames) {
          if (root.contains(frame) && setEditorImageFrameDisplaySource(frame, objectURL)) applied = true;
        }
        if (applied) {
          objectURLs.add(objectURL);
          hydratedFramesByObjectURL.set(objectURL, attachmentFrames.map((frame) => ({ attachmentID, frame })));
        }
        else URL.revokeObjectURL(objectURL);
      } catch {
        if (objectURL) URL.revokeObjectURL(objectURL);
        if (disposed || controller.signal.aborted) return;
        scheduledAttachmentIDs.delete(attachmentID);
        const retryCount = retryCountByAttachmentID.get(attachmentID) ?? 0;
        const retryDelay = EDITOR_ATTACHMENT_HYDRATION_RETRY_DELAYS_MS[retryCount];
        if (retryDelay === undefined) return;
        retryCountByAttachmentID.set(attachmentID, retryCount + 1);
        const retryTimer = setTimeout(() => {
          retryTimers.delete(retryTimer);
          if (disposed) return;
          if (observer) attachmentFrames.forEach((frame) => observer?.observe(frame));
          else scheduleAttachment(attachmentID, priority + retryCount + 1);
        }, retryDelay);
        retryTimers.add(retryTimer);
      } finally {
        activeControllers.delete(controller);
      }
    });
    cancelQueuedTasks.add(cancel);
  };

  if (!options.eager && framesByAttachmentID.size > 0 && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const frame = entry.target as HTMLSpanElement;
        const attachmentID = readEditorImageData(frame)?.attachmentID?.trim() ?? "";
        if (attachmentID) scheduleAttachment(attachmentID, -Math.max(0, entry.intersectionRatio));
      }
    }, { root, rootMargin: EDITOR_ATTACHMENT_HYDRATION_ROOT_MARGIN });
    for (const attachmentFrames of framesByAttachmentID.values()) {
      attachmentFrames.forEach((frame) => observer?.observe(frame));
    }
  } else {
    for (const attachmentID of framesByAttachmentID.keys()) scheduleAttachment(attachmentID, 0);
  }

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    activeControllers.forEach((controller) => controller.abort());
    activeControllers.clear();
    retryTimers.forEach((timer) => clearTimeout(timer));
    retryTimers.clear();
    cancelQueuedTasks.forEach((cancel) => cancel());
    cancelQueuedTasks.clear();
    objectURLs.forEach((objectURL) => {
      for (const { attachmentID, frame } of hydratedFramesByObjectURL.get(objectURL) ?? []) {
        const image = frame.querySelector("img[src]") as HTMLImageElement | null;
        if (root.contains(frame) && image?.getAttribute("src") === objectURL) {
          setEditorImageFrameDisplaySource(frame, editorAttachmentImageSource(attachmentID));
        }
      }
      URL.revokeObjectURL(objectURL);
    });
    hydratedFramesByObjectURL.clear();
    objectURLs.clear();
  };
  return cleanup;
}

function disposeEditorAttachmentHydrationOwner(root: HTMLElement, owner: EditorAttachmentHydrationOwner): void {
  if (editorAttachmentHydrationOwnerByRoot.get(root) !== owner) return;
  owner.disposeGeneration?.();
  owner.disposeGeneration = null;
  editorAttachmentHydrationOwnerByRoot.delete(root);
}

export function hydrateEditorAttachmentImageFrames(
  root: HTMLElement,
  loadObjectURL: EditorAttachmentImageObjectURLLoader,
  options: EditorAttachmentHydrationOptions = {},
): () => void {
  editorAttachmentHydrationOwnerByRoot.get(root)?.cleanup();
  const owner: EditorAttachmentHydrationOwner = {
    loadObjectURL,
    options,
    disposeGeneration: null,
    cleanup: () => disposeEditorAttachmentHydrationOwner(root, owner),
  };
  editorAttachmentHydrationOwnerByRoot.set(root, owner);
  try {
    owner.disposeGeneration = startEditorAttachmentImageHydrationGeneration(root, loadObjectURL, options);
  } catch (cause) {
    disposeEditorAttachmentHydrationOwner(root, owner);
    throw cause;
  }
  return owner.cleanup;
}

export function refreshEditorAttachmentImageFrames(root: HTMLElement): boolean {
  const owner = editorAttachmentHydrationOwnerByRoot.get(root);
  if (!owner) return false;
  owner.disposeGeneration?.();
  owner.disposeGeneration = null;
  try {
    owner.disposeGeneration = startEditorAttachmentImageHydrationGeneration(root, owner.loadObjectURL, owner.options);
  } catch (cause) {
    disposeEditorAttachmentHydrationOwner(root, owner);
    throw cause;
  }
  return true;
}

export function clearEditorImageSelection(root: HTMLElement) {
  root.querySelectorAll(`span[${EDITOR_IMAGE_SELECTED_ATTRIBUTE}="true"]`).forEach((node) => {
    if (node instanceof HTMLElement) node.removeAttribute(EDITOR_IMAGE_SELECTED_ATTRIBUTE);
  });
}

export function selectEditorImageFrame(root: HTMLElement, frame: HTMLElement) {
  clearEditorImageSelection(root);
  frame.setAttribute(EDITOR_IMAGE_SELECTED_ATTRIBUTE, "true");
  const selection = root.ownerDocument.getSelection();
  if (!selection || !root.contains(frame)) return;
  const range = root.ownerDocument.createRange();
  try {
    range.setStartBefore(frame);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    // Selection support varies for nested contenteditable hosts; visual selection still applies.
  }
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

export async function createEditorImageDataFromFile(file: File, maxDisplayWidth: number, _maxStoredBytes = MAX_STORED_IMAGE_BYTES): Promise<EditorImageData> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("failed_to_prepare_image");
  const objectURL = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectURL);
    const dimensions = resolveEditorImageDisplaySize(image, maxDisplayWidth);
    return { src: objectURL, width: dimensions.width, height: dimensions.height };
  } catch (cause) {
    URL.revokeObjectURL(objectURL);
    throw cause;
  }
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

function setOptionalEditorImageAttribute(frame: HTMLElement, attribute: string, value: string | number | undefined): void {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 0) frame.setAttribute(attribute, String(Math.round(value)));
    return;
  }
  const clean = value?.trim() ?? "";
  if (clean) frame.setAttribute(attribute, clean);
}

function readOptionalPositiveInteger(value: string | null): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
