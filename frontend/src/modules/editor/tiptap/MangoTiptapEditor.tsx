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
import { EditorSelectionNodeIcon } from "../EditorSelectionNodeIcon.js";
import { ChatIcon } from "../NodeWorkspaceSurfaceShared.js";
import {
  createNodeEntityFromSelection,
  normalizeEditorSelectionNodeTitle,
  openEditorEntityLink,
  searchEditorEntityLinks,
  type EditorEntityLink,
} from "../editorEntityLinks.js";
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
  MangoAttachmentImage,
  type MangoAttachmentImageAttributes,
} from "./mangoTiptapExtensions.js";
import { MangoTiptapStaticRenderer, type MangoStaticAttachmentImageProps } from "./MangoTiptapStaticRenderer.js";
import { registerMangoTiptapFlusher } from "./mangoTiptapFlushRegistry.js";
import { MangoTiptapSync, type MangoTiptapConflict, type MangoTiptapResourceType } from "./mangoTiptapSync.js";

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
  onChange?: (serialized: string) => void;
  onFlush?: (serialized: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onConflict?: (conflict: MangoTiptapConflict, resolve: (choice: "keep-local" | "use-canonical") => Promise<void>) => void;
  onError?: (message: string) => void;
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

type AuthenticatedImageProps = {
  attributes: MangoStaticAttachmentImageProps;
  attachmentContext?: EditorImageAttachmentContext;
  selected?: boolean;
  editable?: boolean;
  updateAttributes?: (attributes: Partial<MangoAttachmentImageAttributes>) => void;
  deleteNode?: () => void;
  onSelect?: () => void;
  onImageChatRequest?: (image: MangoTiptapImageAction) => void;
  onImageNodeRequest?: (image: MangoTiptapImageAction) => void;
};

const MangoAuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  attributes,
  attachmentContext,
  selected = false,
  editable = false,
  updateAttributes,
  deleteNode,
  onSelect,
  onImageChatRequest,
  onImageNodeRequest,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [eligible, setEligible] = useState(selected);
  const [objectURL, setObjectURL] = useState("");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewObjectURL, setPreviewObjectURL] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; latestWidth: number } | null>(null);
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

  const beginResize = (event: React.PointerEvent) => {
    if (!editable || !updateAttributes) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    dragRef.current = {
      startX: event.clientX,
      startWidth: attributes.displayWidth || attributes.width || rootRef.current?.getBoundingClientRect().width || 200,
      latestWidth: attributes.displayWidth || attributes.width || rootRef.current?.getBoundingClientRect().width || 200,
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current.latestWidth = Math.max(80, Math.round(dragRef.current.startWidth + moveEvent.clientX - dragRef.current.startX));
      setResizingWidth(dragRef.current.latestWidth);
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
      const width = dragRef.current?.latestWidth;
      cleanup();
      setResizingWidth(null);
      if (width) updateAttributes({ displayWidth: width });
    };
    const releaseListeners = trackEditorRuntimeResource("listeners");
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  };

  const imageAction = (): MangoTiptapImageAction => {
    const rect = rootRef.current?.getBoundingClientRect();
    return {
      attributes,
      objectURL,
      width: Math.max(1, Math.round(rect?.width || attributes.displayWidth || attributes.width || 1)),
      height: Math.max(1, Math.round(rect?.height || attributes.displayHeight || attributes.height || 1)),
      x: Math.round(rect?.left || 0),
      y: Math.round(rect?.bottom || 0) + 6,
    };
  };

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
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest?.("button")) return;
        if (!attachmentContext || !attributes.attachmentId) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect?.();
        setPreviewOpen(true);
      }}
      style={{ position: "relative", display: "flex", justifyContent: attributes.alignment === "left" ? "flex-start" : attributes.alignment === "right" ? "flex-end" : "center", margin: "8px 0" }}
    >
      {objectURL ? (
        <img
          src={objectURL}
          alt={attributes.alt || attributes.filename}
          title={attributes.title || attributes.filename}
          draggable={false}
          style={{
            display: "block",
            maxWidth: attributes.layout === "wide" ? "100%" : "min(100%, 840px)",
            width: resizingWidth || attributes.displayWidth || attributes.width || undefined,
            height: attributes.displayHeight || undefined,
            objectFit: "contain",
            borderRadius: 6,
            outline: selected ? "2px solid #0ea5e9" : "none",
          }}
        />
      ) : (
        <span role={error ? "alert" : undefined}>
          {error || (eligible ? "Loading image…" : attributes.alt || attributes.filename || "Attached image")}
          {error && <button type="button" onClick={() => setRetryKey((current) => current + 1)}>Retry</button>}
        </span>
      )}
      {selected && (
        <div contentEditable={false} style={{ position: "absolute", right: 4, top: 4, display: "flex", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "calc(100% - 8px)", gap: 4 }}>
          <button type="button" onClick={downloadImage}>Download</button>
          {attributes.linkHref && <a href={attributes.linkHref} target={attributes.linkTarget || undefined} rel={attributes.linkRel || "noopener noreferrer nofollow"} title={attributes.linkTitle || undefined} onClick={(event) => event.stopPropagation()}>Open link</a>}
          {objectURL && <button type="button" onClick={() => setPreviewOpen(true)}>Preview</button>}
          {editable && onImageChatRequest && <button type="button" onClick={() => onImageChatRequest(imageAction())}>Comment</button>}
          {editable && onImageNodeRequest && <button type="button" onClick={() => onImageNodeRequest(imageAction())}>Create Node</button>}
          {editable && <button type="button" onClick={() => updateAttributes?.({ alignment: "left" })}>Left</button>}
          {editable && <button type="button" onClick={() => updateAttributes?.({ alignment: "center" })}>Center</button>}
          {editable && <button type="button" onClick={() => updateAttributes?.({ alignment: "right" })}>Right</button>}
          {editable && <button type="button" onClick={() => updateAttributes?.({ layout: attributes.layout === "wide" ? "content" : "wide" })}>{attributes.layout === "wide" ? "Content width" : "Wide"}</button>}
          {editable && <button type="button" onPointerDown={beginResize}>Resize</button>}
          {editable && <button type="button" onClick={deleteNode}>Delete</button>}
        </div>
      )}
      {previewOpen && (
        <div
          contentEditable={false}
          role="dialog"
          aria-label={`Preview ${attributes.filename || "image"}`}
          onClick={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 2200, display: "grid", placeItems: "center", padding: 24, background: "rgba(15,23,42,.78)" }}
        >
          <div style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8 }}>
            <button type="button" aria-label="Download image" onClick={downloadImage}>Download</button>
            <button type="button" aria-label="Close image preview" onClick={() => setPreviewOpen(false)}>X</button>
          </div>
          {previewObjectURL
            ? <img src={previewObjectURL} alt={attributes.alt || attributes.filename} style={{ maxWidth: "95vw", maxHeight: "90vh", objectFit: "contain" }} />
            : previewError
              ? <div role="alert" style={{ color: "white" }}>{previewError} <button type="button" onClick={() => setPreviewRetryKey((current) => current + 1)}>Retry</button></div>
              : <div style={{ color: "white" }}>Loading original image…</div>}
        </div>
      )}
    </div>
  );
};

function attachmentNodeViewExtension(
  contextRef: React.MutableRefObject<EditorImageAttachmentContext | undefined>,
  actionsRef: React.MutableRefObject<Pick<MangoTiptapEditorProps, "onImageChatRequest" | "onImageNodeRequest">>,
): AnyExtension {
  const ImageNodeView: React.FC<ReactNodeViewProps> = ({ node, selected, updateAttributes, deleteNode, editor, getPos }) => {
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
          deleteNode={deleteNode}
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

function selectionState(editor: Editor) {
  const fontSizeValue = String(editor.getAttributes("textStyle").fontSize || "15").replace("px", "");
  const alignment = editor.getAttributes("paragraph").textAlign || editor.getAttributes("heading").textAlign || "left";
  return {
    fontSize: Number(fontSizeValue) || 15,
    highlightColor: (editor.getAttributes("highlight").color || null) as EditorHighlightColor | null,
    textAlignment: (["left", "center", "right"].includes(alignment) ? alignment : "left") as EditorTextAlignment,
    bold: editor.isActive("bold"),
    underline: editor.isActive("underline"),
    italic: editor.isActive("italic"),
    strikethrough: editor.isActive("strike"),
  };
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
  onChange,
  onFlush,
  onFocus,
  onBlur,
  onConflict,
  onError,
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
  const syncRef = useRef<MangoTiptapSync | null>(null);
  const syncStartedRef = useRef(false);
  const syncPreparationRef = useRef<Promise<void> | null>(null);
  const visibleRef = useRef(false);
  const attachmentContextRef = useRef(attachmentContext);
  const imageActionsRef = useRef({ onImageChatRequest, onImageNodeRequest });
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
    onChange, onFlush, onFocus, onBlur, onConflict, onError,
    onRecoveryStorageError, onRecoveryStorageRecovered,
    onSelectionFontSizeChange, onSelectionInlineFormatChange,
    onSelectionHighlightColorChange, onSelectionTextAlignmentChange,
    onSelectionChatRequest, onLifecycleChange, onAnnotationsChange,
    onTargetHandled,
  });
  callbacksRef.current = {
    onChange, onFlush, onFocus, onBlur, onConflict, onError,
    onRecoveryStorageError, onRecoveryStorageRecovered,
    onSelectionFontSizeChange, onSelectionInlineFormatChange,
    onSelectionHighlightColorChange, onSelectionTextAlignmentChange,
    onSelectionChatRequest, onLifecycleChange, onAnnotationsChange,
    onTargetHandled,
  };
  attachmentContextRef.current = attachmentContext;
  imageActionsRef.current = { onImageChatRequest, onImageNodeRequest };
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
    const state = selectionState(editor);
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
    const rootRect = rootRef.current?.getBoundingClientRect();
    const coords = editor.view.coordsAtPos(selection.to);
    setSelectionAction({
      from: selection.from,
      to: selection.to,
      quote: editor.state.doc.textBetween(selection.from, selection.to, "\n", "\n"),
      x: Math.max(4, Math.round(coords.left - (rootRect?.left || 0))),
      y: Math.max(4, Math.round(coords.bottom - (rootRect?.top || 0) + 4)),
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
        const content = {
          type: "mangoAttachmentImage",
          attrs: {
            attachmentId: uploaded.attachment.attachment_id,
            filename: uploaded.attachment.original_filename,
            mimeType: uploaded.attachment.mime_type,
            width: uploaded.attachment.original_width ?? null,
            height: uploaded.attachment.original_height ?? null,
            displayWidth: uploaded.attachment.original_width ?? null,
            displayHeight: uploaded.attachment.original_height ?? null,
            alignment: "center",
            position: "break",
            layout: "content",
            alt: uploaded.attachment.original_filename,
            title: uploaded.attachment.original_filename,
          },
        };
        if (position === null) editorRef.current?.chain().focus().insertContent(content).run();
        else editorRef.current?.chain().focus().insertContentAt(position, content).run();
      }
    })().catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Unable to attach image";
      context.onError?.(message);
      callbacksRef.current.onError?.(message);
    });
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
    mentionUsers: normalizedMentionUsers(mentionUsers),
    searchEntityLinks: searchEntityLinksForEditor,
    onEntityLinkSearchError: (message) => {
      setError(message);
      callbacksRef.current.onError?.(message);
    },
    onImageFiles: hasAttachmentContext ? handleImageFiles : undefined,
  }), [attachmentExtension, editable, handleImageFiles, hasAttachmentContext, mentionUsers, searchEntityLinksForEditor]);

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
          event.preventDefault();
          return event.shiftKey ? formattingControllerRef?.current?.outdent() ?? false : formattingControllerRef?.current?.indent() ?? false;
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
      onFocus: () => callbacksRef.current.onFocus?.(),
      onBlur: () => {
        callbacksRef.current.onBlur?.();
        void syncRef.current?.flush().then(() => callbacksRef.current.onFlush?.(currentSerializedRef.current)).catch(() => undefined);
      },
      onSelectionUpdate: ({ editor: activeEditor }) => updateSelectionState(activeEditor),
      onTransaction: ({ editor: transactionEditor, transaction }) => {
        if (!transaction.docChanged) return;
        incrementEditorRuntimeMetric("transactions");
        mappedAnnotationsRef.current = [...readMappedMangoTiptapAnnotations(transactionEditor)];
      },
      onUpdate: ({ editor: activeEditor }) => {
        lifecycleRef.current.markDirty();
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
        const next = selectionState(editor).fontSize + delta;
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
      applyTextAlignment: (alignment) => editor.chain().focus().setTextAlign(alignment).run(),
      insertLink: (href) => editor.chain().focus().extendMarkRange("link").setLink({ href }).run(),
      insertList: (kind) => kind === "checklist"
        ? editor.chain().focus().toggleTaskList().run()
        : editor.chain().focus().toggleBulletList().run(),
      toggleNumberedList: () => editor.chain().focus().toggleOrderedList().run(),
      indent: () => {
        if (editor.isActive("taskItem")) return editor.chain().focus().sinkListItem("taskItem").run();
        if (editor.isActive("listItem")) return editor.chain().focus().sinkListItem("listItem").run();
        const current = Number(editor.getAttributes("paragraph").indentLevel || editor.getAttributes("heading").indentLevel || 0);
        return editor.chain().focus().updateAttributes(editor.isActive("heading") ? "heading" : "paragraph", { indentLevel: Math.min(12, current + 1) }).run();
      },
      outdent: () => {
        if (editor.isActive("taskItem")) return editor.chain().focus().liftListItem("taskItem").run();
        if (editor.isActive("listItem")) return editor.chain().focus().liftListItem("listItem").run();
        const current = Number(editor.getAttributes("paragraph").indentLevel || editor.getAttributes("heading").indentLevel || 0);
        return editor.chain().focus().updateAttributes(editor.isActive("heading") ? "heading" : "paragraph", { indentLevel: Math.max(0, current - 1) }).run();
      },
      insertTable: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      readFormatState: () => selectionState(editor),
    };
    if (formattingControllerRef) formattingControllerRef.current = controller;
    updateSelectionState(editor);
    return () => {
      if (formattingControllerRef?.current === controller) formattingControllerRef.current = null;
      editorRef.current = null;
      setActiveEditor((current) => current === editor ? null : current);
      editor.destroy();
      releaseActive();
    };
  }, [
    ariaLabel, editable, extensions, formattingControllerRef, isActive, openEntityLink, placeholder, updateSelectionState,
  ]);

  useEffect(() => {
    if (lifecycle.state !== "dirty") return undefined;
    return trackEditorRuntimeResource("dirty_editors");
  }, [lifecycle.state]);

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
    if (formattingControllerRef) formattingControllerRef.current = null;
    const sync = syncRef.current;
    syncRef.current = null;
    syncStartedRef.current = false;
    syncPreparationRef.current = null;
    void sync?.shutdown();
  }, [formattingControllerRef]);

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
