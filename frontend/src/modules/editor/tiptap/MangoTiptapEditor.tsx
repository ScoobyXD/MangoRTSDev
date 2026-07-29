import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Editor, type AnyExtension } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  downloadMangoAttachment,
  loadMangoAttachmentObjectURL,
  uploadMangoAttachment,
} from "../../attachments/attachmentApi";
import { realtimeEditorJSONScope, subscribeRealtimeScope } from "../../realtime/realtimeWebSocket";
import type { MentionableCompanyUser } from "../editorMentions";
import { EditorImagePreviewModal } from "../EditorImagePreviewModal.js";
import { EditorSelectionNodeIcon } from "../EditorSelectionNodeIcon.js";
import { ChatIcon } from "../NodeWorkspaceSurfaceShared.js";
import {
  createNodeEntityFromSelection,
  normalizeEditorSelectionNodeTitle,
  openEditorEntityLink,
  searchEditorEntityLinks,
  type EditorEntityLink,
} from "../editorEntityLinks.js";
import { calculateEditorSelectionActionPosition } from "../editorSelectionActions.js";
import { MangoEditorLifecycle, type MangoEditorLifecycleSnapshot } from "../editorLifecycle";
import { incrementEditorRuntimeMetric, trackEditorRuntimeResource } from "../editorRuntimeMetrics";
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
  createEmptyMangoTiptapDocument,
  needsMangoTiptapLegacyDateHeadingBreak,
  parseMangoTiptapDocument,
  serializeMangoTiptapDocument,
  type MangoTiptapDocument,
} from "./mangoTiptapDocument.js";
import {
  createMangoTiptapExtensions,
  indentMangoTiptapSelection,
  MangoAttachmentImage,
  outdentMangoTiptapSelection,
  readMangoTiptapSelectionState,
  type MangoAttachmentImageAttributes,
} from "./mangoTiptapExtensions.js";
import {
  countMangoTiptapRichClipboardImages,
  createMangoTiptapAttachmentContent,
  prepareMangoTiptapRichClipboardHTML,
  readMangoTiptapInsertionAlignment,
  resolveMangoTiptapRichClipboardImage,
} from "./mangoTiptapRichClipboard.js";
import { MangoTiptapStaticRenderer, type MangoStaticAttachmentImageProps } from "./MangoTiptapStaticRenderer.js";
import { registerMangoTiptapFlusher } from "./mangoTiptapFlushRegistry.js";
import { MangoTiptapSync, type MangoTiptapConflict, type MangoTiptapResourceType, type MangoTiptapSaveState } from "./mangoTiptapSync.js";

export type MangoTiptapFormattingController = EditorDocumentFormattingController & {
  focus: () => void;
  flush: () => string;
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

export type MangoTiptapEditorProps = {
  value?: string;
  editable?: boolean;
  ariaLabel: string;
  placeholder?: string;
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
  annotations?: MangoTiptapAnnotation[];
  target?: MangoTiptapTarget | null;
  onTargetHandled?: (requestID: number) => void;
  formattingControllerRef?:
    | React.MutableRefObject<EditorDocumentFormattingController | null>
    | React.MutableRefObject<MangoTiptapFormattingController | null>;
  formattingControllerActive?: boolean;
  onChange?: (serialized: string) => void;
  onFlush?: (serialized: string) => void;
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

function initialDocument(value?: string): { document: MangoTiptapDocument; error?: string } {
  if (!value?.trim()) return { document: createEmptyMangoTiptapDocument() };
  const parsed = parseMangoTiptapDocument(value);
  return parsed.valid ? { document: parsed.value } : { document: createEmptyMangoTiptapDocument(), error: parsed.error };
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

export type AuthenticatedImageProps = {
  attributes: MangoStaticAttachmentImageProps;
  attachmentContext?: EditorImageAttachmentContext;
  selected?: boolean;
  editable?: boolean;
  updateAttributes?: (attributes: Partial<MangoAttachmentImageAttributes>) => void;
  onSelect?: () => void;
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
      const maximumWidth = Math.max(48, rootRef.current?.getBoundingClientRect().width || width);
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
      onClick={(event) => {
        if ((event.target as HTMLElement).closest?.("button")) return;
        onSelect?.();
      }}
      style={{ position: "relative", display: "flex", justifyContent: attributes.alignment === "left" ? "flex-start" : attributes.alignment === "right" ? "flex-end" : "center", margin: "8px 0", cursor: "pointer" }}
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
      return ReactNodeViewRenderer(ImageNodeView);
    },
  });
}


export const MangoTiptapEditor: React.FC<MangoTiptapEditorProps> = ({
  value,
  editable = true,
  ariaLabel,
  placeholder,
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
  target,
  onTargetHandled,
  formattingControllerRef,
  formattingControllerActive = true,
  onChange,
  onFlush,
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
  const initialRef = useRef<ReturnType<typeof initialDocument> | null>(null);
  if (!initialRef.current) initialRef.current = initialDocument(value);
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
  mentionUsersRef.current = normalizedMentionUsers(mentionUsers);
  const currentDocumentRef = useRef(initial.document);
  const currentSerializedRef = useRef("");
  if (!currentSerializedRef.current) {
    currentSerializedRef.current = serializeMangoTiptapDocument(initial.document);
  }
  const ownerAnnotationsRef = useRef<readonly MangoTiptapAnnotation[]>(annotations);
  const mappedAnnotationsRef = useRef<readonly MangoTiptapAnnotation[]>(annotations);
  const persistedAnnotationsRef = useRef<readonly MangoTiptapPersistedAnnotation[]>([]);
  const lifecycleRef = useRef(new MangoEditorLifecycle());
  const [lifecycle, setLifecycle] = useState<MangoEditorLifecycleSnapshot>(lifecycleRef.current.getSnapshot());
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
  const latestTargetRequestRef = useRef(0);
  const callbacksRef = useRef({
    onChange, onFlush, onFocus, onBlur, onConflict, onError, onSaveStateChange,
    onRecoveryStorageError, onRecoveryStorageRecovered,
    onSelectionFontSizeChange, onSelectionInlineFormatChange,
    onSelectionHighlightColorChange, onSelectionTextAlignmentChange,
    onSelectionChatRequest, onLifecycleChange, onAnnotationsChange,
    onTargetHandled,
  });
  callbacksRef.current = {
    onChange, onFlush, onFocus, onBlur, onConflict, onError, onSaveStateChange,
    onRecoveryStorageError, onRecoveryStorageRecovered,
    onSelectionFontSizeChange, onSelectionInlineFormatChange,
    onSelectionHighlightColorChange, onSelectionTextAlignmentChange,
    onSelectionChatRequest, onLifecycleChange, onAnnotationsChange,
    onTargetHandled,
  };
  attachmentContextRef.current = attachmentContext;
  imageActionsRef.current = { onImageChatRequest, onImageNodeRequest };
  formattingControllerActiveRef.current = formattingControllerActive;
  currentDocumentRef.current = document;
  ownerAnnotationsRef.current = annotations;

  useEffect(() => lifecycleRef.current.subscribe((snapshot) => {
    setLifecycle((current) => current.state === snapshot.state && current.pinned === snapshot.pinned
      && current.pendingCount === snapshot.pendingCount && current.targeted === snapshot.targeted
      && current.nearViewport === snapshot.nearViewport ? current : snapshot);
    callbacksRef.current.onLifecycleChange?.(snapshot);
  }), []);

  const deactivate = useCallback(async (): Promise<boolean> => {
    if (!lifecycleRef.current.requestSleep()) return false;
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

  const updateSelectionState = useCallback((editor: Editor) => {
    const state = readMangoTiptapSelectionState(editor);
    setTableActive(editor.isActive("table"));
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
  }, []);

  const publishAnnotationPositions = useCallback((persisted: readonly MangoTiptapPersistedAnnotation[]) => {
    persistedAnnotationsRef.current = [...persisted];
    const merged = mergeMangoTiptapAnnotationPositions(ownerAnnotationsRef.current, persisted);
    const changed = !mangoTiptapAnnotationsEqual(mappedAnnotationsRef.current, merged);
    mappedAnnotationsRef.current = merged;
    setRenderedAnnotations((current) => mangoTiptapAnnotationsEqual(current, merged) ? current : merged);
    if (editorRef.current) updateMangoTiptapAnnotations(editorRef.current, merged);
    if (changed) callbacksRef.current.onAnnotationsChange?.(merged);
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
        const serialized = serializeMangoTiptapDocument(canonical);
        if (serialized !== currentSerializedRef.current) {
          setDocument(canonical);
          currentDocumentRef.current = canonical;
          currentSerializedRef.current = serialized;
          callbacksRef.current.onChange?.(serialized);
          if (editorRef.current) {
            editorRef.current.commands.setContent(canonical.document, { emitUpdate: false, errorOnInvalidContent: true });
          }
        }
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
      onSnapshot: (snapshot, serialized, snapshotAnnotations) => {
        if (serialized !== currentSerializedRef.current) {
          setDocument(snapshot);
          currentDocumentRef.current = snapshot;
          currentSerializedRef.current = serialized;
          callbacksRef.current.onChange?.(serialized);
        }
        publishAnnotationPositions(snapshotAnnotations);
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
        lifecycleRef.current.finishPreparation();
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
  }, [attachmentContext?.apiBase, companyID, deactivate, documentID, publishAnnotationPositions, requestJSON, resourceID, resourceType, subscribeToCanonicalChange]);

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
        void sync.recover().catch((cause) => callbacksRef.current.onError?.(cause instanceof Error ? cause.message : "Unable to refresh this text box"));
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
    if (lifecycle.state === "sleeping" || lifecycle.state === "safely-inactive" || lifecycle.state === "preparing") {
      await prepare();
      if (syncStartedRef.current) lifecycleRef.current.activate();
    }
  }, [lifecycle.state, prepare]);

  const activateFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const coordinates = { left: event.clientX, top: event.clientY };
    const root = event.currentTarget;
    const preservedScrollTop = root.scrollTop;
    const preservedScrollLeft = root.scrollLeft;
    void activate().then(() => {
      let attempts = 0;
      const focusAtPointer = () => {
        const editor = editorRef.current;
        if (!editor) {
          attempts += 1;
          if (attempts < 8) window.requestAnimationFrame(focusAtPointer);
          return;
        }
        root.scrollTop = preservedScrollTop;
        root.scrollLeft = preservedScrollLeft;
        const position = editor.view.posAtCoords(coordinates);
        if (position) editor.commands.setTextSelection(position.pos);
        (editor.view.dom as HTMLElement).focus({ preventScroll: true });
        root.scrollTop = preservedScrollTop;
        root.scrollLeft = preservedScrollLeft;
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
      callbacksRef.current.onError?.(message);
    });
  }, []);
  const handleRichClipboardPaste = useCallback((editor: Editor, clipboardData: DataTransfer): boolean => {
    const html = clipboardData.getData("text/html");
    const root = rootRef.current;
    if (!root || !html.trim()) return false;
    const imageCount = countMangoTiptapRichClipboardImages(root.ownerDocument, html);
    if (imageCount === 0) return false;
    const imageFiles = Array.from(clipboardData.files).filter((file) => /^image\/(jpeg|png|gif|webp)$/i.test(file.type));
    const matchingFiles = imageFiles.length === imageCount ? imageFiles : [];
    const alignment = readMangoTiptapInsertionAlignment(editor);
    const selection = { from: editor.state.selection.from, to: editor.state.selection.to };
    const documentAtStart = editor.state.doc;
    root.setAttribute("data-mango-rich-paste-importing", "true");
    void prepareMangoTiptapRichClipboardHTML(
      root.ownerDocument,
      html,
      alignment,
      (request) => resolveMangoTiptapRichClipboardImage(
        request,
        matchingFiles[request.index],
        attachmentContextRef.current,
      ),
    ).then((result) => {
      if (editor.isDestroyed) return;
      if (!editor.state.doc.eq(documentAtStart)) {
        throw new Error("The document changed while pasted images were importing. Paste that selection again.");
      }
      if (result.html.trim()) editor.chain().focus().insertContentAt(selection, result.html).run();
      if (result.failedImageCount > 0) {
        const noun = result.failedImageCount === 1 ? "image" : "images";
        throw new Error(String(result.failedImageCount) + " pasted " + noun + " could not be imported. The text and " + String(result.importedImageCount) + " imported images were kept.");
      }
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Unable to import pasted images";
      setError(message);
      const context = attachmentContextRef.current;
      (context?.onError ?? callbacksRef.current.onError)?.(message);
    }).finally(() => {
      root.removeAttribute("data-mango-rich-paste-importing");
    });
    return true;
  }, []);
  const hasAttachmentContext = Boolean(attachmentContext);
  const searchEntityLinksForEditor = useCallback(
    (query: string) => searchEditorEntityLinks({ companyID, requestJSON }, query),
    [companyID, requestJSON],
  );
  const openEntityLink = useCallback((entity: EditorEntityLink) => {
    openEditorEntityLink(entity, { onOpen: onEntityOpen });
  }, [onEntityOpen]);
  const extensions = useMemo(() => createMangoTiptapExtensions({
    editable,
    attachmentImageExtension: attachmentExtension,
    getMentionUsers: () => mentionUsersRef.current,
    searchEntityLinks: searchEntityLinksForEditor,
    onEntityLinkSearchError: (message) => {
      setError(message);
      callbacksRef.current.onError?.(message);
    },
    onImageFiles: hasAttachmentContext ? handleImageFiles : undefined,
  }), [attachmentExtension, editable, handleImageFiles, hasAttachmentContext, searchEntityLinksForEditor]);

  const isActive = lifecycle.state === "active" || lifecycle.state === "dirty";

  useLayoutEffect(() => {
    if (!isActive || editorRef.current) return undefined;
    const releaseActive = trackEditorRuntimeResource("active_editors");
    const editor = new Editor({
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
        handlePaste: (_view, event) => {
          const editor = editorRef.current;
          const clipboardData = event.clipboardData;
          if (!editor || !clipboardData || !handleRichClipboardPaste(editor, clipboardData)) return false;
          event.preventDefault();
          return true;
        },
        handleKeyDown: (_view, event) => {
          const keyboardEntityElement = (event.target as HTMLElement | null)?.closest?.('[data-mango-entity-link="true"]') as HTMLElement | null;
          if (keyboardEntityElement && (event.key === "Enter" || event.key === " ")) {
            const entityType = keyboardEntityElement.dataset.mangoEntityType;
            const entityID = keyboardEntityElement.dataset.mangoEntityId?.trim() ?? "";
            const label = keyboardEntityElement.dataset.mangoEntityLabel?.trim() ?? "";
            if ((entityType === "node" || entityType === "logic_gate" || entityType === "project") && entityID && label) {
              event.preventDefault();
              openEntityLink({ entityType, entityID, label });
              return true;
            }
          }
          if (event.key !== "Tab") return false;
          if (typeof window !== "undefined" && window.document.querySelector('[data-mango-tiptap-mention-menu="true"], [data-mango-tiptap-entity-menu="true"]')) return false;
          const current = editorRef.current;
          if (!current) return false;
          if (current.isActive("table")) return false;
          event.preventDefault();
          return event.shiftKey ? outdentMangoTiptapSelection(current) : indentMangoTiptapSelection(current);
        },
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          if (node.type.name !== "mangoEntityLink") return false;
          const entityType = node.attrs.entityType;
          const entityID = typeof node.attrs.entityId === "string" ? node.attrs.entityId.trim() : "";
          const label = typeof node.attrs.label === "string" ? node.attrs.label.trim() : "";
          if (!(["node", "logic_gate", "project"] as const).includes(entityType) || !entityID || !label) return false;
          event.preventDefault();
          openEntityLink({ entityType, entityID, label });
          return true;
        },
      },
      onContentError: ({ error: contentError }) => {
        setError(`The JSON document is invalid and was not opened: ${contentError.message}`);
      },
      onFocus: ({ editor: focusedEditor }) => {
        const controller = formattingControllerInstanceRef.current;
        if (formattingControllerRef && controller) formattingControllerRef.current = controller;
        updateSelectionState(focusedEditor);
        callbacksRef.current.onFocus?.();
      },
      onBlur: () => {
        callbacksRef.current.onBlur?.();
        void syncRef.current?.flush().then(() => callbacksRef.current.onFlush?.(currentSerializedRef.current)).catch(() => undefined);
      },
      onSelectionUpdate: ({ editor: activeEditor }) => updateSelectionState(activeEditor),
      onTransaction: ({ editor: transactionEditor, transaction }) => {
        if (!transaction.docChanged || !transaction.selectionSet) updateSelectionState(transactionEditor);
        if (!transaction.docChanged) return;
        incrementEditorRuntimeMetric("transactions");
        mappedAnnotationsRef.current = [...readMappedMangoTiptapAnnotations(transactionEditor)];
      },
      onUpdate: ({ editor: activeEditor }) => {
        lifecycleRef.current.markDirty();
        callbacksRef.current.onSaveStateChange?.({ status: "pending" });
        syncRef.current?.schedule(() => ({
          format: "mango-tiptap-json",
          schema_version: 1,
          document: activeEditor.getJSON(),
        }), false, () => durableMangoTiptapAnnotations(readMappedMangoTiptapAnnotations(activeEditor)));
      },
    });
    editor.registerPlugin(MangoTiptapAnnotations);
    updateMangoTiptapAnnotations(editor, mappedAnnotationsRef.current);
    editorRef.current = editor;
    setActiveEditor(editor);
    const controller: MangoTiptapFormattingController = {
      focus: () => { editor.commands.focus(); },
      flush: () => {
        void syncRef.current?.flush();
        callbacksRef.current.onFlush?.(currentSerializedRef.current);
        return currentSerializedRef.current;
      },
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
      setActiveEditor((current) => current === editor ? null : current);
      editor.destroy();
      releaseActive();
    };
  }, [
    ariaLabel, editable, extensions, formattingControllerRef, handleRichClipboardPaste, isActive, openEntityLink, placeholder, updateSelectionState,
  ]);

  useEffect(() => {
    if (lifecycle.state !== "dirty") return undefined;
    return trackEditorRuntimeResource("dirty_editors");
  }, [lifecycle.state]);

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
    mappedAnnotationsRef.current = merged;
    setRenderedAnnotations((current) => mangoTiptapAnnotationsEqual(current, merged) ? current : merged);
    if (editorRef.current) updateMangoTiptapAnnotations(editorRef.current, merged);
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
        { type: "mangoEntityLink", attrs: { entityType: entity.entityType, entityId: entity.entityID, label: entity.label } },
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

  const renderStaticAttachment = useCallback((attributes: MangoStaticAttachmentImageProps) => (
    <MangoAuthenticatedImage attributes={attributes} attachmentContext={attachmentContext} />
  ), [attachmentContext]);

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ position: "relative", minWidth: 0, minHeight: 0, ...style }}
      data-mango-editor-format="tiptap_json"
      data-mango-editor-editable={editable || undefined}
      data-mango-editor-state={lifecycle.state}
      data-mango-editor-pinned={lifecycle.pinned || undefined}
      data-mango-editor-sync-mode="revisioned-json"
      onPointerDown={!isActive ? activateFromPointer : undefined}
      onFocusCapture={!isActive ? activate : undefined}
      onDoubleClick={!isActive ? activate : undefined}
    >
      {isActive && activeEditor ? <EditorContent editor={activeEditor} className="mango-tiptap-active-surface" /> : (
        <MangoTiptapStaticRenderer
          value={document}
          annotations={renderedAnnotations}
          ariaLabel={ariaLabel}
          style={{ minHeight: style?.minHeight ?? 80 }}
          renderAttachmentImage={renderStaticAttachment}
        />
      )}
      {pendingConflict ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, color: "#b91c1c", fontSize: 12, padding: "6px 8px" }}>
          <span>{error || "This text box changed elsewhere."}</span>
          <button type="button" disabled={resolvingConflict} onClick={() => void pendingConflict.resolve("keep-local").catch(() => undefined)}>Keep my version</button>
          <button type="button" disabled={resolvingConflict} onClick={() => void pendingConflict.resolve("use-canonical").catch(() => undefined)}>Use saved version</button>
        </div>
      ) : (error || recoveryStorageError) && <div role="alert" style={{ color: "#b91c1c", fontSize: 12, padding: "4px 8px" }}>{error || recoveryStorageError}</div>}
      {isActive && editable && tableActive && (
        <div role="toolbar" aria-label="Table controls" contentEditable={false} style={{ position: "absolute", right: 8, top: 8, zIndex: 11, display: "flex", flexWrap: "wrap", gap: 4, padding: 4, border: "1px solid #bae6fd", borderRadius: 8, background: "#ffffff" }}>
          <button type="button" onClick={() => editorRef.current?.chain().focus().addRowAfter().run()}>Add row</button>
          <button type="button" onClick={() => editorRef.current?.chain().focus().deleteRow().run()}>Delete row</button>
          <button type="button" onClick={() => editorRef.current?.chain().focus().addColumnAfter().run()}>Add column</button>
          <button type="button" onClick={() => editorRef.current?.chain().focus().deleteColumn().run()}>Delete column</button>
          <button type="button" onClick={() => editorRef.current?.chain().focus().toggleHeaderRow().run()}>Toggle header</button>
          <button type="button" onClick={() => editorRef.current?.chain().focus().deleteTable().run()}>Delete table</button>
        </div>
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
