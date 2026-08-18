import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../../app/framerightclickmenu.js";
import { menuBtnBase } from "../../../app/frameLayoutTypes.js";
import { Editor, type AnyExtension, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  downloadMangoAttachment,
  fetchMangoAttachmentBlob,
  loadMangoAttachmentObjectURL,
  uploadMangoAttachment,
} from "../../attachments/attachmentApi";
import { realtimeEditorJSONScope, subscribeRealtimeScope } from "../../realtime/realtimeWebSocket";
import type { MentionableCompanyUser } from "../editorMentions";
import { createEditorImageClipboardHTML, writeEditorImageToSystemClipboard, writeImageClipboardData, type EditorImageData } from "../editorImages.js";
import { EditorImagePreviewModal } from "../EditorImagePreviewModal.js";
import { EditorSelectionNodeIcon } from "../../../icons/index.js";
import { ChatIcon } from "../NodeWorkspaceSurfaceShared.js";
import {
  createNodeEntityFromSelection,
  normalizeEditorSelectionNodeTitle,
  openEditorEntityLink,
  type EditorEntityLink,
  type EditorEntityType,
} from "../editorEntityLinks.js";
import { calculateEditorSelectionActionPosition } from "../editorSelectionActions.js";
import {
  UniversalEntityPicker,
  type UniversalEntityPickerAnchor,
  type UniversalEntityPickerMode,
} from "../UniversalEntityPicker.js";
import {
  captureMangoTiptapPointerBookmark,
  preserveMangoTiptapCaretScroll,
  resolveMangoTiptapPointerBookmark,
} from "./mangoTiptapPointerActivation.js";

import { MangoEditorLifecycle, type MangoEditorLifecycleSnapshot } from "../editorLifecycle";
import { incrementEditorRuntimeMetric, trackEditorRuntimeResource } from "../editorRuntimeMetrics";
import {
  beginEditorTraceSpan,
  createEditorTraceContext,
  editorTraceNow,
  endEditorTraceSpan,
  recordEditorDocumentStructure,
  recordEditorTraceDuration,
  registerEditorTraceRoot,
  releaseEditorTraceContext,
  runWithEditorTraceContext,
  traceEditorFunction,
} from "../editorTrace.js";
import type {
  EditorDocumentFormattingController,
  EditorImageAttachmentContext,
  EditorSelectionInlineFormatState,
  EditorTextAlignment,
} from "../useEditorDocumentSurfaceHandlers";
import type { EditorHighlightColor } from "../richTextEditing";
import {
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
} from "../useEditorPreferences";
import { DEFAULT_EDITOR_OUTLINE_STYLE, type EditorOutlineStyleID } from "../plainTextEditing.js";
import {
  MangoTiptapAnnotations,
  durableMangoTiptapAnnotations,
  mangoTiptapAnnotationsEqual,
  mergeMangoTiptapAnnotationPositions,
  navigateMangoTiptapTarget,
  readMappedMangoTiptapAnnotations,
  updateMangoTiptapAnnotations,
  type MangoTiptapAnnotation,
  type MangoTiptapPersistedAnnotation,
} from "./mangoTiptapAnnotations.js";
import {
  compactMangoTiptapDocument,
  createEmptyMangoTiptapDocument,
  needsMangoTiptapLegacyDateHeadingBreak,
  parseMangoTiptapDocument,
  type MangoTiptapDocument,
} from "./mangoTiptapDocument.js";
import {
  createMangoTiptapExtensions,
  handleMangoTiptapImageDrop,
  handleMangoTiptapOutlineEnter,
  indentMangoTiptapSelection,
  MangoAttachmentImage,
  hideMangoTiptapPasteLoading,
  normalizeMangoTiptapBlockIDs,
  repairMangoTiptapRecoveredDocument,
  outdentMangoTiptapSelection,
  readMangoTiptapSelectionState,
  showMangoTiptapPasteLoading,
  type MangoAttachmentImageAttributes,
} from "./mangoTiptapExtensions.js";
import {
  mangoTiptapImagePlacementDOMAttributes,
} from "./mangoTiptapImagePlacement.js";
import {
  createMangoTiptapAttachmentContent,
  parseMangoTiptapRichClipboardContent,
  prepareMangoTiptapRichClipboardHTML,
  readMangoTiptapClipboardPaste,
  readMangoTiptapInsertionAlignment,
  resolveMangoTiptapRichClipboardImage,
} from "./mangoTiptapRichClipboard.js";
import { MangoTiptapStaticRenderer, type MangoStaticAttachmentImageProps } from "./MangoTiptapStaticRenderer.js";
import { markEditorHistoryChanged } from "../editorExitHistory.js";
import { registerMangoTiptapFlusher } from "./mangoTiptapFlushRegistry.js";
import {
  calculateMangoTiptapTableGrowth,
  growMangoTiptapTable,
  handleMangoTiptapTableClipboardPaste,
  readActiveMangoTiptapTableFrame,
  type MangoTiptapTableFrame,
  type MangoTiptapTableGrowth,
} from "./mangoTiptapTable.js";
import { MangoTiptapSync, type MangoTiptapConflict, type MangoTiptapResourceType, type MangoTiptapSaveState } from "./mangoTiptapSync.js";

let pasteLoadingSequence = 0;

export type MangoTiptapFormattingController = EditorDocumentFormattingController & {
  focus: () => void;
};

export type MangoTiptapTarget = {
  requestID: number;
  blockID?: string;
  annotationID?: string;
  position?: number;
};

export type MangoTiptapSelectionAction = {
  from: number;
  to: number;
  quote: string;
  x: number;
  y: number;
};

export type MangoTiptapImageAction = {
  attributes: MangoStaticAttachmentImageProps;
  objectURL: string;
  width: number;
  height: number;
  x: number;
  y: number;
};

type MangoTiptapTableGrowthDrag = {
  pointerID: number;
  startX: number;
  startY: number;
  frame: MangoTiptapTableFrame;
  growth: MangoTiptapTableGrowth;
};

export type MangoTiptapEditorProps = {
  value?: string;
  editable?: boolean;
  outlineStyle?: EditorOutlineStyleID;
  ariaLabel: string;
  placeholder?: string;
  dataAttributes?: Record<string, string | undefined>;
  className?: string;
  style?: React.CSSProperties;
  companyID: string;
  resourceType: MangoTiptapResourceType;
  resourceID: string;
  documentID: string;
  currentUserID?: string;
  requestJSON: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
  subscribeToCanonicalChange?: (recover: () => void, clientID: string) => () => void;
  attachmentContext?: EditorImageAttachmentContext;
  mentionUsers?: MentionableCompanyUser[];
  onEntityOpen?: (entity: EditorEntityLink) => void;
  onEntityLink?: (entity: EditorEntityLink) => Promise<void>;
  annotations?: MangoTiptapAnnotation[];
  target?: MangoTiptapTarget | null;
  onTargetHandled?: (requestID: number) => void;
  formattingControllerRef?:
    | React.MutableRefObject<EditorDocumentFormattingController | null>
    | React.MutableRefObject<MangoTiptapFormattingController | null>;
  formattingControllerActive?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onConflict?: (conflict: MangoTiptapConflict, resolve: (choice: "keep-local" | "use-canonical") => Promise<void>) => void;
  onError?: (message: string) => void;
  onSaveStateChange?: (state: MangoTiptapSaveState) => void;
  onRecoveryStorageError?: (message: string) => void;
  onRecoveryStorageRecovered?: () => void;
  onAnnotationActivate?: (annotation: { id: string; kind: string }) => void;
  onSelectionChatRequest?: (selection: MangoTiptapSelectionAction) => void;
  onImageChatRequest?: (image: MangoTiptapImageAction) => void;
  onImageNodeRequest?: (image: MangoTiptapImageAction) => void;
  onSelectionFontSizeChange?: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void;
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void;
  onLifecycleChange?: (snapshot: MangoEditorLifecycleSnapshot) => void;
  onAnnotationsChange?: (annotations: readonly MangoTiptapAnnotation[]) => void;
};

const EMPTY_MENTION_USERS: readonly MentionableCompanyUser[] = [];
const EMPTY_ANNOTATIONS: readonly MangoTiptapAnnotation[] = [];
const NODE_LINK_TARGET_TYPES: readonly EditorEntityType[] = ["logic_gate", "project", "email_message"];
const LOGIC_GATE_LINK_TARGET_TYPES: readonly EditorEntityType[] = ["project"];
const PROJECT_LINK_TARGET_TYPES: readonly EditorEntityType[] = ["email_message"];
const EMPTY_LINK_TARGET_TYPES: readonly EditorEntityType[] = [];

function mangoEntityLinkAttributes(entity: EditorEntityLink): Record<string, string | null> {
  return {
    entityType: entity.entityType,
    entityId: entity.entityID,
    label: entity.label,
    emailMessageId: entity.emailMessageID ?? null,
    emailThreadId: entity.emailThreadID ?? null,
    emailAccountEmail: entity.emailAccountEmail ?? null,
    emailSharedInboxId: entity.emailSharedInboxID ?? null,
  };
}

function emailEntityMetadataFromRecord(record: Record<string, unknown>): Pick<EditorEntityLink, "emailMessageID" | "emailThreadID" | "emailAccountEmail" | "emailSharedInboxID"> {
  const stringValue = (key: string) => typeof record[key] === "string" ? String(record[key]).trim() : "";
  return {
    emailMessageID: stringValue("emailMessageId") || undefined,
    emailThreadID: stringValue("emailThreadId") || undefined,
    emailAccountEmail: stringValue("emailAccountEmail").toLowerCase() || undefined,
    emailSharedInboxID: stringValue("emailSharedInboxId") || undefined,
  };
}

type UniversalPickerDraft = {
  from: number;
  to: number;
  anchor: UniversalEntityPickerAnchor;
};

function documentWithUniqueBlockIDs(document: MangoTiptapDocument): MangoTiptapDocument {
  const normalized = normalizeMangoTiptapBlockIDs(document.document);
  return normalized === document.document ? document : { ...document, document: normalized };
}

function documentWithCurrentMissingBlockIDs(document: MangoTiptapDocument, currentDocument: ProseMirrorNode): MangoTiptapDocument {
  const preserve = (node: JSONContent, currentNode: ProseMirrorNode | undefined): JSONContent => {
    if (!currentNode || node.type !== currentNode.type.name) return node;
    const incomingBlockID = typeof node.attrs?.blockId === "string" ? node.attrs.blockId.trim() : "";
    const currentBlockID = typeof currentNode.attrs.blockId === "string" ? currentNode.attrs.blockId.trim() : "";
    const attrs = !incomingBlockID && currentBlockID
      ? { ...(node.attrs ?? {}), blockId: currentBlockID }
      : node.attrs;
    const content = node.content?.map((child, index) => preserve(
      child,
      index < currentNode.childCount ? currentNode.child(index) : undefined,
    ));
    if (attrs === node.attrs && content === node.content) return node;
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(content ? { content } : {}),
    };
  };
  return { ...document, document: preserve(document.document, currentDocument) };
}

function initialDocument(value?: string): { document: MangoTiptapDocument; error?: string } {
  if (!value?.trim()) return { document: documentWithUniqueBlockIDs(createEmptyMangoTiptapDocument()) };
  const parsed = parseMangoTiptapDocument(value);
  return parsed.valid
    ? { document: documentWithUniqueBlockIDs(parsed.value) }
    : { document: documentWithUniqueBlockIDs(createEmptyMangoTiptapDocument()), error: parsed.error };
}

function normalizedMentionUsers(users: readonly MentionableCompanyUser[]) {
  return users.flatMap((user) => {
    const userID = user.user_id?.trim();
    if (!userID) return [];
    return [{
      userID,
      name: user.display_name?.trim() || user.email?.trim() || "User",
      email: user.email?.trim(),
    }];
  });
}

function selectedMangoTiptapImageData(editor: Editor): EditorImageData | null {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "mangoAttachmentImage") return null;
  const attributes = selection.node.attrs as MangoAttachmentImageAttributes;
  const nodeDOM = editor.view.nodeDOM(selection.from);
  const renderedImage = nodeDOM instanceof HTMLImageElement
    ? nodeDOM
    : nodeDOM instanceof Element
      ? nodeDOM.querySelector<HTMLImageElement>("img")
      : null;
  const width = Math.max(1, Math.round(
    Number(attributes.displayWidth)
      || Number(attributes.width)
      || renderedImage?.naturalWidth
      || 1,
  ));
  const height = Math.max(1, Math.round(
    Number(attributes.displayHeight)
      || Number(attributes.height)
      || renderedImage?.naturalHeight
      || 1,
  ));
  return {
    src: renderedImage?.getAttribute("src")?.trim() || "",
    alt: attributes.alt?.trim() || attributes.filename?.trim() || "Image",
    attachmentID: attributes.attachmentId?.trim() || undefined,
    filename: attributes.filename?.trim() || "Image",
    mimeType: attributes.mimeType?.trim() || undefined,
    width,
    height,
    floatSide: attributes.alignment === "right" ? "right" : "left",
  };
}

function copySelectedMangoTiptapImage(
  editor: Editor,
  event: ClipboardEvent,
  attachmentContext?: EditorImageAttachmentContext,
): boolean {
  const data = selectedMangoTiptapImageData(editor);
  if (!data) return false;
  const ownerDocument = editor.view.dom.ownerDocument;
  const eventHTML = createEditorImageClipboardHTML(ownerDocument, data);
  const wroteEventClipboard = event.clipboardData
    ? writeImageClipboardData(event.clipboardData, data.src, eventHTML, data.filename)
    : false;
  const attachmentID = data.attachmentID?.trim() || "";
  const context = attachmentContext?.apiBase.trim() && attachmentContext.companyID.trim()
    ? attachmentContext
    : undefined;
  const wroteSystemClipboard = writeEditorImageToSystemClipboard(
    ownerDocument,
    data,
    attachmentID && context
      ? () => fetchMangoAttachmentBlob(context.apiBase, context.companyID, attachmentID, "original")
      : data.src.startsWith("blob:") ? async () => {
        const response = await fetch(data.src);
        if (!response.ok) throw new Error("failed_to_read_editor_image");
        return response.blob();
      } : undefined,
  );
  if (!wroteEventClipboard && !wroteSystemClipboard) return false;
  event.preventDefault();
  return true;
}

export type AuthenticatedImageProps = {
  attributes: MangoStaticAttachmentImageProps;
  attachmentContext?: EditorImageAttachmentContext;
  selected?: boolean;
  editable?: boolean;
  updateAttributes?: (attributes: Partial<MangoAttachmentImageAttributes>) => void;
  onSelect?: () => void;
  onPointerEnter?: () => void;
  onImageChatRequest?: (image: MangoTiptapImageAction) => void;
  onImageNodeRequest?: (image: MangoTiptapImageAction) => void;
};

type ImageResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const IMAGE_RESIZE_HANDLES: ReadonlyArray<{
  direction: ImageResizeDirection;
  label: string;
  cursor: React.CSSProperties["cursor"];
  position: React.CSSProperties;
}> = [
  { direction: "nw", label: "top left", cursor: "nwse-resize", position: { left: -5, top: -5 } },
  { direction: "n", label: "top", cursor: "ns-resize", position: { left: "50%", top: -5, transform: "translateX(-50%)" } },
  { direction: "ne", label: "top right", cursor: "nesw-resize", position: { right: -5, top: -5 } },
  { direction: "e", label: "right", cursor: "ew-resize", position: { right: -5, top: "50%", transform: "translateY(-50%)" } },
  { direction: "se", label: "bottom right", cursor: "nwse-resize", position: { right: -5, bottom: -5 } },
  { direction: "s", label: "bottom", cursor: "ns-resize", position: { left: "50%", bottom: -5, transform: "translateX(-50%)" } },
  { direction: "sw", label: "bottom left", cursor: "nesw-resize", position: { left: -5, bottom: -5 } },
  { direction: "w", label: "left", cursor: "ew-resize", position: { left: -5, top: "50%", transform: "translateY(-50%)" } },
];

const IMAGE_ICON_BUTTON_STYLE: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-grid",
  placeItems: "center",
  padding: 0,
  border: "1px solid rgba(255,255,255,.88)",
  borderRadius: 8,
  background: "rgba(255,255,255,.94)",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(15,23,42,.24)",
};

export const MangoAuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  attributes,
  attachmentContext,
  selected = false,
  editable = false,
  updateAttributes,
  onSelect,
  onPointerEnter,
  onImageChatRequest,
  onImageNodeRequest,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [eligible, setEligible] = useState(selected);
  const [objectURL, setObjectURL] = useState("");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewObjectURL, setPreviewObjectURL] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [resizingDimensions, setResizingDimensions] = useState<{ width: number; height: number } | null>(null);
  const dragRef = useRef<{
    direction: ImageResizeDirection;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    latestWidth: number;
    latestHeight: number;
  } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (selected) setEligible(true);
    if (eligible) return undefined;
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setEligible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setEligible(true);
    }, { rootMargin: "800px 0px" });
    const release = trackEditorRuntimeResource("observers");
    observer.observe(root);
    return () => {
      observer.disconnect();
      release();
    };
  }, [eligible, selected]);

  useEffect(() => {
    if (!eligible || !attachmentContext || !attributes.attachmentId) return undefined;
    const controller = new AbortController();
    let active = true;
    incrementEditorRuntimeMetric("image_requests");
    void loadMangoAttachmentObjectURL(
      attachmentContext.apiBase,
      attachmentContext.companyID,
      attributes.attachmentId,
      "display",
      { signal: controller.signal },
    ).then((url) => {
      if (!active) {
        URL.revokeObjectURL(url);
        return;
      }
      setObjectURL(url);
      setError("");
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Unable to load image");
    });
    return () => {
      active = false;
      controller.abort();
      setObjectURL((current) => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
    };
  }, [attachmentContext?.apiBase, attachmentContext?.companyID, attributes.attachmentId, eligible, retryKey]);

  useEffect(() => {
    if (!previewOpen || !attachmentContext || !attributes.attachmentId) return undefined;
    const controller = new AbortController();
    let active = true;
    setPreviewError("");
    incrementEditorRuntimeMetric("image_requests");
    void loadMangoAttachmentObjectURL(
      attachmentContext.apiBase,
      attachmentContext.companyID,
      attributes.attachmentId,
      "original",
      { signal: controller.signal },
    ).then((url) => {
      if (!active) {
        URL.revokeObjectURL(url);
        return;
      }
      setPreviewObjectURL(url);
    }).catch((cause) => {
      if (!controller.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : "Unable to load original image");
    });
    return () => {
      active = false;
      controller.abort();
      setPreviewObjectURL((current) => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
    };
  }, [attachmentContext?.apiBase, attachmentContext?.companyID, attributes.attachmentId, previewOpen, previewRetryKey]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const beginResize = (direction: ImageResizeDirection, event: React.PointerEvent) => {
    if (!editable || !updateAttributes) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();
    const frameRect = frameRef.current?.getBoundingClientRect();
    const startWidth = Math.max(48, Math.round(frameRect?.width || attributes.displayWidth || attributes.width || 200));
    const startHeight = Math.max(48, Math.round(frameRect?.height || attributes.displayHeight || attributes.height || 160));
    dragRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startWidth,
      startHeight,
      latestWidth: startWidth,
      latestHeight: startHeight,
    };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const horizontalDelta = drag.direction.includes("e")
        ? moveEvent.clientX - drag.startX
        : drag.direction.includes("w") ? drag.startX - moveEvent.clientX : 0;
      const verticalDelta = drag.direction.includes("s")
        ? moveEvent.clientY - drag.startY
        : drag.direction.includes("n") ? drag.startY - moveEvent.clientY : 0;
      const changesWidth = drag.direction.includes("e") || drag.direction.includes("w");
      const changesHeight = drag.direction.includes("n") || drag.direction.includes("s");
      let width = changesWidth ? Math.max(48, drag.startWidth + horizontalDelta) : drag.startWidth;
      let height = changesHeight ? Math.max(48, drag.startHeight + verticalDelta) : drag.startHeight;
      if (changesWidth && changesHeight) {
        const aspectRatio = drag.startWidth / drag.startHeight;
        if (Math.abs(horizontalDelta / drag.startWidth) >= Math.abs(verticalDelta / drag.startHeight)) height = width / aspectRatio;
        else width = height * aspectRatio;
      }
      const editorWidth = rootRef.current?.closest(".mango-tiptap-prosemirror, .mango-tiptap-static-document")?.getBoundingClientRect().width || width;
      const maximumWidth = Math.max(48, attributes.position === "wrap" ? editorWidth * 0.5 : editorWidth);
      if (width > maximumWidth) {
        width = maximumWidth;
        if (changesWidth && changesHeight) height = width / (drag.startWidth / drag.startHeight);
      }
      drag.latestWidth = Math.round(width);
      drag.latestHeight = Math.round(height);
      setResizingDimensions({ width: drag.latestWidth, height: drag.latestHeight });
    };
    const cleanup = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      releaseListeners();
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null;
    };
    const onEnd = () => {
      const dimensions = dragRef.current && {
        displayWidth: dragRef.current.latestWidth,
        displayHeight: dragRef.current.latestHeight,
      };
      cleanup();
      setResizingDimensions(null);
      if (dimensions) updateAttributes(dimensions);
    };
    const releaseListeners = trackEditorRuntimeResource("listeners");
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  };

  const imageAction = (): MangoTiptapImageAction => {
    const rect = frameRef.current?.getBoundingClientRect();
    return {
      attributes,
      objectURL,
      width: Math.max(1, Math.round(rect?.width || attributes.displayWidth || attributes.width || 1)),
      height: Math.max(1, Math.round(rect?.height || attributes.displayHeight || attributes.height || 1)),
      x: Math.round(rect?.left || 0),
      y: Math.round(rect?.bottom || 0) + 6,
    };
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const openPreview = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button") || !attachmentContext || !attributes.attachmentId) return;
      event.preventDefault();
      event.stopPropagation();
      setPreviewOpen(true);
    };
    root.addEventListener("dblclick", openPreview, true);
    return () => {
      root.removeEventListener("dblclick", openPreview, true);
    };
  }, [attachmentContext, attributes.attachmentId]);

  const downloadImage = useCallback(() => {
    if (!attachmentContext) return;
    void downloadMangoAttachment({
      apiBase: attachmentContext.apiBase,
      companyID: attachmentContext.companyID,
      attachmentID: attributes.attachmentId,
      filename: attributes.filename,
    }).catch((cause) => attachmentContext.onError?.(cause instanceof Error ? cause.message : "Unable to download image"));
  }, [attachmentContext, attributes.attachmentId, attributes.filename]);

  return (
    <div
      ref={rootRef}
      data-mango-attachment-id={attributes.attachmentId}
      data-selected={selected || undefined}
      onPointerEnter={onPointerEnter}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest?.("button")) return;
        onSelect?.();
      }}
      style={{ position: "relative", display: "flex", justifyContent: attributes.alignment === "left" ? "flex-start" : attributes.alignment === "right" ? "flex-end" : "center", cursor: "pointer" }}
    >
      <div
        ref={frameRef}
        data-mango-tiptap-image-frame="true"
        data-drag-handle={editable ? "true" : undefined}
        style={{ position: "relative", display: "inline-block", maxWidth: attributes.layout === "wide" ? "100%" : "min(100%, 840px)", lineHeight: 0, cursor: "pointer" }}
      >
        {objectURL ? (
          <img
            src={objectURL}
            alt={attributes.alt || attributes.filename}
            title={attributes.title || attributes.filename}
            draggable={false}
            style={{
              display: "block",
              maxWidth: "100%",
              width: resizingDimensions?.width || attributes.displayWidth || attributes.width || undefined,
              minWidth: 32,
              minHeight: 32,
              height: resizingDimensions?.height || attributes.displayHeight || undefined,
              objectFit: "contain",
              borderRadius: 6,
              outline: selected ? "2px solid #0ea5e9" : "none",
              outlineOffset: selected ? 2 : undefined,
              cursor: "pointer",
              userSelect: "none",
            }}
          />
        ) : (
          <span role={error ? "alert" : undefined} style={{ display: "inline-flex", minWidth: 120, minHeight: 64, alignItems: "center", justifyContent: "center", lineHeight: 1.35 }}>
            {error || (eligible ? "Loading image…" : attributes.alt || attributes.filename || "Attached image")}
            {error && <button type="button" onClick={() => setRetryKey((current) => current + 1)}>Retry</button>}
          </span>
        )}
        {selected && (
          <>
            <div data-mango-tiptap-image-actions="true" contentEditable={false} style={{ position: "absolute", left: "calc(100% + 8px)", top: 4, zIndex: 5, display: "flex", gap: 5, padding: 3, border: "1px solid #bae6fd", borderRadius: 9, background: "#ffffff", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}>
              {editable && onImageChatRequest && (
                <button
                  type="button"
                  aria-label="Comment on image"
                  title="Comment on image"
                  data-mango-tiptap-image-comment="true"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  onClick={(event) => { event.stopPropagation(); onImageChatRequest(imageAction()); }}
                  style={{ ...IMAGE_ICON_BUTTON_STYLE, color: "#0369a1" }}
                >
                  <ChatIcon color="#0369a1" />
                </button>
              )}
              {editable && onImageNodeRequest && (
                <button
                  type="button"
                  aria-label="Create node from image"
                  title="Create node from image"
                  data-mango-tiptap-image-create-node="true"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  onClick={(event) => { event.stopPropagation(); onImageNodeRequest(imageAction()); }}
                  style={{ ...IMAGE_ICON_BUTTON_STYLE, color: "#0f766e" }}
                >
                  <EditorSelectionNodeIcon />
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Download image"
              title="Download image"
              data-mango-inline-image-download="true"
              contentEditable={false}
              onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
              onClick={(event) => { event.stopPropagation(); downloadImage(); }}
              style={{ ...IMAGE_ICON_BUTTON_STYLE, position: "absolute", right: 7, bottom: 7, zIndex: 3, background: "rgba(15,23,42,.82)", color: "#ffffff", fontSize: 19, lineHeight: 1 }}
            >
              ⇩
            </button>
            {editable && updateAttributes && IMAGE_RESIZE_HANDLES.map((handle) => (
              <button
                key={handle.direction}
                type="button"
                aria-label={`Resize image from ${handle.label}`}
                title={`Resize image from ${handle.label}`}
                data-mango-tiptap-image-resize-handle={handle.direction}
                contentEditable={false}
                onPointerDown={(event) => beginResize(handle.direction, event)}
                style={{ position: "absolute", zIndex: 4, width: 10, height: 10, boxSizing: "border-box", padding: 0, border: "2px solid #0284c7", borderRadius: 2, background: "#ffffff", cursor: handle.cursor, ...handle.position }}
              />
            ))}
          </>
        )}
        {previewOpen && (
          <EditorImagePreviewModal
            label={`Preview ${attributes.filename || "image"}`}
            src={previewObjectURL}
            loading={!previewObjectURL && !previewError}
            emptyLabel={previewError || "Preview unavailable"}
            copyable={Boolean(previewObjectURL)}
            onClose={() => setPreviewOpen(false)}
            onDownload={downloadImage}
            onRetry={previewError ? () => setPreviewRetryKey((current) => current + 1) : undefined}
          />
        )}
      </div>
    </div>
  );
};

function attachmentNodeViewExtension(
  contextRef: React.MutableRefObject<EditorImageAttachmentContext | undefined>,
  actionsRef: React.MutableRefObject<Pick<MangoTiptapEditorProps, "onImageChatRequest" | "onImageNodeRequest">>,
): AnyExtension {
  const ImageNodeView: React.FC<ReactNodeViewProps> = ({ node, selected, updateAttributes, editor, getPos }) => {
    const selectImage = () => {
      const position = getPos();
      if (typeof position !== "number") return;
      (editor.view.dom as HTMLElement).focus({ preventScroll: true });
      editor.commands.setNodeSelection(position);
    };
    return (
      <NodeViewWrapper>
        <MangoAuthenticatedImage
          attributes={node.attrs as MangoStaticAttachmentImageProps}
          attachmentContext={contextRef.current}
          selected={selected}
          editable={editor.isEditable}
          updateAttributes={updateAttributes}
          onSelect={selectImage}
          onImageChatRequest={actionsRef.current.onImageChatRequest}
          onImageNodeRequest={actionsRef.current.onImageNodeRequest}
        />
      </NodeViewWrapper>
    );
  };
  return MangoAttachmentImage.extend({
    addNodeView() {
      return ReactNodeViewRenderer(ImageNodeView, {
        className: "mango-tiptap-image-placement",
        attrs: ({ node }) => mangoTiptapImagePlacementDOMAttributes(node.attrs),
        stopEvent: ({ event }) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("button")) return true;
          return event.type !== "mousedown"
            && event.type !== "copy"
            && event.type !== "cut"
            && event.type !== "paste"
            && event.type !== "drop"
            && !event.type.startsWith("drag");
        },
      });
    },
  });
}


export const MangoTiptapEditor: React.FC<MangoTiptapEditorProps> = ({
  value,
  editable = true,
  outlineStyle = DEFAULT_EDITOR_OUTLINE_STYLE,
  ariaLabel,
  placeholder,
  dataAttributes,
  className,
  style,
  companyID,
  resourceType,
  resourceID,
  documentID,
  requestJSON,
  subscribeToCanonicalChange,
  attachmentContext,
  mentionUsers = EMPTY_MENTION_USERS,
  onEntityOpen,
  annotations = EMPTY_ANNOTATIONS,
  onEntityLink,
  target,
  onTargetHandled,
  formattingControllerRef,
  formattingControllerActive = true,
  onFocus,
  onBlur,
  onConflict,
  onError,
  onSaveStateChange,
  onRecoveryStorageError,
  onRecoveryStorageRecovered,
  onAnnotationActivate,
  onSelectionChatRequest,
  onImageChatRequest,
  onImageNodeRequest,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
  onSelectionHighlightColorChange,
  onSelectionTextAlignmentChange,
  onLifecycleChange,
  onAnnotationsChange,
}) => {
  const traceRenderStartedAt = editorTraceNow();
  const traceContextRef = useRef<ReturnType<typeof createEditorTraceContext> | undefined>(undefined);
  if (traceContextRef.current === undefined) {
    traceContextRef.current = createEditorTraceContext({ resourceType, documentLabel: ariaLabel });
  }
  const traceContext = traceContextRef.current;
  const initialRef = useRef<ReturnType<typeof initialDocument> | null>(null);
  if (!initialRef.current) initialRef.current = traceEditorFunction(
    traceContext, "editor.initial_document.parse", "editor.initialize", () => initialDocument(value),
  );
  const initial = initialRef.current;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const formattingControllerInstanceRef = useRef<MangoTiptapFormattingController | null>(null);
  const formattingControllerActiveRef = useRef(formattingControllerActive);
  const syncRef = useRef<MangoTiptapSync | null>(null);
  const syncStartedRef = useRef(false);
  const syncPreparationRef = useRef<Promise<void> | null>(null);
  const visibleRef = useRef(false);
  const attachmentContextRef = useRef(attachmentContext);
  const imageActionsRef = useRef({ onImageChatRequest, onImageNodeRequest });
  const mentionUsersRef = useRef(normalizedMentionUsers(mentionUsers));
  const entityLinkActionRef = useRef(onEntityLink);
  const universalPickerDraftRef = useRef<UniversalPickerDraft | null>(null);
  const outlineStyleRef = useRef(outlineStyle);
  mentionUsersRef.current = normalizedMentionUsers(mentionUsers);
  const currentDocumentRef = useRef(initial.document);
  const ownerAnnotationsRef = useRef<readonly MangoTiptapAnnotation[]>(annotations);
  const mappedAnnotationsRef = useRef<readonly MangoTiptapAnnotation[]>(annotations);
  const persistedAnnotationsRef = useRef<readonly MangoTiptapPersistedAnnotation[]>([]);
  const lifecycleRef = useRef<MangoEditorLifecycle>(null!);
  if (!lifecycleRef.current) {
    lifecycleRef.current = new MangoEditorLifecycle(traceContext);
  }
  const dirtyMetricReleaseRef = useRef<(() => void) | null>(null);
  const [editorActive, setEditorActive] = useState(false);
  const [liveSurfaceReady, setLiveSurfaceReady] = useState(false);
  const pointerActivationPendingRef = useRef(false);
  const [document, setDocument] = useState(initial.document);
  const [error, setError] = useState(initial.error ?? "");
  const [recoveryStorageError, setRecoveryStorageError] = useState("");
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    conflict: MangoTiptapConflict;
    resolve: (choice: "keep-local" | "use-canonical") => Promise<void>;
  } | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [selectionAction, setSelectionAction] = useState<MangoTiptapSelectionAction | null>(null);
  const [creatingSelectionNode, setCreatingSelectionNode] = useState(false);
  const [renderedAnnotations, setRenderedAnnotations] = useState<readonly MangoTiptapAnnotation[]>(annotations);
  const [tableActive, setTableActive] = useState(false);
  const [activeTableFrame, setActiveTableFrame] = useState<MangoTiptapTableFrame | null>(null);
  const [tableGrowthDrag, setTableGrowthDrag] = useState<MangoTiptapTableGrowthDrag | null>(null);
  const tableGrowthDragRef = useRef<MangoTiptapTableGrowthDrag | null>(null);
  const [universalPickerDraft, setUniversalPickerDraft] = useState<UniversalPickerDraft | null>(null);
  const [tableContextMenu, setTableContextMenu] = useState<{ x: number; y: number } | null>(null);
  const latestTargetRequestRef = useRef(0);
  const callbacksRef = useRef({
    onFocus, onBlur, onConflict, onError, onSaveStateChange,
    onRecoveryStorageError, onRecoveryStorageRecovered,
    onSelectionFontSizeChange, onSelectionInlineFormatChange,
    onSelectionHighlightColorChange, onSelectionTextAlignmentChange,
    onSelectionChatRequest, onLifecycleChange, onAnnotationsChange,
    onTargetHandled,
  });
  callbacksRef.current = {
    onFocus, onBlur, onConflict, onError, onSaveStateChange,
    onRecoveryStorageError, onRecoveryStorageRecovered,
    onSelectionFontSizeChange, onSelectionInlineFormatChange,
    onSelectionHighlightColorChange, onSelectionTextAlignmentChange,
    onSelectionChatRequest, onLifecycleChange, onAnnotationsChange,
    onTargetHandled,
  };
  attachmentContextRef.current = attachmentContext;
  imageActionsRef.current = { onImageChatRequest, onImageNodeRequest };
  formattingControllerActiveRef.current = formattingControllerActive;
  ownerAnnotationsRef.current = annotations;
  entityLinkActionRef.current = onEntityLink;
  outlineStyleRef.current = outlineStyle;

  useLayoutEffect(() => {
    recordEditorTraceDuration(traceContext, "react.mango_tiptap_editor.commit", "react.commit", traceRenderStartedAt, {
      active: editorActive,
      editable,
    });
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const unregister = root ? registerEditorTraceRoot(traceContext, root) : () => {};
    return () => {
      unregister();
      releaseEditorTraceContext(traceContext);
    };

  }, [traceContext]);
  useEffect(() => {
    const unsubscribe = lifecycleRef.current.subscribe((snapshot) => {
      traceEditorFunction(traceContext, "editor.lifecycle_listener", "editor.lifecycle", () => {
      const active = snapshot.state === "active" || snapshot.state === "dirty";
      setEditorActive((current) => current === active ? current : active);
      const root = rootRef.current;
      if (root) {
        root.dataset.mangoEditorState = snapshot.state;
        if (snapshot.pinned) root.dataset.mangoEditorPinned = "true";
        else delete root.dataset.mangoEditorPinned;
      }
      if (snapshot.state === "dirty" && !dirtyMetricReleaseRef.current) {
        dirtyMetricReleaseRef.current = trackEditorRuntimeResource("dirty_editors");
      } else if (snapshot.state !== "dirty" && dirtyMetricReleaseRef.current) {
        dirtyMetricReleaseRef.current();
        dirtyMetricReleaseRef.current = null;
      }
      traceEditorFunction(
        traceContext,
        "host.on_lifecycle_change",
        "editor.pin_callback",
        () => callbacksRef.current.onLifecycleChange?.(snapshot),
      );
      }, {
        state: snapshot.state,
        pinned: snapshot.pinned,
        pending_count: snapshot.pendingCount,
      });
    });
    return () => {
      unsubscribe();
      dirtyMetricReleaseRef.current?.();
      dirtyMetricReleaseRef.current = null;
    };
  }, []);

  const deactivate = useCallback(async (): Promise<boolean> => {
    if (!lifecycleRef.current.requestSleep()) return false;
    setDocument(currentDocumentRef.current);
    setRenderedAnnotations((current) => mangoTiptapAnnotationsEqual(current, mappedAnnotationsRef.current)
      ? current
      : mappedAnnotationsRef.current);
    const sync = syncRef.current;
    syncRef.current = null;
    syncStartedRef.current = false;
    syncPreparationRef.current = null;
    if (sync) await sync.shutdown();
    if (lifecycleRef.current.getSnapshot().state === "safely-inactive") {
      lifecycleRef.current.finishDeactivation();
    }
    return true;
  }, []);

  const updateSelectionState = useCallback((editor: Editor) => traceEditorFunction(traceContext, "editor.update_selection_state", "editor.selection", () => {
    const state = readMangoTiptapSelectionState(editor);
    const tableFrame = rootRef.current ? readActiveMangoTiptapTableFrame(editor, rootRef.current) : null;
    setTableActive(Boolean(tableFrame));
    setActiveTableFrame(tableFrame);
    callbacksRef.current.onSelectionFontSizeChange?.(state.fontSize);
    callbacksRef.current.onSelectionHighlightColorChange?.(state.highlightColor);
    callbacksRef.current.onSelectionTextAlignmentChange?.(state.textAlignment);
    callbacksRef.current.onSelectionInlineFormatChange?.({
      bold: state.bold,
      underline: state.underline,
      italic: state.italic,
      strikethrough: state.strikethrough,
    });
    const selection = editor.state.selection;
    if (selection.empty || !(selection instanceof TextSelection)) {
      setSelectionAction(null);
      return;
    }
    const root = rootRef.current;
    const rootRect = root?.getBoundingClientRect();
    const ownerSelection = root?.ownerDocument.getSelection();
    const selectionRange = ownerSelection?.rangeCount ? ownerSelection.getRangeAt(0) : null;
    const firstSelectionRect = selectionRange && root?.contains(selectionRange.commonAncestorContainer)
      ? Array.from(selectionRange.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0)
      : undefined;
    const fromCoords = editor.view.coordsAtPos(selection.from);
    const toCoords = editor.view.coordsAtPos(selection.to);
    const actionRect = firstSelectionRect ?? {
      left: Math.min(fromCoords.left, toCoords.left),
      right: Math.max(fromCoords.right, toCoords.right),
      top: Math.min(fromCoords.top, toCoords.top),
      height: Math.max(20, Math.min(fromCoords.bottom, toCoords.bottom) - Math.min(fromCoords.top, toCoords.top)),
    };
    const actionPosition = calculateEditorSelectionActionPosition({
      rect: actionRect,
      isForwardSelection: true,
      boundaryWidth: root?.clientWidth || rootRect?.width || 0,
      containerLeft: rootRect?.left,
      containerTop: rootRect?.top,
      rightInset: 44,
      scrollLeft: root?.scrollLeft,
      scrollTop: root?.scrollTop,
    });
    setSelectionAction({
      from: selection.from,
      to: selection.to,
      quote: editor.state.doc.textBetween(selection.from, selection.to, "\n", "\n"),
      x: actionPosition.left,
      y: actionPosition.top,
    });
  }), [traceContext]);

  const publishAnnotationPositions = useCallback((persisted: readonly MangoTiptapPersistedAnnotation[]) => {
    persistedAnnotationsRef.current = [...persisted];
    const merged = mergeMangoTiptapAnnotationPositions(ownerAnnotationsRef.current, persisted);
    const changed = !mangoTiptapAnnotationsEqual(mappedAnnotationsRef.current, merged);
    mappedAnnotationsRef.current = merged;
    setRenderedAnnotations((current) => mangoTiptapAnnotationsEqual(current, merged) ? current : merged);
    if (changed) {
      if (editorRef.current) updateMangoTiptapAnnotations(editorRef.current, merged);
      callbacksRef.current.onAnnotationsChange?.(merged);
    }
  }, []);

  const prepare = useCallback((): Promise<void> => {
    if (syncPreparationRef.current) return syncPreparationRef.current;
    const preparation = (async () => {
      syncStartedRef.current = true;
      const sync = new MangoTiptapSync({
      companyID,
      resourceType,
      resourceID,
      documentID,
      requestJSON,
      traceContext,
      repairRecoveredDocument: repairMangoTiptapRecoveredDocument,
      subscribeToCanonicalChange: subscribeToCanonicalChange ?? ((recover, localClientID) => {
        const scope = realtimeEditorJSONScope(resourceType, resourceID, documentID);
        return subscribeRealtimeScope(attachmentContext?.apiBase ?? "", companyID, scope, {
          onEditorSnapshotRequired: (message) => {
            if (message.client_id !== localClientID) recover();
          },
          onEditorDocumentDeleted: (message) => {
            if (message.client_id !== localClientID) recover();
          },
          onRecover: recover,
        });
      }),
      onDocument: (canonical) => {
        const editor = editorRef.current;
        const stableCanonical = editor ? documentWithCurrentMissingBlockIDs(canonical, editor.state.doc) : canonical;
        const normalizedCanonical = documentWithUniqueBlockIDs(stableCanonical);
        if (editor) {
          const canonicalNode = editor.schema.nodeFromJSON(normalizedCanonical.document);
          if (editor.state.doc.eq(canonicalNode)) {
            currentDocumentRef.current = normalizedCanonical;
            setError("");
            return;
          }
          editor.commands.setContent(normalizedCanonical.document, { emitUpdate: false, errorOnInvalidContent: true });
        }
        setDocument(normalizedCanonical);
        currentDocumentRef.current = normalizedCanonical;
        setError("");
      },
      onAnnotations: (canonicalAnnotations) => publishAnnotationPositions(canonicalAnnotations),
      onPendingChange: (count) => {
        lifecycleRef.current.setPendingCount(count);
        if (count === 0 && !lifecycleRef.current.getSnapshot().nearViewport) {
          void deactivate();
        }
      },
      onSaveStateChange: (state) => callbacksRef.current.onSaveStateChange?.(state),
      onSnapshot: (snapshot, snapshotAnnotations) => {
        currentDocumentRef.current = snapshot;
        persistedAnnotationsRef.current = [...snapshotAnnotations];
      },
      onConflict: (conflict) => {
        setError("This text box changed elsewhere. Choose which version to keep before editing.");
        const resolve = async (choice: "keep-local" | "use-canonical") => {
          setResolvingConflict(true);
          try {
            await sync.resolveConflict(choice);
            setPendingConflict(null);
            setError("");
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Unable to resolve the text box conflict";
            setError(message);
            callbacksRef.current.onError?.(message);
            throw cause;
          } finally {
            setResolvingConflict(false);
          }
        };
        setPendingConflict({ conflict, resolve });
        callbacksRef.current.onConflict?.(conflict, resolve);
      },
      onError: (cause) => {
        const message = cause instanceof Error ? cause.message : "Unable to save this text box";
        setError(message);
        callbacksRef.current.onError?.(message);
      },
      onRecoveryStorageError: (message) => {
        setRecoveryStorageError(message);
        callbacksRef.current.onRecoveryStorageError?.(message);
      },
      onRecoveryStorageRecovered: () => {
        setRecoveryStorageError("");
        callbacksRef.current.onRecoveryStorageRecovered?.();
      },
      });
      syncRef.current = sync;
      try {
        sync.setRealtimeVisible(visibleRef.current);
        await sync.start();
        if (syncRef.current === sync) lifecycleRef.current.finishPreparation();
      } catch (cause) {
        syncStartedRef.current = false;
        syncPreparationRef.current = null;
        const message = cause instanceof Error ? cause.message : "Unable to prepare this text box";
        setError(message);
        callbacksRef.current.onError?.(message);
      }
    })();
    syncPreparationRef.current = preparation;
    return preparation;
  }, [attachmentContext?.apiBase, companyID, deactivate, documentID, publishAnnotationPositions, requestJSON, resourceID, resourceType, subscribeToCanonicalChange, traceContext]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const near = entries.some((entry) => entry.isIntersecting);
      lifecycleRef.current.setNearViewport(near);
      if (near) void prepare();
      else void deactivate();
    }, { rootMargin: "600px 0px" });
    const release = trackEditorRuntimeResource("observers");
    observer.observe(root);
    return () => {
      observer.disconnect();
      release();
    };
  }, [prepare]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
      visibleRef.current = visible;
      const sync = syncRef.current;
      if (!visible) {
        sync?.setRealtimeVisible(false);
        return;
      }
      if (sync) {
        sync.setRealtimeVisible(true);
        if (sync.hasCompletedInitialRecovery()) {
          void sync.refreshCanonical().catch((cause) => callbacksRef.current.onError?.(cause instanceof Error ? cause.message : "Unable to refresh this text box"));
        }
        return;
      }
      void prepare();
    }, { rootMargin: "0px", threshold: 0 });
    const release = trackEditorRuntimeResource("observers");
    observer.observe(root);
    return () => {
      visibleRef.current = false;
      syncRef.current?.setRealtimeVisible(false);
      observer.disconnect();
      release();
    };
  }, [prepare]);

  useEffect(() => {
    if (initial.error) void prepare();
  }, [initial.error, prepare]);

  const activate = useCallback(async () => {
    const state = lifecycleRef.current.getSnapshot().state;
    if (state === "sleeping" || state === "safely-inactive" || state === "preparing") {
      await prepare();
      if (syncStartedRef.current) lifecycleRef.current.activate();
    }
  }, [prepare]);

  const activateFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-mango-entity-link="true"]')) return;
    event.preventDefault();
    pointerActivationPendingRef.current = true;
    setLiveSurfaceReady(false);
    const coordinates = { left: event.clientX, top: event.clientY };
    const root = event.currentTarget;
    const pointerBookmark = captureMangoTiptapPointerBookmark(root, event.target, coordinates);
    const preservedScrollTop = root.scrollTop;
    const preservedScrollLeft = root.scrollLeft;
    void activate().then(() => {
      let attempts = 0;
      const focusAtPointer = () => {
        const editor = editorRef.current;
        if (!editor || !root.contains(editor.view.dom)) {
          attempts += 1;
          if (attempts < 8) window.requestAnimationFrame(focusAtPointer);
          else pointerActivationPendingRef.current = false;
          return;
        }
        root.scrollTop = preservedScrollTop;
        root.scrollLeft = preservedScrollLeft;
        const bookmarkedDOMPosition = pointerBookmark
          ? resolveMangoTiptapPointerBookmark(editor.view.dom, pointerBookmark)
          : null;
        let requestedPosition: number | null = null;
        if (bookmarkedDOMPosition) {
          try {
            requestedPosition = editor.view.posAtDOM(bookmarkedDOMPosition.node, bookmarkedDOMPosition.offset);
          } catch {
            requestedPosition = null;
          }
        }
        if (requestedPosition === null) requestedPosition = editor.view.posAtCoords(coordinates)?.pos ?? null;
        if (requestedPosition !== null) editor.commands.setTextSelection(requestedPosition);
        (editor.view.dom as HTMLElement).focus({ preventScroll: true });
        root.scrollTop = preservedScrollTop;
        root.scrollLeft = preservedScrollLeft;
        pointerActivationPendingRef.current = false;
        setLiveSurfaceReady(true);
        window.requestAnimationFrame(() => {
          root.scrollTop = preservedScrollTop;
          root.scrollLeft = preservedScrollLeft;
        });
      };
      window.requestAnimationFrame(focusAtPointer);
    });
  }, [activate]);

  useEffect(() => registerMangoTiptapFlusher({
    companyID, resourceType, resourceID, documentID,
  }, async () => {
    await prepare();
    await syncRef.current?.flush();
  }), [companyID, documentID, prepare, resourceID, resourceType]);

  const attachmentExtension = useMemo(
    () => attachmentNodeViewExtension(attachmentContextRef, imageActionsRef),
    [],
  );
  const handleImageFiles = useCallback((files: File[], position: number | null) => {
    const context = attachmentContextRef.current;
    if (!context) return;
    const editor = editorRef.current;
    const alignment = editor ? readMangoTiptapInsertionAlignment(editor, position) : "left";
    void (async () => {
      await context.prepareResource?.();
      for (const file of files) {
        const uploaded = await uploadMangoAttachment(context.requestJSON, {
          companyID: context.companyID,
          resourceType: context.resourceType,
          resourceID: context.resourceID,
          file,
          sourceKind: "editor_paste",
          relationshipKind: "inline_image",
          informationID: context.informationID,
          editorSurface: context.editorSurface,
        });
        const content = createMangoTiptapAttachmentContent(uploaded.attachment, alignment);
        if (position === null) editorRef.current?.chain().focus().insertContent(content).run();
        else editorRef.current?.chain().focus().insertContentAt(position, content).run();
      }
    })().catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Unable to attach image";
      context.onError?.(message);
      syncRef.current?.reportFailure(message);
      callbacksRef.current.onError?.(message);
    });
  }, []);
  const handleRichClipboardPaste = useCallback((editor: Editor, clipboardData: DataTransfer): boolean => {
    const root = rootRef.current;
    if (!root) return false;
    const paste = readMangoTiptapClipboardPaste(root.ownerDocument, clipboardData);
    if (!paste) return false;
    const alignment = readMangoTiptapInsertionAlignment(editor);
    let insertionBookmark = editor.state.selection.getBookmark();
    const mapInsertionBookmark = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) insertionBookmark = insertionBookmark.map(transaction.mapping);
    };
    editor.on("transaction", mapInsertionBookmark);
    const loadingID = `paste-${Date.now()}-${pasteLoadingSequence += 1}`;
    let previewURL: string | undefined;
    try {
      if (paste.imageFiles[0] && typeof URL.createObjectURL === "function") {
        previewURL = URL.createObjectURL(paste.imageFiles[0]);
      }
    } catch {
      previewURL = undefined;
    }
    showMangoTiptapPasteLoading(editor, loadingID, editor.state.selection.from, paste.imageCount, previewURL);
    root.setAttribute("data-mango-rich-paste-importing", "true");
    void prepareMangoTiptapRichClipboardHTML(
      root.ownerDocument,
      paste.html,
      alignment,
      (request) => resolveMangoTiptapRichClipboardImage(
        request,
        paste.matchingFiles[request.index],
        attachmentContextRef.current,
      ),
    ).then((result) => {
      if (editor.isDestroyed) return;
      const selection = insertionBookmark.resolve(editor.state.doc);
      editor.off("transaction", mapInsertionBookmark);
      if (result.html.trim()) {
        const content = parseMangoTiptapRichClipboardContent(editor, root.ownerDocument, result.html);
        if (content.size > 0 && !editor.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, content).run()) {
          throw new Error("Unable to insert the pasted text and images");
        }
      }
      if (result.failedImageCount > 0) {
        const noun = result.failedImageCount === 1 ? "image" : "images";
        throw new Error(String(result.failedImageCount) + " pasted " + noun + " could not be imported. The text and " + String(result.importedImageCount) + " imported images were kept.");
      }
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Unable to import pasted images";
      setError(message);
      syncRef.current?.reportFailure(message);
      const context = attachmentContextRef.current;
      (context?.onError ?? callbacksRef.current.onError)?.(message);
    }).finally(() => {
      editor.off("transaction", mapInsertionBookmark);
      hideMangoTiptapPasteLoading(editor, loadingID);
      if (previewURL) URL.revokeObjectURL(previewURL);
      root.removeAttribute("data-mango-rich-paste-importing");
    });
    return true;
  }, []);
  const hasAttachmentContext = Boolean(attachmentContext);
  const openEntityLink = useCallback((entity: EditorEntityLink) => {
    openEditorEntityLink(entity, { onOpen: onEntityOpen });
  }, [onEntityOpen]);
  const updateUniversalPickerDraft = useCallback((draft: UniversalPickerDraft | null) => {
    universalPickerDraftRef.current = draft;
    setUniversalPickerDraft(draft);
  }, []);
  const linkTargetTypes = !onEntityLink
    ? EMPTY_LINK_TARGET_TYPES
    : resourceType === "node"
      ? NODE_LINK_TARGET_TYPES
    : resourceType === "logic_gate"
      ? LOGIC_GATE_LINK_TARGET_TYPES
      : resourceType === "project"
        ? PROJECT_LINK_TARGET_TYPES
        : EMPTY_LINK_TARGET_TYPES;
  const cancelUniversalPicker = useCallback(() => {
    const draft = universalPickerDraftRef.current;
    updateUniversalPickerDraft(null);
    const editor = editorRef.current;
    if (!draft || !editor || editor.isDestroyed) return;
    window.requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus(Math.min(draft.to, editor.state.doc.content.size));
    });
  }, [updateUniversalPickerDraft]);
  const chooseUniversalPickerEntity = useCallback(async (entity: EditorEntityLink, mode: UniversalEntityPickerMode) => {
    const draft = universalPickerDraftRef.current;
    const editor = editorRef.current;
    if (!draft || !editor || editor.isDestroyed) throw new Error("The editor is no longer available.");
    let relationshipCompleted = false;
    if (mode === "link") {
      const action = entityLinkActionRef.current;
      if (!action) throw new Error("Link mode is not available in this editor.");
      await action(entity);
      relationshipCompleted = true;
    }
    const triggerIsCurrent = draft.from >= 0
      && draft.to <= editor.state.doc.content.size
      && editor.state.doc.textBetween(draft.from, draft.to, "", "") === "#";
    if (!triggerIsCurrent) {
      updateUniversalPickerDraft(null);
      const message = relationshipCompleted
        ? "The resources were linked, but the editor changed before the reference chip could be inserted."
        : "The editor changed before the reference could be inserted. Open the picker again.";
      setError(message);
      callbacksRef.current.onError?.(message);
      if (!relationshipCompleted) throw new Error(message);
      return;
    }
    const inserted = editor.chain().focus().insertContentAt({ from: draft.from, to: draft.to }, [
      { type: "mangoEntityLink", attrs: mangoEntityLinkAttributes(entity) },
      { type: "text", text: " " },
    ]).run();
    if (!inserted) throw new Error("Unable to insert the selected reference.");
    updateUniversalPickerDraft(null);
    setError("");
  }, [updateUniversalPickerDraft]);
  const extensions = useMemo(() => createMangoTiptapExtensions({
    editable,
    attachmentImageExtension: attachmentExtension,
    getMentionUsers: () => mentionUsersRef.current,
    onImageFiles: hasAttachmentContext ? handleImageFiles : undefined,
  }), [attachmentExtension, editable, handleImageFiles, hasAttachmentContext]);

  const isActive = editorActive;

  useLayoutEffect(() => {
    if (!activeEditor || pointerActivationPendingRef.current) return undefined;
    const view = rootRef.current?.ownerDocument.defaultView;
    if (!view) {
      setLiveSurfaceReady(true);
      return undefined;
    }
    const frameID = view.requestAnimationFrame(() => {
      if (editorRef.current === activeEditor && rootRef.current?.contains(activeEditor.view.dom)) setLiveSurfaceReady(true);
    });
    return () => view.cancelAnimationFrame(frameID);
  }, [activeEditor]);

  useLayoutEffect(() => {
    if (!isActive || editorRef.current) return undefined;
    const releaseActive = trackEditorRuntimeResource("active_editors");
    const editor = traceEditorFunction(
      traceContext,
      "tiptap.editor.create",
      "tiptap.initialize",
      () => new Editor({
      extensions,
      content: currentDocumentRef.current.document,
      editable,
      enableContentCheck: true,
      emitContentError: true,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          "data-placeholder": placeholder ?? "",
          "data-mango-legacy-leading-date-heading": needsMangoTiptapLegacyDateHeadingBreak(currentDocumentRef.current) ? "true" : "false",
          class: "mango-tiptap-prosemirror",
        },
        handlePaste: (view, event, slice) => {
          const editor = editorRef.current;
          const clipboardData = event.clipboardData;
          if (!editor || !clipboardData) return false;
          if (handleRichClipboardPaste(editor, clipboardData) || handleMangoTiptapTableClipboardPaste(view, event, slice)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        handleDrop: (view, event, slice, moved) => handleMangoTiptapImageDrop(
          view,
          event,
          slice,
          moved,
          editorRef.current ? readMappedMangoTiptapAnnotations(editorRef.current) : [],
        ),
        handleKeyDown: (view, event) => {
          if (event.key === "#" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
            const { selection } = view.state;
            if (selection.empty && !universalPickerDraftRef.current) {
              event.preventDefault();
              const from = selection.from;
              const transaction = view.state.tr.insertText("#", from, from).scrollIntoView();
              view.dispatch(transaction);
              const to = from + 1;
              const coordinates = view.coordsAtPos(to);
              updateUniversalPickerDraft({
                from,
                to,
                anchor: { left: coordinates.left, top: coordinates.bottom + 8 },
              });
              setSelectionAction(null);
              return true;
            }
          }
          const keyboardEntityElement = (event.target as HTMLElement | null)?.closest?.('[data-mango-entity-link="true"]') as HTMLElement | null;
          if (keyboardEntityElement && (event.key === "Enter" || event.key === " ")) {
            const entityType = keyboardEntityElement.dataset.mangoEntityType;
            const entityID = keyboardEntityElement.dataset.mangoEntityId?.trim() ?? "";
            const label = keyboardEntityElement.dataset.mangoEntityLabel?.trim() ?? "";
            if ((entityType === "node" || entityType === "logic_gate" || entityType === "project" || entityType === "email_message") && entityID && label) {
              event.preventDefault();
              openEntityLink({
                entityType,
                entityID,
                label,
                ...(entityType === "email_message" ? {
                  emailMessageID: keyboardEntityElement.dataset.mangoEmailMessageId?.trim() || undefined,
                  emailThreadID: keyboardEntityElement.dataset.mangoEmailThreadId?.trim() || undefined,
                  emailAccountEmail: keyboardEntityElement.dataset.mangoEmailAccountEmail?.trim().toLowerCase() || undefined,
                  emailSharedInboxID: keyboardEntityElement.dataset.mangoEmailSharedInboxId?.trim() || undefined,
                } : {}),
              });
              return true;
            }
          }
          const current = editorRef.current;
          if (event.key === "Escape") {
            setTableContextMenu(null);
            return false;
          }
          const suggestionOpen = typeof window !== "undefined"
            && Boolean(window.document.querySelector('[data-mango-tiptap-mention-menu="true"], [data-mango-universal-picker="true"]'));
          if (suggestionOpen && (event.key === "Enter" || event.key === "Tab")) return false;
          if (current && event.key === "Enter" && !event.shiftKey && handleMangoTiptapOutlineEnter(current, outlineStyleRef.current)) {
            event.preventDefault();
            return true;
          }
          if (event.key !== "Tab" || !current) return false;
          event.preventDefault();
          return event.shiftKey ? outdentMangoTiptapSelection(current) : indentMangoTiptapSelection(current);
        },
        handleDOMEvents: {
          mousedown: (_view, event) => {
            if ((event as MouseEvent).button !== 0) return false;
            const root = rootRef.current;
            if (root) preserveMangoTiptapCaretScroll(root);
            return false;
          },
          copy: (_view, event) => {
            const current = editorRef.current;
            if (!current) return false;
            return copySelectedMangoTiptapImage(current, event as ClipboardEvent, attachmentContextRef.current);
          },
          contextmenu: (view, event) => {
            const target = event.target instanceof Element ? event.target : null;
            const cell = target?.closest("td,th");
            const root = rootRef.current;
            if (!cell || !root || !view.dom.contains(cell)) return false;
            event.preventDefault();
            try {
              const position = Math.min(view.state.doc.content.size, view.posAtDOM(cell, 0) + 1);
              view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
            } catch {
              return false;
            }
            setTableContextMenu({ x: event.clientX, y: event.clientY });
            return true;
          },
        },
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          if (node.type.name !== "mangoEntityLink") return false;
          const entityType = node.attrs.entityType;
          const entityID = typeof node.attrs.entityId === "string" ? node.attrs.entityId.trim() : "";
          const label = typeof node.attrs.label === "string" ? node.attrs.label.trim() : "";
          if (!(["node", "logic_gate", "project", "email_message"] as const).includes(entityType) || !entityID || !label) return false;
          event.preventDefault();
          openEntityLink({ entityType, entityID, label, ...(entityType === "email_message" ? emailEntityMetadataFromRecord(node.attrs) : {}) });
          return true;
        },
      },
      onContentError: ({ error: contentError }) => {
        setError(`The JSON document is invalid and was not opened: ${contentError.message}`);
      },
      onFocus: ({ editor: focusedEditor }) => traceEditorFunction(
        traceContext,
        "tiptap.on_focus",
        "tiptap.callback",
        () => {
          const controller = formattingControllerInstanceRef.current;
          if (formattingControllerRef && controller) formattingControllerRef.current = controller;
          updateSelectionState(focusedEditor);
          callbacksRef.current.onFocus?.();
        },
      ),
      onBlur: () => traceEditorFunction(traceContext, "tiptap.on_blur", "tiptap.callback", () => {
        callbacksRef.current.onBlur?.();
        void syncRef.current?.flush().catch(() => undefined);
      }),
      onSelectionUpdate: ({ editor: activeEditor }) => updateSelectionState(activeEditor),
      onTransaction: ({ editor: transactionEditor, transaction }) => traceEditorFunction(
        traceContext,
        "tiptap.on_transaction",
        "tiptap.callback",
        () => {
          const pickerDraft = universalPickerDraftRef.current;
          if (pickerDraft && transaction.docChanged) {
            const mappedDraft = {
              ...pickerDraft,
              from: transaction.mapping.map(pickerDraft.from, 1),
              to: transaction.mapping.map(pickerDraft.to, -1),
            };
            universalPickerDraftRef.current = mappedDraft;
            setUniversalPickerDraft(mappedDraft);
          }
          if ((transaction.docChanged && !transaction.selectionSet) || transaction.storedMarksSet) {
            updateSelectionState(transactionEditor);
          }
          if (!transaction.docChanged) return;
          incrementEditorRuntimeMetric("transactions");
          mappedAnnotationsRef.current = [...readMappedMangoTiptapAnnotations(transactionEditor)];
        },
        {
          doc_changed: transaction.docChanged,
          selection_set: transaction.selectionSet,
          stored_marks_set: transaction.storedMarksSet,
          step_count: transaction.steps.length,
          document_size: transaction.doc.content.size,
        },
      ),
      onUpdate: ({ editor: activeEditor }) => traceEditorFunction(
        traceContext,
        "tiptap.on_update",
        "tiptap.callback",
        () => {
          lifecycleRef.current.markDirty();
          if (resourceType === "node" || resourceType === "project" || resourceType === "logic_gate") {
            markEditorHistoryChanged({ companyID, resourceType, resourceID });
          }
          syncRef.current?.schedule(() => compactMangoTiptapDocument({
            format: "mango-tiptap-json",
            schema_version: 1,
            document: traceEditorFunction(
              traceContext,
              "tiptap.get_json",
              "editor.snapshot",
              () => activeEditor.getJSON(),
            ),
          }, activeEditor.schema), false, () => traceEditorFunction(
            traceContext,
            "annotations.read_durable",
            "editor.snapshot",
            () => durableMangoTiptapAnnotations(readMappedMangoTiptapAnnotations(activeEditor)),
          ));
        },
      ),
    }),
    );
    const originalDispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (transaction) => {
      const previousTransactionID = traceContext?.currentTransactionID ?? 0;
      if (traceContext) {
        traceContext.transactionSequence += 1;
        traceContext.currentTransactionID = traceContext.transactionSequence;
      }
      const span = beginEditorTraceSpan(traceContext, "prosemirror.dispatch_transaction", "prosemirror.transaction", {
        doc_changed: transaction.docChanged,
        selection_set: transaction.selectionSet,
        step_count: transaction.steps.length,
        before_document_size: transaction.before.content.size,
        after_document_size: transaction.doc.content.size,
      });
      let outcome: "ok" | "error" = "ok";
      try {
        return runWithEditorTraceContext(traceContext, () => originalDispatch(transaction));
      } catch (cause) {
        outcome = "error";
        throw cause;
      } finally {
        endEditorTraceSpan(span, undefined, outcome);
        if (traceContext) traceContext.currentTransactionID = previousTransactionID;
      }
    };
    traceEditorFunction(traceContext, "annotations.plugin.register", "tiptap.initialize", () => {
      editor.registerPlugin(MangoTiptapAnnotations);
    });
    traceEditorFunction(traceContext, "annotations.plugin.initial_update", "tiptap.initialize", () => {
      updateMangoTiptapAnnotations(editor, mappedAnnotationsRef.current);
    });
    recordEditorDocumentStructure(traceContext, editor.state.doc, "editor_activated");
    editorRef.current = editor;
    setActiveEditor(editor);
    const controller: MangoTiptapFormattingController = {
      focus: () => { editor.commands.focus(); },
      applyFontSizeValue: (fontSize) => editor.chain().focus().setFontSize(`${Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(fontSize)))}px`).run(),
      adjustFontSize: (delta) => {
        const next = readMangoTiptapSelectionState(editor).fontSize + delta;
        return editor.chain().focus().setFontSize(`${Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(next)))}px`).run();
      },
      toggleInlineFormat: (command) => {
        if (command === "bold") return editor.chain().focus().toggleBold().run();
        if (command === "italic") return editor.chain().focus().toggleItalic().run();
        if (command === "underline") return editor.chain().focus().toggleUnderline().run();
        return editor.chain().focus().toggleStrike().run();
      },
      applyHighlightColor: (color) => color
        ? editor.chain().focus().setHighlight({ color }).run()
        : editor.chain().focus().unsetHighlight().run(),
      applyTextAlignment: (alignment) => {
        const selectedNode = (editor.state.selection as unknown as { node?: { type?: { name?: string } } }).node;
        const imageSelected = selectedNode?.type?.name === "mangoAttachmentImage";
        return imageSelected
          ? editor.commands.updateAttributes("mangoAttachmentImage", { alignment })
          : editor.chain().focus().setTextAlign(alignment).run();
      },
      insertLink: (href) => editor.chain().focus().extendMarkRange("link").setLink({ href }).run(),
      insertList: (kind) => kind === "checklist"
        ? editor.chain().focus().toggleTaskList().run()
        : editor.chain().focus().toggleBulletList().run(),
      toggleNumberedList: () => editor.chain().focus().toggleOrderedList().run(),
      indent: () => indentMangoTiptapSelection(editor),
      outdent: () => outdentMangoTiptapSelection(editor),
      insertTable: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      readFormatState: () => readMangoTiptapSelectionState(editor),
    };
    formattingControllerInstanceRef.current = controller;
    if (formattingControllerRef && formattingControllerActiveRef.current) formattingControllerRef.current = controller;
    updateSelectionState(editor);
    return () => {
      if (formattingControllerRef?.current === controller) formattingControllerRef.current = null;
      if (formattingControllerInstanceRef.current === controller) formattingControllerInstanceRef.current = null;
      editorRef.current = null;
      pointerActivationPendingRef.current = false;
      tableGrowthDragRef.current = null;
      setLiveSurfaceReady(false);
      setActiveTableFrame(null);
      setTableGrowthDrag(null);
      setActiveEditor((current) => current === editor ? null : current);
      editor.destroy();
      releaseActive();
    };
  }, [
    ariaLabel, editable, extensions, formattingControllerRef, handleRichClipboardPaste, isActive, openEntityLink, placeholder, updateSelectionState,
  ]);


  useEffect(() => {
    const controller = formattingControllerInstanceRef.current;
    if (!formattingControllerRef || !controller) return undefined;
    if (formattingControllerActive) formattingControllerRef.current = controller;
    else if (formattingControllerRef.current === controller) formattingControllerRef.current = null;
    return () => {
      if (formattingControllerRef.current === controller) formattingControllerRef.current = null;
    };
  }, [activeEditor, formattingControllerActive, formattingControllerRef]);

  useEffect(() => {
    const positionSource = editorRef.current
      ? durableMangoTiptapAnnotations(mappedAnnotationsRef.current)
      : persistedAnnotationsRef.current;
    const merged = mergeMangoTiptapAnnotationPositions(annotations, positionSource);
    const changed = !mangoTiptapAnnotationsEqual(mappedAnnotationsRef.current, merged);
    mappedAnnotationsRef.current = merged;
    setRenderedAnnotations((current) => mangoTiptapAnnotationsEqual(current, merged) ? current : merged);
    if (changed && editorRef.current) updateMangoTiptapAnnotations(editorRef.current, merged);
  }, [annotations]);

  useEffect(() => {
    if (!target || target.requestID === latestTargetRequestRef.current) return;
    latestTargetRequestRef.current = target.requestID;
    lifecycleRef.current.setTargeted(true);
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    void activate().then(() => {
      if (cancelled) return;
      const navigate = () => {
        attempts += 1;
        if (editorRef.current && navigateMangoTiptapTarget(editorRef.current, target)) {
          lifecycleRef.current.setTargeted(false);
          callbacksRef.current.onTargetHandled?.(target.requestID);
          return;
        }
        if (attempts < 8) {
          frame = window.requestAnimationFrame(navigate);
          return;
        }
        lifecycleRef.current.setTargeted(false);
        const message = "The requested editor location is no longer available.";
        setError(message);
        callbacksRef.current.onError?.(message);
      };
      frame = window.requestAnimationFrame(navigate);
    });
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activate, target]);

  useEffect(() => () => {
    const sync = syncRef.current;
    syncRef.current = null;
    syncStartedRef.current = false;
    syncPreparationRef.current = null;
    void sync?.shutdown();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onAnnotationActivate) return undefined;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; kind?: string }>).detail;
      if (detail?.id && detail.kind) onAnnotationActivate({ id: detail.id, kind: detail.kind });
    };
    root.addEventListener("mango:tiptap-annotation-activate", listener);
    return () => root.removeEventListener("mango:tiptap-annotation-activate", listener);
  }, [onAnnotationActivate]);

  const createNodeFromSelection = useCallback(async () => {
    const editor = editorRef.current;
    const action = selectionAction;
    if (!editor || !action || creatingSelectionNode) return;
    const title = normalizeEditorSelectionNodeTitle(action.quote);
    if (!title) {
      const message = "Highlight text before creating a Node.";
      setError(message);
      callbacksRef.current.onError?.(message);
      return;
    }
    setCreatingSelectionNode(true);
    setError("");
    try {
      const entity = await createNodeEntityFromSelection({ companyID, requestJSON }, action.quote);
      const currentSelection = editor.state.selection;
      const currentText = editor.state.doc.textBetween(action.from, action.to, "\n", "\n");
      if (currentSelection.from !== action.from || currentSelection.to !== action.to || currentText !== action.quote) {
        throw new Error("The Node was created, but the highlighted text changed before its link could be inserted. Select the text again and link the existing Node with #.");
      }
      editor.chain().focus().insertContentAt(
        { from: action.from, to: action.to },
        { type: "mangoEntityLink", attrs: mangoEntityLinkAttributes(entity) },
      ).run();
      setSelectionAction(null);
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create a Node from the highlighted text";
      setError(message);
      callbacksRef.current.onError?.(message);
    } finally {
      setCreatingSelectionNode(false);
    }
  }, [companyID, creatingSelectionNode, requestJSON, selectionAction]);

  const runTableContextCommand = useCallback((command: "add-row-before" | "add-row-after" | "add-column-before" | "add-column-after" | "delete-row" | "delete-column" | "delete-table") => {
    const editor = editorRef.current;
    setTableContextMenu(null);
    if (!editor) return;
    const chain = editor.chain().focus();
    if (command === "add-row-before") chain.addRowBefore().run();
    else if (command === "add-row-after") chain.addRowAfter().run();
    else if (command === "add-column-before") chain.addColumnBefore().run();
    else if (command === "add-column-after") chain.addColumnAfter().run();
    else if (command === "delete-row") chain.deleteRow().run();
    else if (command === "delete-column") chain.deleteColumn().run();
    else chain.deleteTable().run();
  }, []);

  useEffect(() => {
    if (!activeEditor || !tableActive) return undefined;
    const root = rootRef.current;
    const ownerWindow = root?.ownerDocument.defaultView;
    if (!root || !ownerWindow) return undefined;
    let frameID = 0;
    const update = () => {
      ownerWindow.cancelAnimationFrame(frameID);
      frameID = ownerWindow.requestAnimationFrame(() => {
        if (editorRef.current === activeEditor) setActiveTableFrame(readActiveMangoTiptapTableFrame(activeEditor, root));
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resizeObserver?.observe(activeEditor.view.dom);
    root.addEventListener("scroll", update, { passive: true });
    ownerWindow.addEventListener("resize", update);
    ownerWindow.addEventListener("scroll", update, true);
    update();
    return () => {
      ownerWindow.cancelAnimationFrame(frameID);
      resizeObserver?.disconnect();
      root.removeEventListener("scroll", update);
      ownerWindow.removeEventListener("resize", update);
      ownerWindow.removeEventListener("scroll", update, true);
    };
  }, [activeEditor, tableActive]);

  const beginTableGrowth = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !activeTableFrame) return;
    event.preventDefault();
    event.stopPropagation();
    setTableContextMenu(null);
    const pointerID = Number.isFinite(event.pointerId) ? event.pointerId : 1;
    const drag: MangoTiptapTableGrowthDrag = {
      pointerID,
      startX: event.clientX,
      startY: event.clientY,
      frame: activeTableFrame,
      growth: { rows: 0, columns: 0 },
    };
    tableGrowthDragRef.current = drag;
    setTableGrowthDrag(drag);
    try { event.currentTarget.setPointerCapture?.(pointerID); } catch { /* Pointer capture is optional. */ }
  }, [activeTableFrame]);

  const updateTableGrowth = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tableGrowthDragRef.current;
    if (!drag || (Number.isFinite(event.pointerId) && event.pointerId !== drag.pointerID)) return;
    event.preventDefault();
    const growth = calculateMangoTiptapTableGrowth({
      startX: drag.startX,
      startY: drag.startY,
      currentX: event.clientX,
      currentY: event.clientY,
      rowHeight: drag.frame.rowHeight,
      columnWidth: drag.frame.columnWidth,
    });
    if (growth.rows === drag.growth.rows && growth.columns === drag.growth.columns) return;
    const next = { ...drag, growth };
    tableGrowthDragRef.current = next;
    setTableGrowthDrag(next);
  }, []);

  const finishTableGrowth = useCallback((event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = tableGrowthDragRef.current;
    if (!drag || (Number.isFinite(event.pointerId) && event.pointerId !== drag.pointerID)) return;
    event.preventDefault();
    event.stopPropagation();
    tableGrowthDragRef.current = null;
    setTableGrowthDrag(null);
    try { event.currentTarget.releasePointerCapture?.(drag.pointerID); } catch { /* Pointer capture is optional. */ }
    const editor = editorRef.current;
    const root = rootRef.current;
    if (cancelled || !editor || (drag.growth.rows === 0 && drag.growth.columns === 0)) return;
    const preservedScrollTop = root?.scrollTop ?? 0;
    const preservedScrollLeft = root?.scrollLeft ?? 0;
    if (!growMangoTiptapTable(editor, drag.growth)) return;
    (editor.view.dom as HTMLElement).focus({ preventScroll: true });
    if (root) {
      root.scrollTop = preservedScrollTop;
      root.scrollLeft = preservedScrollLeft;
    }
    editor.view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => {
      if (editorRef.current === editor && rootRef.current) setActiveTableFrame(readActiveMangoTiptapTableFrame(editor, rootRef.current));
    });
  }, []);

  const renderStaticAttachment = useCallback((attributes: MangoStaticAttachmentImageProps) => (
    <MangoAuthenticatedImage
      attributes={attributes}
      attachmentContext={attachmentContext}
      onPointerEnter={editable ? activate : undefined}
    />
  ), [activate, attachmentContext, editable]);
  const tableHandleFrame = tableGrowthDrag?.frame ?? activeTableFrame;
  const tablePreviewWidth = tableHandleFrame
    ? tableHandleFrame.width + (tableGrowthDrag?.growth.columns ?? 0) * tableHandleFrame.columnWidth
    : 0;
  const tablePreviewHeight = tableHandleFrame
    ? tableHandleFrame.height + (tableGrowthDrag?.growth.rows ?? 0) * tableHandleFrame.rowHeight
    : 0;

  return (
    <div
      ref={rootRef}
      {...dataAttributes}
      className={className}
      style={{ position: "relative", minWidth: 0, minHeight: 0, ...style }}
      data-mango-editor-format="tiptap_json"
      data-mango-editor-editable={editable || undefined}
      data-mango-outline-style={outlineStyle}
      data-mango-editor-state={lifecycleRef.current.getSnapshot().state}
      data-mango-editor-pinned={lifecycleRef.current.getSnapshot().pinned || undefined}
      data-mango-editor-sync-mode="revisioned-json"
      data-mango-tiptap-live-ready={isActive && activeEditor && liveSurfaceReady ? "true" : undefined}
      onPointerDown={!isActive ? activateFromPointer : undefined}
      onFocusCapture={!isActive ? activate : undefined}
      onDoubleClick={!isActive ? activate : undefined}
    >
      {isActive && activeEditor && (
        <EditorContent
          editor={activeEditor}
          className="mango-tiptap-active-surface"
          data-mango-tiptap-live-surface="true"
          style={liveSurfaceReady ? undefined : { position: "absolute", inset: 0, zIndex: 1, opacity: 0 }}
        />
      )}
      {(!isActive || !activeEditor || !liveSurfaceReady) && (
        <MangoTiptapStaticRenderer
          value={document}
          annotations={renderedAnnotations}
          ariaLabel={ariaLabel}
          dataAttributes={isActive ? { "data-mango-tiptap-activation-cover": "true" } : undefined}
          style={{ minHeight: style?.minHeight ?? 80 }}
          renderAttachmentImage={renderStaticAttachment}
        />
      )}
      {isActive && editable && universalPickerDraft && (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={requestJSON}
          sourceType={resourceType === "huddle_logic_gate" || resourceType === "kpi" ? "logic_gate" : resourceType}
          linkTargetTypes={linkTargetTypes}
          anchor={universalPickerDraft.anchor}
          onChoose={chooseUniversalPickerEntity}
          onCancel={cancelUniversalPicker}
        />
      )}
      {pendingConflict ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, color: "#b91c1c", fontSize: 12, padding: "6px 8px" }}>
          <span>{error || "This text box changed elsewhere."}</span>
          <button type="button" disabled={resolvingConflict} onClick={() => void pendingConflict.resolve("keep-local").catch(() => undefined)}>Keep my version</button>
          <button type="button" disabled={resolvingConflict} onClick={() => void pendingConflict.resolve("use-canonical").catch(() => undefined)}>Use saved version</button>
        </div>
      ) : (error || recoveryStorageError) && <div role="alert" style={{ color: "#b91c1c", fontSize: 12, padding: "4px 8px" }}>{error || recoveryStorageError}</div>}
      {isActive && editable && tableContextMenu && (
        <FrameRightClickMenu
          x={tableContextMenu.x}
          y={tableContextMenu.y}
          ariaLabel="Table actions"
          width={224}
          minWidth={224}
          overflow="visible"
          onClose={() => setTableContextMenu(null)}
        >
          {([
            ["add-column-before", "Create column on the left"],
            ["add-column-after", "Create column on the right"],
            ["add-row-before", "Create row above"],
            ["add-row-after", "Create row below"],
          ] as const).map(([command, label], index) => (
            <React.Fragment key={command}>
              {index === 2 && <div role="separator" style={{ height: 1, margin: "4px 10px", background: "rgba(100,116,139,0.20)" }} />}
              <button type="button" role="menuitem" onClick={() => runTableContextCommand(command)} style={menuBtnBase}>{label}</button>
            </React.Fragment>
          ))}
          <div role="separator" style={{ height: 1, margin: "4px 10px", background: "rgba(100,116,139,0.20)" }} />
          {([
            ["delete-row", "Delete row"],
            ["delete-column", "Delete column"],
            ["delete-table", "Delete table"],
          ] as const).map(([command, label]) => (
            <button key={command} type="button" role="menuitem" onClick={() => runTableContextCommand(command)} style={{ ...menuBtnBase, color: "#dc2626" }}>{label}</button>
          ))}
        </FrameRightClickMenu>
      )}
      {isActive && editable && tableHandleFrame && (
        <>
          {tableGrowthDrag && (tableGrowthDrag.growth.rows > 0 || tableGrowthDrag.growth.columns > 0) && (
            <div
              aria-hidden="true"
              data-mango-tiptap-table-growth-preview="true"
              data-preview-rows={tableHandleFrame.rows + tableGrowthDrag.growth.rows}
              data-preview-columns={tableHandleFrame.columns + tableGrowthDrag.growth.columns}
              style={{
                position: "absolute",
                left: tableHandleFrame.left,
                top: tableHandleFrame.top,
                zIndex: 9,
                width: tablePreviewWidth,
                height: tablePreviewHeight,
                boxSizing: "border-box",
                pointerEvents: "none",
                border: "2px solid rgba(14,165,233,0.78)",
                backgroundColor: "rgba(224,242,254,0.18)",
                backgroundImage: "linear-gradient(to right, rgba(14,165,233,0.28) 1px, transparent 1px), linear-gradient(to bottom, rgba(14,165,233,0.28) 1px, transparent 1px)",
                backgroundSize: `${tableHandleFrame.columnWidth}px ${tableHandleFrame.rowHeight}px`,
              }}
            />
          )}
          <button
            type="button"
            aria-label="Drag to add table rows and columns"
            title="Drag to add table rows and columns"
            data-mango-tiptap-table-growth-handle="true"
            onPointerDown={beginTableGrowth}
            onPointerMove={updateTableGrowth}
            onPointerUp={(event) => finishTableGrowth(event)}
            onPointerCancel={(event) => finishTableGrowth(event, true)}
            style={{
              position: "absolute",
              left: tableHandleFrame.left + tablePreviewWidth - 10,
              top: tableHandleFrame.top + tablePreviewHeight - 10,
              zIndex: 10,
              width: 20,
              height: 20,
              padding: 0,
              border: "2px solid #ffffff",
              borderRadius: 6,
              background: "linear-gradient(135deg, #22d3ee, #7c3aed)",
              boxShadow: "0 4px 12px rgba(15,23,42,0.28)",
              cursor: "nwse-resize",
              touchAction: "none",
            }}
          />
        </>
      )}
      {isActive && editable && selectionAction && (
        <div
          role="toolbar"
          aria-label="Highlighted text actions"
          contentEditable={false}
          onPointerDown={(event) => event.preventDefault()}
          style={{ position: "absolute", left: selectionAction.x, top: selectionAction.y, zIndex: 12, display: "flex", gap: 4, padding: 3, borderRadius: 9, border: "1px solid #bae6fd", background: "#ffffff", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}
        >
          {onSelectionChatRequest && (
            <button
              type="button"
              aria-label="Comment on selection"
              title="Comment on selection"
              onClick={() => {
                onSelectionChatRequest(selectionAction);
                editorRef.current?.commands.setTextSelection(selectionAction.to);
                setSelectionAction(null);
              }}
              style={{ width: 30, height: 30, display: "inline-grid", placeItems: "center", padding: 0, borderRadius: 7, border: 0, background: "transparent", color: "#0369a1", cursor: "pointer" }}
            >
              <ChatIcon color="#0369a1" />
            </button>
          )}
          <button
            type="button"
            aria-label="Create node from this highlighted piece of text."
            title="Create node from this highlighted piece of text."
            disabled={creatingSelectionNode || !normalizeEditorSelectionNodeTitle(selectionAction.quote)}
            onClick={() => void createNodeFromSelection()}
            style={{ display: "inline-grid", placeItems: "center", width: 30, height: 30, borderRadius: 7, border: 0, background: "transparent", color: "#0f766e", cursor: creatingSelectionNode ? "wait" : "pointer" }}
          >
            <EditorSelectionNodeIcon />
          </button>
        </div>
      )}
    </div>
  );
};
