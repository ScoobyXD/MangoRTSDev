import type { Editor, JSONContent } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser, type Fragment } from "@tiptap/pm/model";

import {
  fileFromDataURL,
  importRemoteMangoImageAttachment,
  linkMangoResourceAttachment,
  uploadMangoAttachment,
  type AttachmentRequestJSON,
  type MangoAttachment,
  type MangoAttachmentResourceType,
} from "../../attachments/attachmentApi.js";
import {
  withPreparedEditorAttachmentResource,
  type EditorAttachmentMutationLifecycle,
} from "../editorAttachmentPreparation.js";
import {
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  createEditorImageDataFromFile,
  editorAttachmentImageSource,
  readEditorImageData,
  type EditorImageData,
} from "../editorImages.js";
import {
  countEditorRichClipboardImages,
  prepareEditorRichClipboardHTML,
  type EditorRichClipboardImageRequest,
  type EditorRichClipboardImportResult,
} from "../editorRichClipboard.js";
import { EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE } from "../richTextEditing.js";

export type MangoTiptapImageAttachmentContext = {
  requestJSON: AttachmentRequestJSON;
  apiBase: string;
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
  informationID?: string;
  editorSurface?: string;
  prepareResource?: () => Promise<void>;
  onError?: (message: string) => void;
  mutationLifecycle?: EditorAttachmentMutationLifecycle;
  expectedResourceRevision?: () => number | undefined; onResourceRevision?: (revision: number) => void;
};

type EditorTextAlignment = "left" | "center" | "right";

export type MangoTiptapClipboardPaste = {
  html: string;
  imageCount: number;
  imageFiles: File[];
  matchingFiles: Array<File | undefined>;
};

const MANGO_TIPTAP_TEXT_BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6";

function clipboardImageFilename(mimeType: string): string {
  const cleanType = mimeType.trim().toLowerCase();
  if (cleanType === "image/jpeg") return "pasted-image.jpg";
  if (cleanType === "image/gif") return "pasted-image.gif";
  if (cleanType === "image/webp") return "pasted-image.webp";
  return "pasted-image.png";
}

function requireAttachmentContext(context: MangoTiptapImageAttachmentContext | undefined): MangoTiptapImageAttachmentContext {
  if (!context?.companyID?.trim() || !context.resourceID?.trim()) {
    throw new Error("editor_image_attachment_context_unavailable");
  }
  return context;
}

function resolvedAttachmentImageData(
  attachment: MangoAttachment,
  request: EditorRichClipboardImageRequest,
  fallbackFile?: File,
): EditorImageData {
  return {
    src: editorAttachmentImageSource(attachment.attachment_id),
    attachmentID: attachment.attachment_id,
    filename: attachment.original_filename || fallbackFile?.name || request.filename || "pasted-image",
    mimeType: attachment.mime_type || fallbackFile?.type || "image/png",
    byteSize: attachment.byte_size || fallbackFile?.size,
    width: attachment.original_width ?? request.width ?? 640,
    height: attachment.original_height ?? request.height ?? 360,
    alt: request.alt,
  };
}

async function uploadClipboardImageFile(
  context: MangoTiptapImageAttachmentContext,
  request: EditorRichClipboardImageRequest,
  file: File,
): Promise<EditorImageData> {
  let measured: EditorImageData | undefined;
  if (!request.width || !request.height) {
    try {
      measured = await createEditorImageDataFromFile(file, 840);
    } catch {
      // Display metadata is optional. A browser clipboard image that cannot be
      // decoded through a temporary object URL must still use the durable upload.
    }
  }
  try {
    const uploaded = await withPreparedEditorAttachmentResource(context.prepareResource, () => uploadMangoAttachment(context.requestJSON, {
      companyID: context.companyID,
      resourceType: context.resourceType,
      resourceID: context.resourceID,
      file,
      sourceKind: "editor_paste",
      relationshipKind: "inline_image",
      informationID: context.informationID,
      editorSurface: context.editorSurface,
      expectedRevision: context.expectedResourceRevision?.(),
      onResourceRevision: context.onResourceRevision,
    }), context.mutationLifecycle);
    return resolvedAttachmentImageData(uploaded.attachment, measured ? {
      ...request,
      width: measured.width,
      height: measured.height,
    } : request, file);
  } finally {
    if (measured?.src.startsWith("blob:")) URL.revokeObjectURL(measured.src);
  }
}

export async function resolveMangoTiptapRichClipboardImage(
  request: EditorRichClipboardImageRequest,
  matchingFile: File | undefined,
  attachmentContext: MangoTiptapImageAttachmentContext | undefined,
): Promise<EditorImageData> {
  const context = requireAttachmentContext(attachmentContext);
  if (matchingFile) return uploadClipboardImageFile(context, request, matchingFile);
  if (request.sourceKind === "attachment") {
    const attachmentID = request.attachmentData?.attachmentID?.trim();
    if (!attachmentID) throw new Error("failed_to_prepare_attachment");
    await withPreparedEditorAttachmentResource(context.prepareResource, () => linkMangoResourceAttachment(context.requestJSON, {
      companyID: context.companyID,
      resourceType: context.resourceType,
      resourceID: context.resourceID,
      attachmentID,
      relationshipKind: "inline_image",
      informationID: context.informationID,
      editorSurface: context.editorSurface,
      expectedRevision: context.expectedResourceRevision?.(),
    }).then((result) => { if ((result.resource_revision ?? 0) > 0) context.onResourceRevision?.(result.resource_revision!); return result; }), context.mutationLifecycle);
    return {
      src: editorAttachmentImageSource(attachmentID),
      attachmentID,
      filename: request.attachmentData?.filename || request.filename || "pasted-image",
      mimeType: request.attachmentData?.mimeType || "image/png",
      byteSize: request.attachmentData?.byteSize,
      width: request.attachmentData?.width ?? request.width ?? 640,
      height: request.attachmentData?.height ?? request.height ?? 360,
      alt: request.attachmentData?.alt ?? request.alt,
    };
  }
  if (request.sourceKind === "data") {
    const mimeType = /^data:([^;,]+)/i.exec(request.source)?.[1] || "image/png";
    const file = fileFromDataURL(request.source, request.filename || clipboardImageFilename(mimeType));
    if (!file) throw new Error("failed_to_prepare_attachment");
    return uploadClipboardImageFile(context, request, file);
  }
  if (request.sourceKind === "blob") {
    const response = await fetch(request.source);
    if (!response.ok) throw new Error("failed_to_read_pasted_image");
    const blob = await response.blob();
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(blob.type)) throw new Error("remote_image_type_unsupported");
    const file = new File([blob], request.filename || clipboardImageFilename(blob.type), { type: blob.type });
    return uploadClipboardImageFile(context, request, file);
  }
  if (request.sourceKind !== "remote") throw new Error("failed_to_prepare_attachment");
  const imported = await withPreparedEditorAttachmentResource(context.prepareResource, () => importRemoteMangoImageAttachment(context.requestJSON, {
    companyID: context.companyID,
    resourceType: context.resourceType,
    resourceID: context.resourceID,
    sourceURL: request.source,
    originalFilename: request.filename,
    informationID: context.informationID,
    editorSurface: context.editorSurface,
    expectedRevision: context.expectedResourceRevision?.(),
  }).then((result) => { if ((result.resource_attachment.resource_revision ?? 0) > 0) context.onResourceRevision?.(result.resource_attachment.resource_revision!); return result; }), context.mutationLifecycle);
  return resolvedAttachmentImageData(imported.attachment, request);
}

function setOptionalAttribute(element: HTMLElement, name: string, value: string | number | undefined): void {
  if (value !== undefined && value !== "") element.setAttribute(name, String(value));
}

function createMangoTiptapAttachmentElement(
  ownerDocument: Document,
  data: EditorImageData,
  alignment: EditorTextAlignment,
): HTMLElement {
  const element = ownerDocument.createElement("mango-attachment-image");
  element.setAttribute("data-attachment-id", data.attachmentID ?? "");
  element.setAttribute("data-alignment", alignment);
  element.setAttribute("data-position", "break");
  element.setAttribute("data-layout", "content");
  setOptionalAttribute(element, "data-filename", data.filename);
  setOptionalAttribute(element, "data-mime-type", data.mimeType || "image/png");
  setOptionalAttribute(element, "data-width", data.width);
  setOptionalAttribute(element, "data-height", data.height);
  setOptionalAttribute(element, "data-display-width", data.width);
  setOptionalAttribute(element, "data-display-height", data.height);
  setOptionalAttribute(element, "aria-label", data.alt || data.filename || "Pasted image");
  setOptionalAttribute(element, "title", data.alt || data.filename);
  return element;
}

function elementHasVisibleContent(element: HTMLElement): boolean {
  return Boolean(element.textContent?.trim() || element.querySelector("img,mango-attachment-image,hr,table,ul,ol"));
}

function liftAttachmentElementOutOfTextBlock(element: HTMLElement): void {
  const textBlock = element.closest<HTMLElement>(MANGO_TIPTAP_TEXT_BLOCK_SELECTOR);
  const parent = textBlock?.parentNode;
  if (!textBlock || !parent) return;
  const ownerDocument = element.ownerDocument;
  const beforeRange = ownerDocument.createRange();
  beforeRange.setStart(textBlock, 0);
  beforeRange.setEndBefore(element);
  const afterRange = ownerDocument.createRange();
  afterRange.setStartAfter(element);
  afterRange.setEnd(textBlock, textBlock.childNodes.length);
  const beforeFragment = beforeRange.cloneContents();
  const afterFragment = afterRange.cloneContents();
  const beforeBlock = textBlock.cloneNode(false) as HTMLElement;
  const afterBlock = textBlock.cloneNode(false) as HTMLElement;
  beforeBlock.append(beforeFragment);
  afterBlock.append(afterFragment);
  if (elementHasVisibleContent(beforeBlock)) {
    parent.insertBefore(beforeBlock, textBlock);
  }
  parent.insertBefore(element, textBlock);
  if (elementHasVisibleContent(afterBlock)) {
    parent.insertBefore(afterBlock, textBlock);
  }
  textBlock.remove();
}

export async function prepareMangoTiptapRichClipboardHTML(
  ownerDocument: Document,
  html: string,
  alignment: EditorTextAlignment,
  resolveImage: (request: EditorRichClipboardImageRequest) => Promise<EditorImageData>,
): Promise<EditorRichClipboardImportResult> {
  const prepared = await prepareEditorRichClipboardHTML(ownerDocument, html, resolveImage);
  if (prepared.importedImageCount === 0) return prepared;
  const template = ownerDocument.createElement("template");
  template.innerHTML = prepared.html;
  const frames = Array.from(template.content.querySelectorAll<HTMLElement>(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`));
  for (const frame of frames) {
    const data = readEditorImageData(frame);
    if (!data?.attachmentID) continue;
    const clearBreak = frame.nextElementSibling;
    if (clearBreak?.getAttribute(EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE) === "true") clearBreak.remove();
    const attachmentElement = createMangoTiptapAttachmentElement(ownerDocument, data, alignment);
    frame.replaceWith(attachmentElement);
    liftAttachmentElementOutOfTextBlock(attachmentElement);
  }
  return { ...prepared, html: template.innerHTML };
}

export function parseMangoTiptapRichClipboardContent(
  editor: Editor,
  ownerDocument: Document,
  html: string,
): Fragment {
  const container = ownerDocument.createElement("div");
  container.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(container, {
    preserveWhitespace: true,
  }).content;
}

export function countMangoTiptapRichClipboardImages(ownerDocument: Document, html: string): number {
  return countEditorRichClipboardImages(ownerDocument, html);
}

export function readMangoTiptapClipboardPaste(
  ownerDocument: Document,
  clipboardData: Pick<DataTransfer, "files" | "getData">,
): MangoTiptapClipboardPaste | null {
  const imageFiles = Array.from(clipboardData.files)
    .filter((file) => /^image\/(jpeg|png|gif|webp)$/i.test(file.type));
  let html = clipboardData.getData("text/html");
  let imageCount = countMangoTiptapRichClipboardImages(ownerDocument, html);

  if (imageCount === 0 && imageFiles.length > 0) {
    if (!html.trim() && clipboardData.getData("text/tab-separated-values").trim()) return null;
    const template = ownerDocument.createElement("template");
    if (html.trim()) {
      template.innerHTML = html;
      if (template.content.querySelector("table td, table th")) return null;
    } else {
      for (const line of clipboardData.getData("text/plain").split(/\r?\n/)) {
        const paragraph = ownerDocument.createElement("p");
        if (line) paragraph.textContent = line;
        else paragraph.append(ownerDocument.createElement("br"));
        template.content.append(paragraph);
      }
    }
    imageFiles.forEach((file, index) => {
      const paragraph = ownerDocument.createElement("p");
      const image = ownerDocument.createElement("img");
      image.setAttribute("src", `blob:mango-pasted-file-${index}`);
      image.setAttribute("alt", file.name || "Pasted image");
      paragraph.append(image);
      template.content.append(paragraph);
    });
    html = template.innerHTML;
    imageCount = imageFiles.length;
  }

  if (imageCount === 0) return null;
  const matchingFiles = imageFiles.length === imageCount
    ? imageFiles
    : imageFiles.length === 1
      ? Array.from({ length: imageCount }, () => imageFiles[0])
      : [];
  return { html, imageCount, imageFiles, matchingFiles };
}

export function readMangoTiptapInsertionAlignment(editor: Editor, position?: number | null): EditorTextAlignment {
  if (typeof position === "number") {
    const resolved = editor.state.doc.resolve(Math.max(0, Math.min(position, editor.state.doc.content.size)));
    for (let depth = resolved.depth; depth >= 0; depth -= 1) {
      const alignment = resolved.node(depth).attrs?.textAlign;
      if (["left", "center", "right"].includes(alignment)) return alignment as EditorTextAlignment;
    }
  }
  const selectedNode = (editor.state.selection as unknown as { node?: { type?: { name?: string }; attrs?: { alignment?: string } } }).node;
  const imageAlignment = selectedNode?.type?.name === "mangoAttachmentImage"
    ? selectedNode.attrs?.alignment
    : undefined;
  if (typeof imageAlignment === "string" && ["left", "center", "right"].includes(imageAlignment)) return imageAlignment as EditorTextAlignment;
  const alignment = editor.getAttributes("paragraph").textAlign || editor.getAttributes("heading").textAlign;
  return ["left", "center", "right"].includes(alignment) ? alignment as EditorTextAlignment : "left";
}

export function createMangoTiptapAttachmentContent(
  attachment: MangoAttachment,
  alignment: EditorTextAlignment,
): JSONContent {
  return {
    type: "mangoAttachmentImage",
    attrs: {
      attachmentId: attachment.attachment_id,
      filename: attachment.original_filename,
      mimeType: attachment.mime_type,
      width: attachment.original_width ?? null,
      height: attachment.original_height ?? null,
      displayWidth: attachment.original_width ?? null,
      displayHeight: attachment.original_height ?? null,
      alignment,
      position: "break",
      layout: "content",
      alt: attachment.original_filename,
      title: attachment.original_filename,
    },
  };
}
