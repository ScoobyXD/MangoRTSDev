import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppModalPortal, useAppFloatingMenuDismissal, useAppOverlayPortalTarget, useAppViewportAnchorRect } from "../../app/AppModalPortal.js";
import { ConfirmActionMenu, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { ExplorerEntityIcon } from "../../icons/index.js";
import { downloadEmailAttachment, getEmailCollaborationThread, getEmailMessage, getEmailSignature, getEmailThread, getNodeEmailThread, listEmailDrafts, listEmailMessages, saveEmailDraft, sendEmail, sendEmailCollaborationDraft, type CommunicationsEmailDraft, type EmailAddress, type EmailAttachment, type EmailMessage } from "../communications/communicationsApi";
import { CalendarInviteCard } from "../communications/CalendarInviteCard";
import { OutboundEmailUndoBanner } from "../communications/OutboundEmailUndoBanner";
import { isOutboundEmailUndoneError } from "../communications/outboundEmailUndo";
import { visibleEmailAttachmentsForBody } from "../communications/emailAttachments.js";
import { splitEmailQuotedHistory } from "../communications/emailQuotedContent.js";
import { emailThreadMessageRenderKey, emailThreadMessageSourceLabel, normalizeEmailThreadMessages, type EmailThreadMessageCandidate } from "../communications/emailThreadMessages.js";
import { buildReplyAllRecipients } from "../communications/emailRecipients";
import { downloadMangoAttachment, fetchMangoAttachmentBlob, loadMangoAttachmentObjectURL, type AttachmentRequestJSON, type MangoAttachment, type MangoAttachmentResourceType, type MangoAttachmentUploadProgress, type MangoAttachmentVariantType, type MangoResourceAttachment } from "../attachments/attachmentApi";
import { classifyAttachmentPresentation, classifyAttachmentPreview, splitAttachmentFilename, type AttachmentPresentationKind, type AttachmentPreviewKind } from "../attachments/attachmentPresentation";
import { canDeleteEditorTextBlockChatMessage, canEditEditorTextBlockChatMessage, type EditorAttachedEmail, type EditorChatAttachment, type EditorTextBlockChatMessage } from "./editorProjection";
import {
  remapEditorChatEntityLinks,
  replaceEditorChatEntityDraft,
  splitEditorChatTextByEntityLinks,
  type EditorChatEntityLink,
} from "./chatEntityLinks.js";
import { editorEntityTypeLabel, openEditorEntityLink, readActiveEntityLinkDraft, searchEditorEntityLinks, type ActiveEntityLinkDraft, type EditorEntityLink, type EditorEntityLinkRequest } from "./editorEntityLinks.js";
import { editorChatAttachmentsReadyForSubmit } from "./nodeTextBlockAttachments.js";
import type { EditorSaveState } from "./EditorSaveStatusIcon.js";
import type { EditorScrollMemory } from "./editorScroll";
import { EditorTabBar } from "./EditorTabBar";
import { EditorImagePreviewModal } from "./EditorImagePreviewModal.js";
import { UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS, type EditorTabID } from "./editorTabs";
import type { EditorOutlineStyleID } from "./plainTextEditing";
import {
  EDITOR_RICH_TEXT_PREFIX,
  editorBodyHasEmailContent,
  editorEmailDisplayDocument,
  isMangoEditorEmailBodyHTML,
  serializeEditorBodyForEmailHTML,
  type EditorHighlightColor,
} from "./richTextEditing";
import { resolveEditorEmailMailboxScope } from "./editorEmailMailboxScope.js";
import { resolveEmailThreadDownloadStatus, type EmailThreadDownloadStatus } from "./emailThreadDownloadStatus.js";
import { realtimePersonalMailboxScope, realtimeSharedMailboxScope, subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";
import {
  applyEmailSignatureOnceForSession,
  beginEmailSignatureApplicationSession,
  loadedEmailSignatureForScope,
  type EmailSignatureApplicationSession,
  type ScopedEmailSignatureState,
} from "./emailSignatureBody.js";
import { applyEmailBodyHighlights, type EmailBodyHighlightRange } from "./emailBodyHighlights.js";
import { splitChatTextLinks } from "./nodeChatLinks";
import {
  type EditorDocumentFormattingController,
  type EditorInlineStyleCommand,
  type EditorSelectionInlineFormatState,
  type EditorTextAlignment,
} from "./useEditorDocumentSurfaceHandlers";
import { EDITOR_DOCUMENT_FONT_SIZE_PX } from "./useEditorPreferences";
import { UnifiedRichEditorSurface, type UnifiedRichEditorFormattingController } from "./UnifiedRichEditorSurface";
import { createRequestJSON } from "../api/requestJSON.js";
import { useMangoEditorDataFormat } from "./editorDataFormat.js";
import type { MangoTiptapAnnotation } from "./tiptap/mangoTiptapAnnotations.js";
import {
  createStandaloneImageClipboardHTML,
  writeImageClipboardData,
  writeImageToSystemClipboard,
} from "./editorImages";

import {
  buildMentionOptions,
  EDITOR_MENTION_MENU_MAX_HEIGHT_PX,
  EDITOR_MENTION_BACKGROUND,
  EDITOR_MENTION_COLOR,
  EDITOR_URGENT_MENTION_BACKGROUND,
  mentionUserDisplayName,
  mentionUserOptionLabel,
  mentionUserProfileColor,
  readActiveMentionDraft,
  splitTextByMentions,
  type ActiveMentionDraft,
} from "./editorMentions";
import {
  ArrowRightIcon,
  avatarBackgroundForName,
  buildChatThreads,
  clampChatPaneHeight,
  ChatIcon,
  type ChatThreadNode,
  countChatThreadDescendants,
  EMAIL_DRAG_MIME,
  formatAddressList,
  formatFileSize,
  formatTimestamp,
  imageFilesFromTransfer,
  initialsForName,
  isImageAttachment,
  MailIcon,
  messageAttachmentPayload,
  PaperclipIcon,
  PlusIcon,
  TextEditorIcon,
  readStoredChatPaneHeight,
  storeChatPaneHeight,
  uploadEditorAttachment,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  TEXT_BLOCK_MIN_HEIGHT,
  TEXT_BLOCK_ROW_HEIGHT,
  type MentionableCompanyUser,
  type TextBlockImageDraft,
  type TextBlockSelectionAnchor,
  type TextBlockSelectionDraft,
  userAccentForName,
} from "./NodeWorkspaceSurfaceShared";

function universalEmailDraftFingerprint(input: {
  sender: string; to: string; cc: string; bcc: string; subject: string; body: string;
}): string {
  return JSON.stringify([input.sender.trim().toLowerCase(), input.to, input.cc, input.bcc, input.subject, input.body]);
}

const MangoTiptapEditor = React.lazy(async () => {
  const module = await import("./tiptap/MangoTiptapEditor.js");
  return { default: module.MangoTiptapEditor };
});
type TimelineCellProps = {
  accent: string;
  muted: boolean;
  isLast: boolean;
  minHeight?: number;
};

export const TimelineCell: React.FC<TimelineCellProps> = ({ accent, muted, isLast, minHeight = TEXT_BLOCK_ROW_HEIGHT }) => (
  <div style={{ position: "relative", alignSelf: "stretch", minHeight, paddingTop: 9, color: "inherit", boxSizing: "border-box" }}>
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        bottom: isLast ? "auto" : -12,
        height: isLast ? 25 : undefined,
        left: 13,
        width: 1,
        background: muted ? "rgba(100,116,139,0.18)" : "rgba(100,116,139,0.35)",
      }}
    />
    <div aria-hidden="true" style={{ position: "relative", width: 27, height: 27, borderRadius: 999, border: `2px solid ${muted ? "rgba(100,116,139,0.28)" : accent}`, background: "#ffffff", boxShadow: "0 0 0 3px rgba(100,116,139,0.08)" }} />
  </div>
);

function nodeEmailConversationTimelineDotStyle(expanded: boolean, sent: boolean): React.CSSProperties {
  const color = sent ? "#7c3aed" : "#0ea5e9";
  return {
    position: "absolute",
    zIndex: 1,
    top: 13,
    left: 3,
    width: 13,
    height: 13,
    border: "3px solid rgba(248, 250, 252, 0.96)",
    borderRadius: "50%",
    background: expanded ? color : "#cbd5e1",
    boxShadow: expanded
      ? `0 0 0 2px ${sent ? "rgba(124, 58, 237, 0.24)" : "rgba(14, 165, 233, 0.24)"}, 2px 2px 7px rgba(15, 23, 42, 0.18)`
      : "2px 2px 6px rgba(148, 163, 184, 0.24), -2px -2px 6px rgba(255, 255, 255, 0.86)",
    boxSizing: "border-box",
  };
}

const NodeEmailConversationTimeline: React.FC<{
  expanded: boolean;
  sent: boolean;
  timelineStart: boolean;
  timelineEnd: boolean;
}> = ({ expanded, sent, timelineStart, timelineEnd }) => (
  <span aria-hidden="true" style={{ position: "relative", minHeight: 48 }}>
    <span
      style={{
        position: "absolute",
        top: timelineStart ? 19 : -14,
        bottom: timelineEnd ? "calc(100% - 19px)" : -14,
        left: 9,
        width: 2,
        borderRadius: 2,
        background: "linear-gradient(180deg, rgba(14,165,233,0.34), rgba(124,58,237,0.3))",
      }}
    />
    <span style={nodeEmailConversationTimelineDotStyle(expanded, sent)} />
  </span>
);

type TextBlockActionsMenuProps = {
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onDelete: (position: ConfirmActionMenuPosition) => void;
};

function textBlockDeleteConfirmPositionFromElement(element: Element): ConfirmActionMenuPosition {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(12, Math.round(rect.right - 300)),
    y: Math.round(rect.bottom + 8),
  };
}

export const TextBlockActionsMenu: React.FC<TextBlockActionsMenuProps> = ({
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 });
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useAppFloatingMenuDismissal(open, rootRef, close);
  const menuItemStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 30,
    border: "none",
    borderRadius: 6,
    background: "#ffffff",
    color: surfaceText,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0,
    padding: "7px 9px",
    textAlign: "left",
  };
  return (
    <div ref={rootRef} style={{ position: "relative", width: 26, height: 24 }}>
      <button
        type="button"
        aria-label="Text box actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Text box actions"
        onClick={(event) => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuPosition({ left: Math.max(12, Math.round(rect.right - 148)), top: Math.round(rect.bottom + 6) });
          setOpen(true);
        }}
        style={{ width: 26, height: 24, borderRadius: 5, border: `1px solid ${open ? accent : strokeColor}`, background: open ? "rgba(100,116,139,0.12)" : panelBackground, color: surfaceText, display: "grid", placeItems: "center", cursor: "pointer", fontSize: 13, fontWeight: 900, lineHeight: 1, letterSpacing: 0 }}
      >
        ...
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Text box actions"
          style={{
            position: "fixed",
            zIndex: 130,
            top: menuPosition.top,
            left: menuPosition.left,
            width: 148,
            display: "grid",
            gap: 3,
            padding: 5,
            border: `1px solid ${strokeColor}`,
            borderRadius: 8,
            background: "#ffffff",
            boxShadow: "0 12px 28px rgba(0,0,0,0.14)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              const position = textBlockDeleteConfirmPositionFromElement(event.currentTarget);
              setOpen(false);
              onDelete(position);
            }}
            style={{ ...menuItemStyle, color: "#dc2626" }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

type DeleteTextBlockConfirmationModalProps = {
  title: string;
  chatCount: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  ruleColor: string;
  position?: ConfirmActionMenuPosition | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export const DeleteTextBlockConfirmationModal: React.FC<DeleteTextBlockConfirmationModalProps> = ({
  title,
  chatCount,
  position,
  onConfirm,
  onCancel,
}) => (
  <ConfirmActionMenu
    title="Are you sure you want to delete this?"
    detail={`This removes "${title}" from the middle column${chatCount > 0 ? ` and deletes ${chatCount} chat repl${chatCount === 1 ? "y" : "ies"} attached to it` : ""}.`}
    position={position}
    isDarkTheme={false}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

type NodeTextBlockEditorProps = {
  blockID: string;
  surfaceKind?: "node" | "project";
  editable: boolean;
  nodeID: string;
  apiBase: string;
  companyID: string;
  attachmentResourceType?: MangoAttachmentResourceType;
  attachmentResourceID?: string;
  attachmentRequestJSON?: AttachmentRequestJSON;
  attachmentEditorSurface?: string;
  currentUserID: string;
  companyUsers: MentionableCompanyUser[];
  documentValue: string;
  chatMessages: EditorTextBlockChatMessage[];
  pendingChatSelectionAnchor?: TextBlockSelectionAnchor;
  activeChatAnchorMessageID: string;
  onEntityLink?: (entity: EditorEntityLink) => Promise<void>;
  chatNavigationRequest: { anchorMessageID: string; requestID: number } | null;
  onChatNavigationConsumed?: (requestID: number) => void;
  surfaceText: string;
  accent: string;
  outlineStyle: EditorOutlineStyleID;
  indentGuideColor: string;
  scrollbarTrack: string;
  onFocus: () => void;
  onBlur: () => void;
  onPinChange?: (pinned: boolean) => void;
  onDocumentChange: (document: string) => void;
  onDocumentFlush: (document: string) => void;
  onDocumentConflict?: () => void;
  onDocumentError?: (message: string) => void;
  onSaveStateChange?: (state: EditorSaveState) => void;
  onRecoveryStorageError?: (message: string) => void;
  onRecoveryStorageRecovered?: () => void;
  onChatHighlightActivate?: (messageID: string) => void;
  onSelectionChatRequest: (selection: TextBlockSelectionDraft) => void;
  onImageChatRequest: (image: TextBlockImageDraft) => void;
  onImageNodeRequest: (image: TextBlockImageDraft) => void;
  formattingControllerRef?: React.MutableRefObject<EditorDocumentFormattingController | null>;
  formattingControllerActive?: boolean;
  onSelectionFontSizeChange?: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void;
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void;
  documentScrollMemoryRef?: React.MutableRefObject<EditorScrollMemory>;
};


const EDITOR_SOURCE_HIGHLIGHT_BACKGROUND = "linear-gradient(135deg, rgba(254,255,102,0.72), rgba(250,232,28,0.58))";
const EDITOR_SOURCE_HIGHLIGHT_ACTIVE_BACKGROUND = "linear-gradient(135deg, rgba(255,255,80,0.88), rgba(250,245,24,0.78))";
const EDITOR_SOURCE_HIGHLIGHT_OUTLINE = "0 0 0 2px rgba(234,179,8,0.72), 0 0 18px rgba(250,255,0,0.34)";
const EDITOR_SOURCE_HIGHLIGHT_SOFT_OUTLINE = "0 0 0 1px rgba(234,179,8,0.32)";


type CopyShortcutEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

function isCopyShortcut(event: CopyShortcutEvent): boolean {
  return Boolean((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c");
}

function copyImageAttachmentToClipboard(attachment: EditorChatAttachment, clipboardData?: DataTransfer): boolean {
  if (!isImageAttachment(attachment) || !attachment.dataURL) return false;
  const label = attachment.name.trim() || "Image";
  const html = createStandaloneImageClipboardHTML(attachment.dataURL, label);
  if (!html) return false;
  const wroteEventClipboard = clipboardData ? writeImageClipboardData(clipboardData, attachment.dataURL, html, label) : false;
  const wroteSystemClipboard = writeImageToSystemClipboard(attachment.dataURL, html, label);
  return wroteEventClipboard || wroteSystemClipboard;
}

function attachmentIDForContent(attachment: EditorChatAttachment): string {
  return attachment.attachmentID?.trim() || (attachment.dataURL ? "" : attachment.id.trim());
}

function canLoadAttachmentContent(attachment: EditorChatAttachment, apiBase?: string, companyID?: string): boolean {
  return Boolean(apiBase?.trim() && companyID?.trim() && attachmentIDForContent(attachment));
}

function useAttachmentObjectURL(
  attachment: EditorChatAttachment,
  apiBase: string | undefined,
  companyID: string | undefined,
  variant: MangoAttachmentVariantType,
  enabled = true,
): string {
  const legacyDataURL = attachment.dataURL?.trim() ?? "";
  const attachmentID = attachmentIDForContent(attachment);
  const [objectURL, setObjectURL] = useState("");

  useEffect(() => {
    setObjectURL("");
    if (!enabled || legacyDataURL || !apiBase?.trim() || !companyID?.trim() || !attachmentID) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    void loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, variant, { signal: controller.signal })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setObjectURL(url);
      })
      .catch(() => {
        if (!cancelled) setObjectURL("");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, attachmentID, companyID, enabled, legacyDataURL, variant]);

  useEffect(() => () => {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }, [objectURL]);

  return enabled ? legacyDataURL || objectURL : "";
}

async function downloadChatAttachment(attachment: EditorChatAttachment, apiBase?: string, companyID?: string): Promise<boolean> {
  if (attachment.dataURL && typeof document !== "undefined") {
    const link = document.createElement("a");
    link.href = attachment.dataURL;
    link.download = attachment.name.trim() || "attachment";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }
  const attachmentID = attachmentIDForContent(attachment);
  if (!apiBase?.trim() || !companyID?.trim() || !attachmentID) return false;
  await downloadMangoAttachment({
    apiBase,
    companyID,
    attachmentID,
    filename: attachment.name,
    variant: "original",
  });
  return true;
}

function openChatAttachment(
  attachment: EditorChatAttachment,
  onPreviewImage: (attachment: EditorChatAttachment) => void,
  apiBase?: string,
  companyID?: string,
): boolean {
  if (isImageAttachment(attachment)) {
    onPreviewImage(attachment);
    return true;
  }
  void downloadChatAttachment(attachment, apiBase, companyID).catch(() => undefined);
  return Boolean(attachment.dataURL || canLoadAttachmentContent(attachment, apiBase, companyID));
}

export const NodeTextBlockEditor: React.FC<NodeTextBlockEditorProps> = (props) => {
  const request = useMemo(
    () => props.attachmentRequestJSON ?? createRequestJSON(props.apiBase),
    [props.apiBase, props.attachmentRequestJSON],
  );
  const gate = useMangoEditorDataFormat(props.apiBase, props.companyID, request);
  const annotations = useMemo<MangoTiptapAnnotation[]>(() => [
    ...props.chatMessages.flatMap((message) => (
      message.selectionStart !== undefined
      && message.selectionEnd !== undefined
      && message.selectionEnd > message.selectionStart
    ) ? [{
      id: message.id,
      kind: "chat" as const,
      from: message.selectionStart,
      to: message.selectionEnd,
      active: message.id === props.activeChatAnchorMessageID,
    }] : []),
    ...(() => {
      const pending = props.pendingChatSelectionAnchor;
      return pending?.source !== "email" && pending && pending.endOffset > pending.startOffset ? [{
        id: "pending-chat-selection",
        kind: "chat" as const,
        from: pending.startOffset,
        to: pending.endOffset,
        active: true,
        durable: false as const,
      }] : [];
    })(),
  ], [
    props.activeChatAnchorMessageID,
    props.chatMessages,
    props.pendingChatSelectionAnchor,
  ]);
  const target = useMemo(() => {
    if (props.chatNavigationRequest) {
      return { requestID: props.chatNavigationRequest.requestID, annotationID: props.chatNavigationRequest.anchorMessageID };
    }
    return null;
  }, [props.chatNavigationRequest]);

  if (gate.loading) {
    return <div aria-label="Preparing editor data format" style={{ minHeight: TEXT_BLOCK_MIN_HEIGHT }} />;
  }
  if (gate.error || !gate.gate) {
    return <div role="alert" style={{ minHeight: TEXT_BLOCK_MIN_HEIGHT, padding: 12, color: "#b91c1c" }}>Unable to verify this workspace's editor format.</div>;
  }

  return (
    <React.Suspense fallback={<div aria-label="Loading JSON editor" style={{ minHeight: TEXT_BLOCK_MIN_HEIGHT }} />}>
      <MangoTiptapEditor
      key={`${props.companyID}:${props.surfaceKind}:${props.surfaceKind === "project" ? props.attachmentResourceID ?? props.nodeID : props.nodeID}:${props.blockID}`}
      value={props.documentValue}
      editable={props.editable}
      outlineStyle={props.outlineStyle}
      ariaLabel={`${props.surfaceKind === "project" ? "Project" : "Node"} text box`}
      dataAttributes={{
        "data-node-text-block-id": props.surfaceKind === "project" ? undefined : props.blockID,
        "data-project-text-block-id": props.surfaceKind === "project" ? props.blockID : undefined,
      }}
      style={{ minHeight: TEXT_BLOCK_MIN_HEIGHT, height: TEXT_BLOCK_MIN_HEIGHT, overflowY: "auto", color: props.surfaceText }}
      companyID={props.companyID}
      resourceType={props.surfaceKind === "project" ? "project" : "node"}
      resourceID={props.surfaceKind === "project" ? props.attachmentResourceID ?? props.nodeID : props.nodeID}
      documentID={props.blockID}
      currentUserID={props.currentUserID}
      requestJSON={request}
      attachmentContext={props.attachmentResourceType && props.attachmentResourceID ? {
        requestJSON: request,
        apiBase: props.apiBase,
        companyID: props.companyID,
        resourceType: props.attachmentResourceType,
        resourceID: props.attachmentResourceID,
        informationID: props.blockID,
        editorSurface: props.attachmentEditorSurface,
      } : undefined}
      mentionUsers={props.companyUsers}
      onEntityLink={props.onEntityLink}
      annotations={annotations}
      target={target}
      onTargetHandled={props.chatNavigationRequest ? props.onChatNavigationConsumed : undefined}
      formattingControllerRef={props.formattingControllerRef}
      formattingControllerActive={props.formattingControllerActive ?? !props.formattingControllerRef}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onConflict={() => props.onDocumentConflict?.()}
      onError={(message) => props.onDocumentError?.(message)}
      onSaveStateChange={props.onSaveStateChange}
      onRecoveryStorageError={(message) => props.onRecoveryStorageError?.(message)}
      onRecoveryStorageRecovered={() => props.onRecoveryStorageRecovered?.()}
      onAnnotationActivate={(annotation) => {
        if (annotation.kind === "chat") props.onChatHighlightActivate?.(annotation.id);
      }}
      onSelectionChatRequest={(selection) => props.onSelectionChatRequest({
        blockID: props.blockID,
        quote: selection.quote,
        startOffset: selection.from,
        endOffset: selection.to,
        x: selection.x,
        y: selection.y,
      })}
      onImageChatRequest={(image) => props.onImageChatRequest({
        blockID: props.blockID,
        dataURL: image.objectURL,
        attachmentID: image.attributes.attachmentId,
        filename: image.attributes.filename,
        mimeType: image.attributes.mimeType || "application/octet-stream",
        size: 0,
        width: image.width,
        height: image.height,
        x: image.x,
        y: image.y,
        downloadX: image.x,
        downloadY: image.y,
      })}
      onImageNodeRequest={(image) => props.onImageNodeRequest({
        blockID: props.blockID,
        dataURL: image.objectURL,
        attachmentID: image.attributes.attachmentId,
        filename: image.attributes.filename,
        mimeType: image.attributes.mimeType || "application/octet-stream",
        size: 0,
        width: image.width,
        height: image.height,
        x: image.x,
        y: image.y,
        downloadX: image.x,
        downloadY: image.y,
      })}
      onSelectionFontSizeChange={props.onSelectionFontSizeChange}
      onSelectionInlineFormatChange={props.onSelectionInlineFormatChange}
      onSelectionHighlightColorChange={props.onSelectionHighlightColorChange}
      onSelectionTextAlignmentChange={props.onSelectionTextAlignmentChange}
      onLifecycleChange={(snapshot) => props.onPinChange?.(snapshot.pinned)}
      />
    </React.Suspense>
  );
};

export type ChatMessageFocusRequest = {
  messageID: string;
  requestID: number;
};

type ChatPaneProps = {
  blockID: string;
  editable: boolean;
  apiBase?: string;
  companyID?: string;
  entityRequestJSON?: EditorEntityLinkRequest;
  messages: EditorTextBlockChatMessage[];
  emailPane?: React.ReactNode;
  headerLeading?: React.ReactNode;
  headerTrailing?: React.ReactNode;
  sectionLabelsByBlockID?: Record<string, string>;
  sectionKeysByMessageID?: Record<string, string>;
  hideHeader?: boolean;
  activeTab?: "chat" | "email";
  selectionAnchor?: TextBlockSelectionAnchor;
  draft: string;
  draftEntityLinks?: EditorChatEntityLink[];
  companyUsers: MentionableCompanyUser[];
  draftAttachments: EditorChatAttachment[];
  attachmentsEnabled?: boolean;
  replyTargetID: string;
  heightStorageKey: string;
  fixedHeight?: number;
  fillHeight?: boolean;
  active: boolean;
  currentUserID: string;
  activeMessageID: string;
  messageFocusRequest?: ChatMessageFocusRequest | null;
  composerFocusRequestID?: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  onFocus: () => void;
  onActiveTabChange?: (tab: "chat" | "email") => void;
  onDraftChange: (draft: string) => void;
  onDraftEntityLinksChange?: (links: EditorChatEntityLink[]) => void;
  onMentionPrincipal?: (principal: MentionableCompanyUser) => void;
  onActivateMessage: (messageID: string) => void;
  onNavigateToMessage: (messageID: string) => void;
  onReply: (messageID: string) => void;
  onEditMessage: (messageID: string, message: string) => Promise<void>;
  onDeleteMessage: (messageID: string) => void;
  onClearReply: () => void;
  onClearSelectionAnchor: () => void;
  onAttachFiles: (files: FileList | File[]) => void;
  onRemoveDraftAttachment: (attachmentID: string) => void;
  onSubmit: () => void;
};

const CHAT_COMPOSER_MIN_HEIGHT = 34;
const CHAT_COMPOSER_PANE_HEIGHT_RESERVE = 116;
const CHAT_COMPOSER_TEXT_METRICS: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1.35,
  letterSpacing: 0,
};

type ChatComposerDraftSegment = {
  text: string;
  mention: boolean;
  entity?: EditorChatEntityLink;
};

export const ChatPane: React.FC<ChatPaneProps> = ({
  blockID,
  editable,
  apiBase,
  companyID,
  entityRequestJSON,
  messages,
  emailPane,
  headerLeading,
  headerTrailing,
  sectionLabelsByBlockID = {},
  sectionKeysByMessageID = {},
  hideHeader = false,
  activeTab = "chat",
  selectionAnchor,
  draft,
  draftEntityLinks = [],
  companyUsers,
  draftAttachments,
  attachmentsEnabled = true,
  replyTargetID,
  heightStorageKey,
  fixedHeight,
  fillHeight = false,
  active,
  currentUserID,
  activeMessageID,
  messageFocusRequest,
  composerFocusRequestID = 0,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  onFocus,
  onActiveTabChange,
  onDraftChange,
  onDraftEntityLinksChange,
  onMentionPrincipal,
  onActivateMessage,
  onNavigateToMessage,
  onReply,
  onEditMessage,
  onDeleteMessage,
  onClearReply,
  onClearSelectionAnchor,
  onAttachFiles,
  onRemoveDraftAttachment,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerMentionOverlayRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const handledMessageFocusRequestRef = useRef("");
  const messageFocusRequestPendingRef = useRef(false);
  const mentionCloseTimerRef = useRef<number | null>(null);
  const threads = useMemo(() => buildChatThreads(messages), [messages]);
  const sectionedThreads = useMemo(() => {
    const blockOrder = new Map(Object.keys(sectionLabelsByBlockID).map((textBlockID, index) => [textBlockID, index]));
    if (blockOrder.size === 0) return threads;
    return threads.map((thread, index) => ({ thread, index })).sort((left, right) => {
      const leftKey = sectionKeysByMessageID[left.thread.message.id] ?? left.thread.message.blockID;
      const rightKey = sectionKeysByMessageID[right.thread.message.id] ?? right.thread.message.blockID;
      const leftOrder = blockOrder.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = blockOrder.get(rightKey) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    }).map(({ thread }) => thread);
  }, [sectionKeysByMessageID, sectionLabelsByBlockID, threads]);
  const replyTarget = replyTargetID ? messages.find((message) => message.id === replyTargetID) : undefined;
  const canSubmit = editable && editorChatAttachmentsReadyForSubmit(draftAttachments) && (draft.trim().length > 0 || draftAttachments.length > 0);
  const [storedHeight, setStoredHeight] = useState(() => readStoredChatPaneHeight(heightStorageKey));
  const height = fixedHeight ?? storedHeight;
  const resizableHeight = fixedHeight === undefined && !fillHeight;
  const composerMaxHeight = Math.max(CHAT_COMPOSER_MIN_HEIGHT, height - CHAT_COMPOSER_PANE_HEIGHT_RESERVE);
  const [composerSizing, setComposerSizing] = useState({ height: CHAT_COMPOSER_MIN_HEIGHT, scrolls: false });
  const [previewAttachment, setPreviewAttachment] = useState<EditorChatAttachment | null>(null);
  const [collapsedThreadIDs, setCollapsedThreadIDs] = useState<Set<string>>(() => new Set());
  const [activeMentionDraft, setActiveMentionDraft] = useState<ActiveMentionDraft | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeEntityDraft, setActiveEntityDraft] = useState<ActiveEntityLinkDraft | null>(null);
  const [activeEntityIndex, setActiveEntityIndex] = useState(0);
  const [entityOptions, setEntityOptions] = useState<EditorEntityLink[]>([]);
  const [entitySearchPending, setEntitySearchPending] = useState(false);
  const [entitySearchError, setEntitySearchError] = useState("");
  const mentionOptions = useMemo(() => {
    if (!activeMentionDraft) return [];
    return buildMentionOptions(companyUsers, activeMentionDraft.query, 20);
  }, [activeMentionDraft, companyUsers]);
  const mentionMenuOpen = editable && activeMentionDraft !== null && mentionOptions.length > 0;
  const entityMenuOpen = editable && activeEntityDraft !== null && Boolean(entityRequestJSON && companyID) && (entitySearchPending || Boolean(entitySearchError) || entityOptions.length > 0);
  const composerDraftSegments = useMemo(() => splitEditorChatTextByEntityLinks(draft, draftEntityLinks).flatMap<ChatComposerDraftSegment>((segment) => (
    segment.entity
      ? [{ text: segment.text, mention: false, entity: segment.entity }]
      : splitTextByMentions(segment.text, companyUsers).map((mentionSegment) => ({ ...mentionSegment, entity: undefined }))
  )), [companyUsers, draft, draftEntityLinks]);
  const composerHasInlineEntities = composerDraftSegments.some((segment) => segment.mention || segment.entity);
  const hasEmailPane = Boolean(emailPane);
  const showingEmail = hasEmailPane && activeTab === "email";
  const messageFocusRequestKey = messageFocusRequest?.messageID.trim()
    ? `${blockID}:${messageFocusRequest.requestID}:${messageFocusRequest.messageID.trim()}`
    : "";
  const messageFocusRequestPending = Boolean(
    messageFocusRequestKey
    && messages.some((message) => message.id === messageFocusRequest?.messageID.trim())
    && handledMessageFocusRequestRef.current !== messageFocusRequestKey
  );
  messageFocusRequestPendingRef.current = messageFocusRequestPending;

  const resizeComposer = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = `${CHAT_COMPOSER_MIN_HEIGHT}px`;
    const measuredHeight = Math.ceil(textarea.scrollHeight);
    const nextHeight = Math.max(CHAT_COMPOSER_MIN_HEIGHT, Math.min(measuredHeight, composerMaxHeight));
    const nextScrolls = measuredHeight > composerMaxHeight + 1;
    textarea.style.height = `${nextHeight}px`;
    setComposerSizing((current) => (
      current.height === nextHeight && current.scrolls === nextScrolls
        ? current
        : { height: nextHeight, scrolls: nextScrolls }
    ));
  }, [composerMaxHeight]);

  useEffect(() => {
    if (resizableHeight) setStoredHeight(readStoredChatPaneHeight(heightStorageKey));
  }, [heightStorageKey, resizableHeight]);

  useEffect(() => () => {
    if (mentionCloseTimerRef.current !== null) window.clearTimeout(mentionCloseTimerRef.current);
  }, []);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionDraft?.start, activeMentionDraft?.query]);

  useEffect(() => {
    setActiveMentionIndex((current) => Math.min(current, Math.max(0, mentionOptions.length - 1)));
  }, [mentionOptions.length]);

  useEffect(() => {
    setActiveEntityIndex(0);
  }, [activeEntityDraft?.start, activeEntityDraft?.query]);

  useEffect(() => {
    setActiveEntityIndex((current) => Math.min(current, Math.max(0, entityOptions.length - 1)));
  }, [entityOptions.length]);

  useEffect(() => {
    if (!editable || !activeEntityDraft || !entityRequestJSON || !companyID?.trim()) {
      setEntityOptions([]);
      setEntitySearchPending(false);
      setEntitySearchError("");
      return undefined;
    }
    let current = true;
    setEntitySearchPending(true);
    setEntitySearchError("");
    const timer = window.setTimeout(() => {
      void searchEditorEntityLinks({ companyID, requestJSON: entityRequestJSON }, activeEntityDraft.query).then((options) => {
        if (!current) return;
        setEntityOptions(options);
        setEntitySearchPending(false);
      }).catch((cause) => {
        if (!current) return;
        setEntityOptions([]);
        setEntitySearchPending(false);
        setEntitySearchError(cause instanceof Error ? cause.message : "Unable to search workspace entities");
      });
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [activeEntityDraft?.query, activeEntityDraft?.start, companyID, editable, entityRequestJSON]);

  useLayoutEffect(() => {
    if (showingEmail) return;
    resizeComposer();
  }, [draft, resizeComposer, showingEmail]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const overlay = composerMentionOverlayRef.current;
    if (!textarea || !overlay) return;
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  }, [composerSizing.height, draft]);

  useLayoutEffect(() => {
    if (showingEmail) return undefined;
    const textarea = textareaRef.current;
    const composer = textarea?.parentElement;
    if (!textarea || !composer || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        resizeComposer();
      });
    });
    observer.observe(composer);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [resizeComposer, showingEmail]);

  useEffect(() => {
    const visibleMessageIDs = new Set(messages.map((message) => message.id));
    setCollapsedThreadIDs((previous) => {
      const next = new Set(Array.from(previous).filter((messageID) => visibleMessageIDs.has(messageID)));
      return next.size === previous.size ? previous : next;
    });
  }, [messages]);

  useLayoutEffect(() => {
    const messageID = messageFocusRequest?.messageID.trim() ?? "";
    if (!messageID || !messageFocusRequest) return;
    const requestKey = messageFocusRequestKey;
    if (handledMessageFocusRequestRef.current === requestKey) return;
    if (!messages.some((message) => message.id === messageID)) return;
    if (showingEmail) {
      onActiveTabChange?.("chat");
      return;
    }

    const messageByID = new Map(messages.map((message) => [message.id, message]));
    const ancestorIDs: string[] = [];
    const visited = new Set<string>([messageID]);
    let parentID = messageByID.get(messageID)?.parentID?.trim() ?? "";
    while (parentID && !visited.has(parentID)) {
      visited.add(parentID);
      ancestorIDs.push(parentID);
      parentID = messageByID.get(parentID)?.parentID?.trim() ?? "";
    }
    if (ancestorIDs.some((ancestorID) => collapsedThreadIDs.has(ancestorID))) {
      setCollapsedThreadIDs((previous) => {
        const next = new Set(previous);
        for (const ancestorID of ancestorIDs) next.delete(ancestorID);
        return next;
      });
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current;
      if (!messageList) return;
      const messageElement = Array.from(messageList.querySelectorAll<HTMLElement>("[data-node-chat-message-id]"))
        .find((element) => element.getAttribute("data-node-chat-message-id") === messageID);
      if (!messageElement) return;
      handledMessageFocusRequestRef.current = requestKey;
      messageElement.focus({ preventScroll: true });
      messageElement.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsedThreadIDs, messageFocusRequest, messageFocusRequestKey, messages, onActiveTabChange, showingEmail]);

  useEffect(() => {
    if (!editable) return;
    if (showingEmail) return;
    if (messageFocusRequestPendingRef.current) return;
    if (!replyTargetID) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editable, replyTargetID, showingEmail]);

  useEffect(() => {
    if (!editable || showingEmail || !composerFocusRequestID) return;
    if (messageFocusRequestPendingRef.current) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [composerFocusRequestID, editable, showingEmail]);

  useEffect(() => {
    if (!editable) return;
    if (showingEmail) return;
    if (messageFocusRequestPendingRef.current) return;
    if (!active || replyTargetID) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active, editable, replyTargetID, selectionAnchor?.quote, showingEmail]);

  const focusComposer = () => {
    onFocus();
    if (!editable) return;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const refreshMentionDraft = (nextDraft = draft, nextEntityLinks = draftEntityLinks) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? null;
    const candidateEntityDraft = readActiveEntityLinkDraft(nextDraft, caret);
    const candidateIsAccepted = candidateEntityDraft !== null && caret !== null && nextEntityLinks.some((entity) => (
      entity.start === candidateEntityDraft.start && caret >= entity.end
    ));
    const entityDraft = candidateIsAccepted ? null : candidateEntityDraft;
    setActiveEntityDraft(entityDraft);
    setActiveMentionDraft(entityDraft ? null : readActiveMentionDraft(nextDraft, caret));
  };

  const replaceMentionDraft = (mention: ActiveMentionDraft, user: MentionableCompanyUser) => {
    if (!editable) return;
    const insert = `${mention.trigger}${mentionUserDisplayName(user)} `;
    const nextDraft = `${draft.slice(0, mention.start)}${insert}${draft.slice(mention.end)}`;
    onDraftChange(nextDraft);
    onDraftEntityLinksChange?.(remapEditorChatEntityLinks(draft, nextDraft, draftEntityLinks));
    onMentionPrincipal?.(user);
    setActiveMentionDraft(null);
    setActiveEntityDraft(null);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextCaret = mention.start + insert.length;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const replaceEntityDraft = (entityDraft: ActiveEntityLinkDraft, entity: EditorEntityLink) => {
    if (!editable) return;
    const replacement = replaceEditorChatEntityDraft(draft, draftEntityLinks, entityDraft, entity);
    onDraftChange(replacement.message);
    onDraftEntityLinksChange?.(replacement.entityLinks);
    setActiveEntityDraft(null);
    setActiveMentionDraft(null);
    setEntityOptions([]);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(replacement.caret, replacement.caret);
    });
  };

  const handleReply = (messageID: string) => {
    if (!editable) return;
    onActivateMessage(messageID);
    onReply(messageID);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const toggleThreadCollapse = (messageID: string) => {
    setCollapsedThreadIDs((previous) => {
      const next = new Set(previous);
      if (next.has(messageID)) next.delete(messageID);
      else next.add(messageID);
      return next;
    });
  };

  const attachTransferredImages = (dataTransfer: DataTransfer): boolean => {
    if (!editable) return false;
    const files = imageFilesFromTransfer(dataTransfer);
    if (files.length === 0) return false;
    onAttachFiles(files);
    return true;
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || !resizableHeight) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = height;
    let nextHeight = startHeight;
    const onPointerMove = (pointerEvent: PointerEvent) => {
      nextHeight = clampChatPaneHeight(startHeight + pointerEvent.clientY - startY);
      setStoredHeight(nextHeight);
    };
    const onPointerUp = () => {
      storeChatPaneHeight(heightStorageKey, nextHeight);
      window.removeEventListener("pointermove", onPointerMove);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  return (
    <>
      <div
        data-node-chat-block-id={blockID}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (!showingEmail) onFocus();
        }}
        style={{
          minWidth: 0,
          height: fillHeight ? "100%" : height,
          marginTop: 0,
          display: "grid",
          gridTemplateRows: hideHeader
            ? showingEmail
              ? (resizableHeight ? "minmax(0, 1fr) 7px" : "minmax(0, 1fr)")
              : (resizableHeight ? "minmax(0, 1fr) auto 7px" : "minmax(0, 1fr) auto")
            : showingEmail
              ? (resizableHeight ? "auto minmax(0, 1fr) 7px" : "auto minmax(0, 1fr)")
              : (resizableHeight ? "auto minmax(0, 1fr) auto 7px" : "auto minmax(0, 1fr) auto"),
          border: active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: 14,
          background: active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : panelBackground,
          overflow: "hidden",
          opacity: active || messages.length > 0 ? 1 : 0.72,
          boxShadow: active ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW,
        }}
      >
        {!hideHeader && (
        <div data-chat-pane-header="true" style={{ minHeight: 34, display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${ruleColor}`, padding: "5px 7px", color: surfaceText, fontSize: 11, fontWeight: 800, background: "linear-gradient(90deg, rgba(255,241,242,0.60), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.62))" }}>
          {headerLeading ?? (hasEmailPane ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onActiveTabChange?.("chat");
                  onFocus();
                }}
                style={{
                  minWidth: 0,
                  minHeight: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: activeTab === "chat" ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 9,
                  background: activeTab === "chat" ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                  color: activeTab === "chat" ? accent : surfaceText,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 0,
                  padding: "3px 9px",
                  boxShadow: activeTab === "chat" ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 7px rgba(174,174,192,0.14), -2px -2px 7px rgba(255,255,255,0.80)",
                }}
              >
                <ChatIcon color={activeTab === "chat" ? accent : "rgba(100,116,139,0.85)"} />
                <span>Chat</span>
              </button>
              <button
                type="button"
                onClick={() => onActiveTabChange?.("email")}
                style={{
                  minWidth: 0,
                  minHeight: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: activeTab === "email" ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 9,
                  background: activeTab === "email" ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                  color: activeTab === "email" ? accent : surfaceText,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 0,
                  padding: "3px 9px",
                  boxShadow: activeTab === "email" ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 7px rgba(174,174,192,0.14), -2px -2px 7px rgba(255,255,255,0.80)",
                }}
              >
                <MailIcon color={activeTab === "email" ? accent : "rgba(100,116,139,0.85)"} />
                <span>Email</span>
              </button>
            </>
          ) : (
            <>
              <ChatIcon color={active ? accent : "rgba(100,116,139,0.85)"} />
              <span>Chat</span>
            </>
          ))}
          {headerTrailing && (
            <div style={{ minWidth: 0, marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end", overflow: "hidden" }}>
              {headerTrailing}
            </div>
          )}
        </div>
        )}
        {showingEmail ? (
          <div className="mango-pane-enter" style={{ minHeight: 0, overflow: "hidden", display: "grid" }}>
            {emailPane}
          </div>
        ) : (
          <>
            <div ref={messageListRef} className="editor-document-scroll mango-pane-enter" style={{ minHeight: 0, display: "grid", alignContent: "start", gap: 8, overflowY: "auto", overflowX: "hidden", padding: "9px 8px", ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
              {sectionedThreads.map((thread, index) => {
                const sectionKey = sectionKeysByMessageID[thread.message.id] ?? thread.message.blockID;
                const previousSectionKey = index > 0
                  ? sectionKeysByMessageID[sectionedThreads[index - 1].message.id] ?? sectionedThreads[index - 1].message.blockID
                  : "";
                const sectionLabel = sectionLabelsByBlockID[sectionKey] ?? "";
                return (
                  <React.Fragment key={thread.message.id}>
                    {sectionLabel && previousSectionKey !== sectionKey && (
                      <div data-email-chat-message-section="true" style={{ borderTop: index > 0 ? `1px solid ${ruleColor}` : undefined, padding: index > 0 ? "11px 2px 2px" : "2px 2px", color: "#475569", fontSize: 10.5, fontWeight: 850, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <ExplorerEntityIcon kind="node" />
                        <span>{sectionLabel}</span>
                      </div>
                    )}
                    <ChatThreadItem
                      node={thread}
                      depth={0}
                      isLastSibling={false}
                      apiBase={apiBase}
                      companyID={companyID}
                      currentUserID={currentUserID}
                      editable={editable}
                      activeMessageID={activeMessageID}
                      companyUsers={companyUsers}
                      accent={accent}
                      surfaceText={surfaceText}
                      ruleColor={ruleColor}
                      collapsedThreadIDs={collapsedThreadIDs}
                      onToggleCollapse={toggleThreadCollapse}
                      onActivate={onActivateMessage}
                      onNavigate={onNavigateToMessage}
                      onReply={handleReply}
                      onEdit={onEditMessage}
                      onDelete={onDeleteMessage}
                      onPreviewImage={setPreviewAttachment}
                    />
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ display: "grid", gap: 6, padding: 8, borderTop: `1px solid ${ruleColor}` }}>
          {selectionAnchor && active && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 22px", alignItems: "start", gap: 6, border: "1px solid rgba(92,238,255,0.34)", borderLeft: `3px solid ${accent}`, borderRadius: 9, background: "linear-gradient(135deg, rgba(230,252,255,0.58), rgba(247,239,255,0.58))", color: surfaceText, padding: "6px 6px 6px 7px", fontSize: 10, lineHeight: 1.35, fontWeight: 800, overflowWrap: "anywhere", maxHeight: 72, overflowY: "auto", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)" }}>
              <span style={{ minWidth: 0 }}>{selectionAnchor.quote}</span>
              <button
                type="button"
                aria-label="Clear selected text"
                title="Clear selected text"
                onClick={onClearSelectionAnchor}
                style={{ width: 22, height: 22, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 14, fontWeight: 900, lineHeight: 1, padding: 0 }}
              >
                x
              </button>
            </div>
          )}
          {draftAttachments.length > 0 && (
            <DraftAttachmentList
              attachments={draftAttachments}
              apiBase={apiBase}
              companyID={companyID}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              onRemove={onRemoveDraftAttachment}
              onPreviewImage={setPreviewAttachment}
            />
          )}
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) 32px", alignItems: "end", gap: 6 }}>
            {entityMenuOpen && activeEntityDraft && (
              <div
                role="listbox"
                aria-label="Link a Node, Logic Gate, or Project"
                data-mango-chat-entity-menu="true"
                style={{
                  position: "absolute",
                  left: 38,
                  right: 38,
                  bottom: "calc(100% + 6px)",
                  zIndex: 21,
                  display: "grid",
                  gap: 3,
                  maxHeight: 236,
                  overflowY: "auto",
                  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 12,
                  background: EDITOR_NEU_PANEL_BACKGROUND,
                  boxShadow: EDITOR_NEU_PANEL_SHADOW,
                  padding: 6,
                }}
              >
                {entitySearchPending && <div role="status" style={{ padding: "8px 10px", color: "rgba(71,85,105,.84)", fontSize: 11, fontWeight: 750 }}>Searching workspace…</div>}
                {!entitySearchPending && entitySearchError && <div role="alert" style={{ padding: "8px 10px", color: "#b91c1c", fontSize: 11, fontWeight: 750 }}>{entitySearchError}</div>}
                {!entitySearchPending && !entitySearchError && entityOptions.map((entity, index) => {
                  const selected = index === activeEntityIndex;
                  return (
                    <button
                      key={`${entity.entityType}:${entity.entityID}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-mango-chat-entity-type={entity.entityType}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        replaceEntityDraft(activeEntityDraft, entity);
                      }}
                      style={{
                        width: "100%",
                        height: 42,
                        display: "grid",
                        gridTemplateColumns: "24px minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 8,
                        border: "1px solid transparent",
                        borderRadius: 10,
                        background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "transparent",
                        color: surfaceText,
                        cursor: "pointer",
                        padding: "4px 7px",
                        textAlign: "left",
                        font: "inherit",
                        boxShadow: selected ? "0 8px 20px rgba(15,23,42,0.10), 0 0 12px rgba(14,165,233,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : undefined,
                      }}
                    >
                      <ExplorerEntityIcon kind={entity.entityType} />
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800 }}>{entity.label}</span>
                      <span style={{ color: "rgba(100,116,139,.88)", fontSize: 9.5, fontWeight: 800 }}>{editorEntityTypeLabel(entity.entityType)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {mentionMenuOpen && activeMentionDraft && (
              <div
                role="listbox"
                aria-label="Mention users"
                style={{
                  position: "absolute",
                  left: 38,
                  right: 38,
                  bottom: "calc(100% + 6px)",
                  zIndex: 20,
                  display: "grid",
                  gap: 3,
                  maxHeight: EDITOR_MENTION_MENU_MAX_HEIGHT_PX,
                  overflowY: "auto",
                  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 12,
                  background: EDITOR_NEU_PANEL_BACKGROUND,
                  boxShadow: EDITOR_NEU_PANEL_SHADOW,
                  padding: 6,
                }}
              >
                {mentionOptions.map((user, index) => {
                  const selected = index === activeMentionIndex;
                  const label = mentionUserOptionLabel(user);
                  const name = mentionUserDisplayName(user);
                  const email = (user.email ?? "").trim();
                  const profileColor = mentionUserProfileColor(user);
                  return (
                    <button
                      key={user.user_id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={label}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        replaceMentionDraft(activeMentionDraft, user);
                      }}
                      style={{
                        width: "100%",
                        height: 42,
                        display: "grid",
                        gridTemplateColumns: "24px minmax(0, 1fr)",
                        alignItems: "center",
                        gap: 8,
                        border: "1px solid transparent",
                        borderRadius: 10,
                        background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "transparent",
                        color: surfaceText,
                        cursor: "pointer",
                        padding: "4px 7px",
                        textAlign: "left",
                        font: "inherit",
                        boxShadow: selected ? "0 8px 20px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : undefined,
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 24, height: 24, boxSizing: "border-box", border: `1px solid ${profileColor.border}`, borderRadius: 999, display: "grid", placeItems: "center", background: profileColor.background, color: profileColor.foreground, fontSize: 10, fontWeight: 900 }}>
                        {initialsForName(name)}
                      </span>
                      <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800 }}>{name}</span>
                        {email && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 650, color: "rgba(100,116,139,0.86)" }}>{email}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment"
              disabled={!editable || !attachmentsEnabled}
              onClick={() => {
                focusComposer();
                if (attachmentsEnabled) fileInputRef.current?.click();
              }}
              style={{ width: 32, height: 32, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: editable && attachmentsEnabled ? "pointer" : "default", opacity: editable && attachmentsEnabled ? 1 : 0.46, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <PlusIcon color={accent} />
            </button>
            {composerHasInlineEntities && (
              <div
                ref={composerMentionOverlayRef}
                aria-hidden="true"
                data-mango-chat-composer-mention-overlay="true"
                style={{
                  position: "absolute",
                  left: 38,
                  right: 38,
                  bottom: 0,
                  height: composerSizing.height,
                  minHeight: CHAT_COMPOSER_MIN_HEIGHT,
                  maxHeight: composerMaxHeight,
                  overflow: "hidden",
                  boxSizing: "border-box",
                  borderRadius: 10,
                  padding: "8px 9px",
                  color: surfaceText,
                  background: EDITOR_NEU_ACTIVE_SURFACE,
                  ...CHAT_COMPOSER_TEXT_METRICS,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              >
                {composerDraftSegments.map((segment, index) => segment.entity ? (
                  <span
                    key={`${segment.text}:${index}`}
                    data-mango-chat-composer-entity-link="true"
                    data-mango-entity-type={segment.entity.entityType}
                    data-mango-entity-id={segment.entity.entityID}
                    style={{
                      background: "rgba(224,242,254,0.92)",
                      color: "#075985",
                      border: 0,
                      borderRadius: 6,
                      padding: 0,
                      fontWeight: "inherit",
                      boxDecorationBreak: "clone",
                      boxShadow: "0 0 0 1px rgba(224,242,254,0.94), 0 0 0 2px rgba(14,165,233,0.34), inset 1px 1px 0 rgba(255,255,255,0.86), 0 2px 7px rgba(15,23,42,0.08)",
                    }}
                  >
                    {segment.text}
                  </span>
                ) : segment.mention ? (
                  <span
                    key={`${segment.text}:${index}`}
                    data-mango-chat-composer-mention="true"
                    data-mango-mention-kind={segment.text.startsWith("!") ? "urgent" : "mention"}
                    style={{
                      background: segment.text.startsWith("!") ? EDITOR_URGENT_MENTION_BACKGROUND : EDITOR_MENTION_BACKGROUND,
                      color: EDITOR_MENTION_COLOR,
                      border: 0,
                      borderRadius: 6,
                      padding: 0,
                      fontWeight: "inherit",
                      boxDecorationBreak: "clone",
                      // The transparent textarea owns the native caret. Keep the
                      // painted chip's inline advance and glyph metrics identical
                      // so accepted mentions cannot visually outrun that caret.
                      boxShadow: segment.text.startsWith("!")
                        ? "0 0 0 1px rgba(254,226,226,0.92), 0 0 0 2px rgba(239,68,68,0.34), inset 1px 1px 0 rgba(255,255,255,0.86), 0 2px 7px rgba(15,23,42,0.08)"
                        : "0 0 0 1px rgba(247,239,255,0.92), 0 0 0 2px rgba(183,124,255,0.34), inset 1px 1px 0 rgba(255,255,255,0.86), 0 2px 7px rgba(15,23,42,0.08)",
                    }}
                  >
                    {segment.text}
                  </span>
                ) : (
                  <React.Fragment key={`${segment.text}:${index}`}>{segment.text}</React.Fragment>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={draft}
              rows={1}
              disabled={!editable}
              readOnly={!editable}
              placeholder={replyTarget ? `↖ Replying to ${replyTarget.authorName}` : ""}
              onFocus={() => {
                if (!editable) return;
                onFocus();
                refreshMentionDraft(draft);
              }}
              onClick={() => { if (editable) refreshMentionDraft(); }}
              onKeyUp={() => { if (editable) refreshMentionDraft(); }}
              onBlur={() => {
                if (mentionCloseTimerRef.current !== null) window.clearTimeout(mentionCloseTimerRef.current);
                mentionCloseTimerRef.current = window.setTimeout(() => {
                  mentionCloseTimerRef.current = null;
                  setActiveMentionDraft(null);
                  setActiveEntityDraft(null);
                }, 120);
              }}
              onPaste={(event) => {
                if (!editable) {
                  event.preventDefault();
                  return;
                }
                if (attachTransferredImages(event.clipboardData)) event.preventDefault();
              }}
              onDragOver={(event) => {
                if (!editable) return;
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!editable) {
                  event.preventDefault();
                  return;
                }
                if (attachTransferredImages(event.dataTransfer)) event.preventDefault();
              }}
              onChange={(event) => {
                if (!editable) return;
                const nextDraft = event.currentTarget.value;
                const nextEntityLinks = remapEditorChatEntityLinks(draft, nextDraft, draftEntityLinks);
                onDraftChange(nextDraft);
                onDraftEntityLinksChange?.(nextEntityLinks);
                refreshMentionDraft(nextDraft, nextEntityLinks);
              }}
              onScroll={(event) => {
                const overlay = composerMentionOverlayRef.current;
                if (!overlay) return;
                overlay.scrollTop = event.currentTarget.scrollTop;
                overlay.scrollLeft = event.currentTarget.scrollLeft;
              }}
              onKeyDown={(event) => {
                if (!editable) {
                  event.preventDefault();
                  return;
                }
                if (entityMenuOpen && activeEntityDraft) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (entityOptions.length > 0) setActiveEntityIndex((current) => (current + 1) % entityOptions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (entityOptions.length > 0) setActiveEntityIndex((current) => (current - 1 + entityOptions.length) % entityOptions.length);
                    return;
                  }
                  if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
                    event.preventDefault();
                    const entity = entityOptions[activeEntityIndex] ?? entityOptions[0];
                    if (entity) replaceEntityDraft(activeEntityDraft, entity);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setActiveEntityDraft(null);
                    setEntityOptions([]);
                    return;
                  }
                }
                if (mentionMenuOpen && activeMentionDraft) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveMentionIndex((current) => (current + 1) % mentionOptions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
                    return;
                  }
                  if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
                    event.preventDefault();
                    replaceMentionDraft(activeMentionDraft, mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setActiveMentionDraft(null);
                    return;
                  }
                }
                if (event.key === "Escape" && replyTarget) {
                  event.preventDefault();
                  onClearReply();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              style={{ position: "relative", zIndex: 1, width: "100%", height: composerSizing.height, minHeight: CHAT_COMPOSER_MIN_HEIGHT, maxHeight: composerMaxHeight, resize: "none", overflowY: composerSizing.scrolls ? "auto" : "hidden", boxSizing: "border-box", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, outline: "none", padding: "7px 8px", color: composerHasInlineEntities ? "transparent" : surfaceText, WebkitTextFillColor: composerHasInlineEntities ? "transparent" : surfaceText, background: composerHasInlineEntities ? "transparent" : EDITOR_NEU_ACTIVE_SURFACE, ...CHAT_COMPOSER_TEXT_METRICS, caretColor: editable ? surfaceText : "transparent", cursor: editable ? "text" : "default", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.18), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
            />
            <button
              type="button"
              aria-label="Send"
              title="Send"
              disabled={!canSubmit}
              onClick={onSubmit}
              style={{ width: 32, height: 32, border: canSubmit && active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: canSubmit && active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, borderRadius: 9, display: "grid", placeItems: "center", cursor: canSubmit ? "pointer" : "default", opacity: canSubmit ? 1 : 0.44, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <ArrowRightIcon color={accent} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              disabled={!editable}
              style={{ display: "none" }}
              onChange={(event) => {
                if (event.currentTarget.files) onAttachFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
            </div>
          </>
        )}
        {resizableHeight && (
          <div
            role="separator"
            aria-orientation="horizontal"
            title="Resize chat"
            onPointerDown={beginResize}
            style={{ cursor: editable ? "ns-resize" : "default", borderTop: `1px solid ${ruleColor}`, background: active ? "rgba(100,116,139,0.10)" : "rgba(100,116,139,0.08)" }}
          />
        )}
      </div>
      {previewAttachment && (
        <ImageAttachmentPreviewModal
          attachment={previewAttachment}
          apiBase={apiBase}
          companyID={companyID}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
};

type ChatThreadItemProps = {
  node: ChatThreadNode;
  depth: number;
  isLastSibling: boolean;
  apiBase?: string;
  companyID?: string;
  currentUserID: string;
  editable: boolean;
  activeMessageID: string;
  companyUsers: MentionableCompanyUser[];
  accent: string;
  surfaceText: string;
  ruleColor: string;
  collapsedThreadIDs: Set<string>;
  onToggleCollapse: (messageID: string) => void;
  onActivate: (messageID: string) => void;
  onNavigate: (messageID: string) => void;
  onReply: (messageID: string) => void;
  onEdit: (messageID: string, message: string) => Promise<void>;
  onDelete: (messageID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const MentionAndLinkText: React.FC<{ text: string; users: MentionableCompanyUser[] }> = ({ text, users }) => {
  const segments = useMemo(() => splitTextByMentions(text, users), [text, users]);
  return (
    <>
      {segments.map((segment, index) => segment.mention ? (
        <span
          key={`${segment.text}:${index}`}
          title={segment.user ? mentionUserOptionLabel(segment.user) : segment.text}
          style={{ background: segment.text.startsWith("!") ? EDITOR_URGENT_MENTION_BACKGROUND : EDITOR_MENTION_BACKGROUND, color: EDITOR_MENTION_COLOR, border: segment.text.startsWith("!") ? "1px solid rgba(239,68,68,0.34)" : "1px solid rgba(183,124,255,0.34)", borderRadius: 6, padding: "0 4px", fontWeight: 850, boxDecorationBreak: "clone", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 0 2px 7px rgba(15,23,42,0.08)" }}
        >
          {segment.text}
        </span>
      ) : splitChatTextLinks(segment.text).map((linkSegment, linkIndex) => linkSegment.href ? (
        <a
          key={`${segment.text}:${index}:${linkIndex}`}
          href={linkSegment.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          style={{ color: "#0369a1", textDecoration: "underline", textDecorationThickness: 1.5, textUnderlineOffset: 2, fontWeight: 700 }}
        >
          {linkSegment.text}
        </a>
      ) : (
        <React.Fragment key={`${segment.text}:${index}:${linkIndex}`}>{linkSegment.text}</React.Fragment>
      )))}
    </>
  );
};

const MentionHighlightedText: React.FC<{ text: string; users: MentionableCompanyUser[]; color: string; entityLinks?: EditorChatEntityLink[] }> = ({ text, users, color, entityLinks = [] }) => {
  const segments = useMemo(() => splitEditorChatTextByEntityLinks(text, entityLinks), [entityLinks, text]);
  return (
    <div style={{ color, fontSize: 12, lineHeight: 1.35, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
      {segments.map((segment, index) => segment.entity ? (
        <button
          key={`${segment.entity.entityType}:${segment.entity.entityID}:${segment.entity.start}`}
          type="button"
          role="link"
          aria-label={`Open ${editorEntityTypeLabel(segment.entity.entityType)} ${segment.entity.label}`}
          title={`Open ${editorEntityTypeLabel(segment.entity.entityType)}: ${segment.entity.label}`}
          data-mango-chat-entity-link="true"
          data-mango-entity-type={segment.entity.entityType}
          data-mango-entity-id={segment.entity.entityID}
          onClick={(event) => {
            event.stopPropagation();
            openEditorEntityLink(segment.entity!);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, margin: "0 1px", padding: "0 4px", border: "1px solid rgba(14,165,233,.32)", borderRadius: 6, background: "rgba(224,242,254,.82)", color: "#075985", cursor: "pointer", font: "inherit", fontWeight: 800, lineHeight: 1.35, verticalAlign: "baseline" }}
        >
          <ExplorerEntityIcon kind={segment.entity.entityType} />
          <span>{segment.text}</span>
        </button>
      ) : (
        <MentionAndLinkText key={`text:${index}:${segment.text}`} text={segment.text} users={users} />
      ))}
    </div>
  );
};

const ChatThreadItem: React.FC<ChatThreadItemProps> = ({ node, depth, isLastSibling, apiBase, companyID, currentUserID, editable, activeMessageID, companyUsers, accent, surfaceText, ruleColor, collapsedThreadIDs, onToggleCollapse, onActivate, onNavigate, onReply, onEdit, onDelete, onPreviewImage }) => {
  const { message, children } = node;
  const hasChildren = children.length > 0;
  const collapsed = collapsedThreadIDs.has(message.id);
  const hiddenReplyCount = collapsed ? countChatThreadDescendants(node) : 0;
  const isActive = activeMessageID === message.id;
  const canEdit = editable && canEditEditorTextBlockChatMessage(message, currentUserID);
  const canDelete = editable && canDeleteEditorTextBlockChatMessage(message, currentUserID);
  const authorAccent = userAccentForName(message.authorName || message.authorID);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.message);
  const [savingEdit, setSavingEdit] = useState(false);
  useEffect(() => {
    if (!editing) setEditDraft(message.message);
  }, [editing, message.message]);
  const saveEdit = async () => {
    const cleanMessage = editDraft.trim();
    if (savingEdit || cleanMessage === message.message || (!cleanMessage && message.attachments.length === 0)) return;
    setSavingEdit(true);
    try {
      await onEdit(message.id, cleanMessage);
      setEditing(false);
    } catch {
      // The parent surface owns the visible error; keep the editor open for retry.
    } finally {
      setSavingEdit(false);
    }
  };
  const guideColor = "rgba(100,116,139,0.24)";
  const guideStyle: React.CSSProperties = isLastSibling
    ? { position: "absolute", top: -10, left: 13, width: 1, height: 23, background: guideColor }
    : { position: "absolute", top: -10, bottom: -8, left: 13, width: 1, background: guideColor };
  return (
    <div
      data-node-chat-message-id={message.id}
      role="article"
      aria-label={`Chat comment from ${message.authorName || "Unknown author"}`}
      aria-current={isActive ? "true" : undefined}
      tabIndex={-1}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onActivate(message.id);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onNavigate(message.id);
      }}
      style={{
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr)",
        columnGap: 7,
        alignItems: "start",
        border: "1px solid transparent",
        borderRadius: 10,
        background: isActive ? "linear-gradient(135deg, rgba(255,255,255,0.88), rgba(230,252,255,0.48) 48%, rgba(247,239,255,0.54))" : "transparent",
        boxShadow: isActive ? `0 8px 20px rgba(15,23,42,0.10), 0 0 14px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)` : "none",
        outline: focused ? `2px solid ${accent}` : "none",
        outlineOffset: -2,
        padding: "4px 4px 4px 0",
        cursor: "pointer",
      }}
    >
      <div style={{ position: "relative", gridRow: hasChildren && !collapsed ? "1 / span 2" : undefined, alignSelf: "stretch", display: "grid", justifyItems: "center", minHeight: 28 }}>
        {depth > 0 && <div aria-hidden="true" style={guideStyle} />}
        {hasChildren && (
          <button
            type="button"
            aria-label={collapsed ? "Expand replies" : "Collapse replies"}
            title={collapsed ? "Expand replies" : "Collapse replies"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(message.id);
            }}
            style={{
              position: "absolute",
              zIndex: 2,
              top: -5,
              left: -2,
              width: 14,
              height: 14,
              border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
              borderRadius: 999,
              background: EDITOR_NEU_SURFACE,
              color: "rgba(15,23,42,0.72)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {collapsed ? "+" : "-"}
          </button>
        )}
        <div style={{ position: "relative", zIndex: 1, width: 26, height: 26, borderRadius: 999, border: "1px solid rgba(255,255,255,0.82)", background: avatarBackgroundForName(message.authorName || message.authorID), color: "#ffffff", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, letterSpacing: 0, boxShadow: "3px 3px 8px rgba(174,174,192,0.22), -3px -3px 8px rgba(255,255,255,0.78)" }}>
          {initialsForName(message.authorName || message.authorID)}
        </div>
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, minWidth: 0, color: surfaceText, fontSize: 10, fontWeight: 800 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: authorAccent, fontWeight: 900 }}>{message.authorName}</span>
          <span title={message.editedTimestamp ? `Edited ${formatTimestamp(message.editedTimestamp)}` : undefined} style={{ opacity: 0.58, flex: "0 0 auto" }}>
            {formatTimestamp(message.createdTimestamp)}{message.editedTimestamp ? " · Edited" : ""}
          </span>
        </div>
        {editing ? (
          <div onClick={(event) => event.stopPropagation()} style={{ display: "grid", gap: 5 }}>
            <textarea
              aria-label="Edit comment text"
              autoFocus
              value={editDraft}
              disabled={savingEdit}
              onChange={(event) => setEditDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditDraft(message.message);
                  setEditing(false);
                } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void saveEdit();
                }
              }}
              style={{ width: "100%", minHeight: 58, resize: "vertical", boxSizing: "border-box", border: `1px solid ${ruleColor}`, borderRadius: 7, background: "#ffffff", color: surfaceText, padding: "7px 8px", font: "inherit", fontSize: 12, lineHeight: 1.35 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                aria-label="Save edited comment"
                disabled={savingEdit || (!editDraft.trim() && message.attachments.length === 0)}
                onClick={() => { void saveEdit(); }}
                style={{ border: "none", borderRadius: 6, background: accent, color: "#ffffff", cursor: savingEdit ? "wait" : "pointer", fontSize: 10, fontWeight: 850, padding: "4px 9px" }}
              >
                {savingEdit ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => {
                  setEditDraft(message.message);
                  setEditing(false);
                }}
                style={{ border: "none", background: "transparent", color: "rgba(51,65,85,0.82)", cursor: "pointer", fontSize: 10, fontWeight: 800, padding: "2px 0" }}
              >
                Cancel
              </button>
              <span style={{ color: "rgba(51,65,85,0.56)", fontSize: 9, fontWeight: 700 }}>Ctrl+Enter to save</span>
            </div>
          </div>
        ) : message.message ? <MentionHighlightedText text={message.message} users={companyUsers} color={surfaceText} entityLinks={message.entityLinks} /> : null}
        {message.attachments.length > 0 && <ChatAttachmentList attachments={message.attachments} apiBase={apiBase} companyID={companyID} surfaceText={surfaceText} strokeColor={ruleColor} onPreviewImage={onPreviewImage} />}
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {editable && (
            <button type="button" onClick={(event) => { event.stopPropagation(); onReply(message.id); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: accent, cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}>
              <ChatIcon color={accent} />
              Reply
            </button>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              aria-label="Edit comment"
              title="Edit comment"
              onClick={(event) => {
                event.stopPropagation();
                setEditDraft(message.message);
                setEditing(true);
              }}
              style={{ border: "none", background: "transparent", color: accent, cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              aria-label="Delete message"
              title="Delete message"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(message.id);
              }}
              style={{ border: "none", background: "transparent", color: "rgba(51,65,85,0.82)", cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}
            >
              Delete
            </button>
          )}
          {hiddenReplyCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse(message.id);
              }}
              style={{ border: "none", background: "transparent", color: "rgba(15,23,42,0.54)", cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}
            >
              {hiddenReplyCount} {hiddenReplyCount === 1 ? "reply" : "replies"} hidden
            </button>
          )}
        </div>
      </div>
      {hasChildren && !collapsed && (
        <div style={{ gridColumn: "2", minWidth: 0, marginTop: 4, display: "grid", gap: 8 }}>
          {children.map((child, childIndex) => (
            <ChatThreadItem
              key={child.message.id}
              node={child}
              depth={depth + 1}
              isLastSibling={childIndex === children.length - 1}
              apiBase={apiBase}
              companyID={companyID}
              currentUserID={currentUserID}
              editable={editable}
              activeMessageID={activeMessageID}
              companyUsers={companyUsers}
              accent={accent}
              surfaceText={surfaceText}
              ruleColor={ruleColor}
              collapsedThreadIDs={collapsedThreadIDs}
              onToggleCollapse={onToggleCollapse}
              onActivate={onActivate}
              onNavigate={onNavigate}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onPreviewImage={onPreviewImage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

type ChatAttachmentListProps = {
  attachments: EditorChatAttachment[];
  apiBase?: string;
  companyID?: string;
  surfaceText: string;
  strokeColor: string;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const ChatAttachmentList: React.FC<ChatAttachmentListProps> = ({ attachments, apiBase, companyID, surfaceText, strokeColor, onPreviewImage }) => {
  const [selectedAttachmentID, setSelectedAttachmentID] = useState("");

  useEffect(() => {
    if (selectedAttachmentID && !attachments.some((attachment) => attachment.id === selectedAttachmentID)) {
      setSelectedAttachmentID("");
    }
  }, [attachments, selectedAttachmentID]);

  const selectAttachment = (event: React.MouseEvent, attachmentID: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAttachmentID(attachmentID);
  };

  const openAttachment = (event: React.MouseEvent, attachment: EditorChatAttachment) => {
    selectAttachment(event, attachment.id);
    openChatAttachment(attachment, onPreviewImage, apiBase, companyID);
  };

  return (
    <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
      {attachments.map((attachment) => {
        const selected = selectedAttachmentID === attachment.id;
        const downloadable = Boolean(attachment.dataURL || canLoadAttachmentContent(attachment, apiBase, companyID));
        return (
          <div
            key={attachment.id}
            style={{
              maxWidth: "100%",
              minWidth: 0,
              minHeight: 30,
              display: "inline-grid",
              gridTemplateColumns: "minmax(0, 1fr) 28px",
              alignItems: "stretch",
              border: selected ? "1px solid transparent" : "1px solid " + strokeColor,
              borderRadius: 6,
              background: selected ? EDITOR_NEU_ACTIVE_SURFACE + " padding-box, " + EDITOR_NEU_EDGE_FRAME + " border-box" : "#ffffff",
              color: surfaceText,
              boxShadow: selected ? "0 7px 18px rgba(15,23,42,0.10), 0 0 0 2px rgba(92,238,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "none",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              data-mango-copyable-image={isImageAttachment(attachment) ? "true" : undefined}
              aria-pressed={selected}
              title={isImageAttachment(attachment) ? "Double-click to preview" : downloadable ? "Double-click to download" : attachment.name}
              onCopy={(event) => {
                if (!copyImageAttachmentToClipboard(attachment, event.clipboardData)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (!isCopyShortcut(event) || !copyImageAttachmentToClipboard(attachment)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => selectAttachment(event, attachment.id)}
              onDoubleClick={(event) => openAttachment(event, attachment)}
              style={{
                minWidth: 0,
                minHeight: 28,
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 6,
                border: 0,
                background: "transparent",
                color: surfaceText,
                padding: "3px 4px 3px 6px",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0,
                textDecoration: "none",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <AttachmentThumb attachment={attachment} apiBase={apiBase} companyID={companyID} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
              <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
            </button>
            <button
              type="button"
              data-mango-chat-attachment-download="true"
              aria-label={"Download " + attachment.name}
              title={"Download " + attachment.name}
              disabled={!downloadable}
              onClick={(event) => {
                event.stopPropagation();
                void downloadChatAttachment(attachment, apiBase, companyID).catch(() => undefined);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              style={{
                width: 28,
                minHeight: 28,
                border: 0,
                borderLeft: "1px solid " + strokeColor,
                background: "rgba(248,250,252,0.88)",
                color: surfaceText,
                display: "grid",
                placeItems: "center",
                padding: 0,
                cursor: downloadable ? "pointer" : "default",
                opacity: downloadable ? 0.82 : 0.34,
              }}
            >
              <DownloadIcon color={surfaceText} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
type DraftAttachmentListProps = {
  attachments: EditorChatAttachment[];
  apiBase?: string;
  companyID?: string;
  surfaceText: string;
  strokeColor: string;
  onRemove: (attachmentID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const DraftAttachmentList: React.FC<DraftAttachmentListProps> = ({ attachments, apiBase, companyID, surfaceText, strokeColor, onRemove, onPreviewImage }) => {
  const [selectedAttachmentID, setSelectedAttachmentID] = useState("");

  useEffect(() => {
    if (selectedAttachmentID && !attachments.some((attachment) => attachment.id === selectedAttachmentID)) {
      setSelectedAttachmentID("");
    }
  }, [attachments, selectedAttachmentID]);

  const selectAttachment = (event: React.MouseEvent | React.KeyboardEvent, attachmentID: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAttachmentID(attachmentID);
  };

  const openAttachment = (event: React.MouseEvent, attachment: EditorChatAttachment) => {
    selectAttachment(event, attachment.id);
    openChatAttachment(attachment, onPreviewImage, apiBase, companyID);
  };

  return (
    <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
      {attachments.map((attachment) => {
        const selected = selectedAttachmentID === attachment.id;
        const transferState = attachment.transferState;
        return (
          <span
            key={attachment.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            data-mango-chat-attachment-transfer-state={transferState}
            title={transferState === "processing" ? "Attaching image" : transferState === "failed" ? "Image attachment failed" : isImageAttachment(attachment) ? "Double-click to preview" : attachment.dataURL || canLoadAttachmentContent(attachment, apiBase, companyID) ? "Double-click to download" : attachment.name}
            onClick={(event) => selectAttachment(event, attachment.id)}
            onDoubleClick={(event) => openAttachment(event, attachment)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              selectAttachment(event, attachment.id);
            }}
            style={{
              maxWidth: "100%",
              minHeight: 30,
              display: "inline-grid",
              gridTemplateColumns: "24px minmax(0, 1fr) auto 18px",
              alignItems: "center",
              gap: 5,
              border: selected ? "1px solid transparent" : `1px solid ${strokeColor}`,
              borderRadius: 6,
              background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "#ffffff",
              color: surfaceText,
              padding: "3px 4px 3px 5px",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0,
              cursor: "pointer",
              boxShadow: selected ? "0 7px 18px rgba(15,23,42,0.10), 0 0 0 2px rgba(92,238,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "none",
            }}
          >
            <button
              type="button"
              data-mango-copyable-image={isImageAttachment(attachment) ? "true" : undefined}
              aria-label={`Select ${attachment.name}`}
              onCopy={(event) => {
                if (!copyImageAttachmentToClipboard(attachment, event.clipboardData)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (!isCopyShortcut(event) || !copyImageAttachmentToClipboard(attachment)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => selectAttachment(event, attachment.id)}
              onDoubleClick={(event) => openAttachment(event, attachment)}
              style={{ width: 24, height: 24, border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
            >
              <AttachmentThumb attachment={attachment} apiBase={apiBase} companyID={companyID} />
            </button>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
            <span
              aria-live={transferState ? "polite" : undefined}
              style={{ flex: "0 0 auto", opacity: transferState ? 0.9 : 0.58, color: transferState === "failed" ? "#be123c" : undefined }}
            >
              {transferState === "processing" ? "Attaching..." : transferState === "failed" ? "Failed" : formatFileSize(attachment.size)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(attachment.id);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              style={{ width: 18, height: 18, border: "none", borderRadius: 4, background: "transparent", color: surfaceText, cursor: "pointer", fontSize: 12, fontWeight: 800, lineHeight: 1 }}
            >
              x
            </button>
          </span>
        );
      })}
    </div>
  );
};

const AttachmentThumb: React.FC<{ attachment: EditorChatAttachment; apiBase?: string; companyID?: string }> = ({ attachment, apiBase, companyID }) => {
  const image = isImageAttachment(attachment);
  const src = useAttachmentObjectURL(attachment, apiBase, companyID, "thumbnail", image);
  if (image) {
    if (src) {
      return <img alt="" src={src} style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", display: "block", border: "1px solid rgba(17,17,17,0.12)" }} />;
    }
    return (
      <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid rgba(17,17,17,0.14)", background: "rgba(92,238,255,0.10)", display: "grid", placeItems: "center", color: "rgba(15,23,42,0.78)", fontSize: 8, fontWeight: 900 }}>
        IMG
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid rgba(17,17,17,0.14)", background: "rgba(100,116,139,0.10)", display: "grid", placeItems: "center", color: "rgba(15,23,42,0.78)", fontSize: 8, fontWeight: 900 }}>
      FILE
    </span>
  );
};

type ImageAttachmentPreviewModalProps = {
  attachment: EditorChatAttachment;
  apiBase?: string;
  companyID?: string;
  onClose: () => void;
};

const ImageAttachmentPreviewModal: React.FC<ImageAttachmentPreviewModalProps> = ({ attachment, apiBase, companyID, onClose }) => {
  const src = useAttachmentObjectURL(attachment, apiBase, companyID, "original");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCopyShortcut(event)) return;
      const copied = copyImageAttachmentToClipboard(attachment);
      if (!copied && typeof document !== "undefined") document.execCommand("copy");
      event.preventDefault();
      event.stopPropagation();
    };
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData || !copyImageAttachmentToClipboard(attachment, event.clipboardData)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("copy", onCopy, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("copy", onCopy, true);
    };
  }, [attachment]);

  return (
    <EditorImagePreviewModal
      label={attachment.name}
      src={src}
      emptyLabel={canLoadAttachmentContent(attachment, apiBase, companyID) ? "Loading image" : "Preview unavailable"}
      copyable
      onClose={onClose}
      onDownload={() => {
        void downloadChatAttachment(attachment, apiBase, companyID).catch(() => undefined);
      }}
    />
  );
};
type EmailCountDropdownProps = {
  emails: EditorAttachedEmail[];
  accent: string;
  surfaceText: string;
  align?: "left" | "right";
  compact?: boolean;
  onOpenEmail: (messageID: string) => void;
  onRemoveEmail?: (emailID: string) => void;
};

const ATTACHED_EMAIL_DRAG_MIME = "application/x-mango-node-attached-email";

function writeAttachedEmailDragData(dataTransfer: DataTransfer, email: EditorAttachedEmail) {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(ATTACHED_EMAIL_DRAG_MIME, email.messageID);
  dataTransfer.setData("text/plain", email.subject || email.messageID);
}

function readAttachedEmailDragMessageID(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(ATTACHED_EMAIL_DRAG_MIME).trim();
}

function hasAttachedEmailDragData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(ATTACHED_EMAIL_DRAG_MIME);
}

export const EmailCountDropdown: React.FC<EmailCountDropdownProps> = ({ emails, accent, surfaceText, align = "right", compact = false, onOpenEmail, onRemoveEmail }) => {
  const [open, setOpen] = useState(false);
  const [emailMenu, setEmailMenu] = useState<{ emailID: string; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setEmailMenu(null);
  }, []);
  useAppFloatingMenuDismissal(open || Boolean(emailMenu), rootRef, close);
  return (
    <div ref={rootRef} style={{ position: "relative", flex: "0 0 auto", minWidth: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Attached emails"
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{
          minHeight: compact ? 24 : 30,
          minWidth: compact ? 38 : 54,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          border: open ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: compact ? 8 : 9,
          background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
          color: open ? accent : surfaceText,
          cursor: "pointer",
          font: "inherit",
          fontSize: compact ? 10.5 : 12,
          fontWeight: 900,
          letterSpacing: 0,
          padding: compact ? "2px 7px" : "0 10px",
          boxShadow: open ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW,
        }}
      >
        <MailIcon color={open ? accent : "rgba(100,116,139,0.85)"} />
        <span>{emails.length}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Attached emails"
          style={{
            position: "absolute",
            zIndex: 80,
            top: "calc(100% + 7px)",
            right: align === "right" ? 0 : undefined,
            left: align === "left" ? 0 : undefined,
            width: compact ? 246 : 320,
            maxWidth: "min(86vw, 320px)",
            maxHeight: 310,
            overflowY: "auto",
            display: "grid",
            gap: 5,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 13,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 6,
          }}
        >
          {emails.length === 0 && (
            <div style={{ padding: "8px 10px", color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 800 }}>
              No emails attached
            </div>
          )}
          {emails.map((email) => (
            <button
              key={email.id}
              type="button"
              role="menuitem"
              title={email.subject}
              draggable
              onDragStart={(event) => writeAttachedEmailDragData(event.dataTransfer, email)}
              onContextMenu={(event) => {
                if (!onRemoveEmail) return;
                event.preventDefault();
                event.stopPropagation();
                setEmailMenu({ emailID: email.id, x: event.clientX, y: event.clientY });
              }}
              onClick={() => {
                setOpen(false);
                onOpenEmail(email.messageID);
              }}
              style={{
                minWidth: 0,
                display: "grid",
                gap: 3,
                border: "1px solid transparent",
                borderRadius: 10,
                background: "#ffffff",
                color: surfaceText,
                cursor: "pointer",
                padding: "7px 8px",
                textAlign: "left",
                boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.14), -2px -2px 8px rgba(255,255,255,0.76)",
              }}
            >
              <span style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 900 }}>{email.subject}</span>
                <span style={{ flex: "0 0 auto", fontSize: 9.5, fontWeight: 850, color: accent }}>{formatTimestamp(email.date)}</span>
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 750, color: "rgba(100,116,139,0.86)" }}>
                From: {email.from || "Unknown sender"}
              </span>
              {email.snippet && (
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 650, color: "rgba(100,116,139,0.72)" }}>{email.snippet}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {emailMenu && onRemoveEmail && (
        <div
          role="menu"
          aria-label="Attached email actions"
          onContextMenu={(event) => event.preventDefault()}
          style={{ position: "fixed", zIndex: 160, top: emailMenu.y, left: emailMenu.x, minWidth: 164, display: "grid", gap: 3, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, padding: 5 }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const emailID = emailMenu.emailID;
              setEmailMenu(null);
              onRemoveEmail(emailID);
            }}
            style={{ minHeight: 30, border: "1px solid transparent", borderRadius: 7, background: "transparent", color: "#dc2626", cursor: "pointer", padding: "5px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Remove from node
          </button>
        </div>
      )}
    </div>
  );
};

export type AttachmentCountDropdownItem = {
  resourceAttachment: MangoResourceAttachment;
};

export type AttachmentUploadDropdownItem = {
  id: string;
  filename: string;
  size: number;
  attachmentID?: string;
  progress: MangoAttachmentUploadProgress;
};

type AttachmentCountDropdownProps = {
  items: AttachmentCountDropdownItem[];
  uploads?: AttachmentUploadDropdownItem[];
  apiBase: string;
  companyID: string;
  accent: string;
  surfaceText: string;
  align?: "left" | "right";
  compact?: boolean;
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
  onAddFiles?: (files: File[]) => void | Promise<void>;
  onRemove?: (item: AttachmentCountDropdownItem) => void;
  onCancelUpload?: (uploadID: string) => void;
  onRetryUpload?: (uploadID: string) => void;
  onError: (message: string) => void;
};

const ATTACHMENT_KIND_VISUALS: Record<AttachmentPresentationKind, { label: string; background: string; border: string; color: string }> = {
  image: { label: "IMG", background: "#ecfeff", border: "rgba(8,145,178,0.28)", color: "#0e7490" },
  spreadsheet: { label: "XLS", background: "#ecfdf5", border: "rgba(5,150,105,0.28)", color: "#047857" },
  document: { label: "DOC", background: "#eff6ff", border: "rgba(37,99,235,0.28)", color: "#1d4ed8" },
  presentation: { label: "PPT", background: "#fff7ed", border: "rgba(234,88,12,0.28)", color: "#c2410c" },
  pdf: { label: "PDF", background: "#fff1f2", border: "rgba(225,29,72,0.28)", color: "#be123c" },
  archive: { label: "ZIP", background: "#fffbeb", border: "rgba(217,119,6,0.28)", color: "#b45309" },
  text: { label: "TXT", background: "#f0fdfa", border: "rgba(13,148,136,0.28)", color: "#0f766e" },
  audio: { label: "AUD", background: "#faf5ff", border: "rgba(147,51,234,0.25)", color: "#7e22ce" },
  video: { label: "VID", background: "#fdf2f8", border: "rgba(219,39,119,0.25)", color: "#be185d" },
  generic: { label: "FILE", background: "#f8fafc", border: "rgba(100,116,139,0.28)", color: "#475569" },
};

const AttachmentTypeVisual: React.FC<{ kind: AttachmentPresentationKind; muted?: boolean }> = ({ kind, muted = false }) => {
  const visual = ATTACHMENT_KIND_VISUALS[kind];
  return (
    <span
      aria-hidden="true"
      style={{
        width: 34,
        height: 34,
        display: "grid",
        placeItems: "center",
        border: `1px solid ${visual.border}`,
        borderRadius: 7,
        background: visual.background,
        color: visual.color,
        fontSize: visual.label.length > 3 ? 7.5 : 8.5,
        fontWeight: 950,
        letterSpacing: 0,
        lineHeight: 1,
        opacity: muted ? 0.52 : 1,
        boxSizing: "border-box",
      }}
    >
      {visual.label}
    </span>
  );
};

const AuthenticatedAttachmentThumbnail: React.FC<{
  apiBase: string;
  companyID: string;
  attachmentID: string;
}> = ({ apiBase, companyID, attachmentID }) => {
  const [previewURL, setPreviewURL] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [shouldLoad, setShouldLoad] = useState(false);
  const previewAnchorRef = useRef<HTMLSpanElement | null>(null);
  const previewURLRef = useRef("");
  const revokePreviewURL = useCallback(() => {
    if (!previewURLRef.current) return;
    URL.revokeObjectURL(previewURLRef.current);
    previewURLRef.current = "";
  }, []);

  useEffect(() => {
    if (shouldLoad) return undefined;
    const anchor = previewAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { root: anchor.closest('[role="menu"]'), rootMargin: "48px 0px" });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    let disposed = false;
    revokePreviewURL();
    setPreviewURL("");
    setStatus("loading");
    void (async () => {
      let loadedURL = "";
      for (const variant of ["thumbnail", "display"] as const) {
        try {
          loadedURL = await loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, variant, { signal: controller.signal });
          break;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!loadedURL) {
        if (!disposed) setStatus("failed");
        return;
      }
      if (disposed) {
        URL.revokeObjectURL(loadedURL);
        return;
      }
      previewURLRef.current = loadedURL;
      setPreviewURL(loadedURL);
      setStatus("ready");
    })();
    return () => {
      disposed = true;
      controller.abort();
      revokePreviewURL();
    };
  }, [apiBase, attachmentID, companyID, revokePreviewURL, shouldLoad]);

  if (status !== "ready" || !previewURL) {
    return (
      <span ref={previewAnchorRef} title={status === "failed" ? "Image preview unavailable" : status === "idle" ? "Image preview pending" : "Loading image preview"} aria-busy={status === "loading"} style={{ display: "block", width: 34, height: 34 }}>
        <AttachmentTypeVisual kind="image" muted={status === "loading"} />
      </span>
    );
  }
  return (
    <img
      src={previewURL}
      alt=""
      onError={() => {
        revokePreviewURL();
        setPreviewURL("");
        setStatus("failed");
      }}
      style={{ width: 34, height: 34, display: "block", border: "1px solid rgba(100,116,139,0.20)", borderRadius: 7, background: "#f8fafc", objectFit: "cover", boxSizing: "border-box" }}
    />
  );
};

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
const TEXT_PREVIEW_MAX_CHARACTERS = 200_000;

const AttachmentPreviewModal: React.FC<{
  attachment: MangoAttachment;
  previewKind: AttachmentPreviewKind;
  apiBase: string;
  companyID: string;
  accent: string;
  surfaceText: string;
  onClose: () => void;
  onError: (message: string) => void;
}> = ({ attachment, previewKind, apiBase, companyID, accent, surfaceText, onClose, onError }) => {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(previewKind === "unavailable" ? "ready" : "loading");
  const [objectURL, setObjectURL] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textTruncated, setTextTruncated] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const objectURLRef = useRef("");
  const filename = splitAttachmentFilename(attachment.original_filename).filename;
  const presentationKind = classifyAttachmentPresentation({ filename, mimeType: attachment.mime_type });
  const revokeObjectURL = useCallback(() => {
    if (!objectURLRef.current) return;
    URL.revokeObjectURL(objectURLRef.current);
    objectURLRef.current = "";
  }, []);

  useEffect(() => {
    revokeObjectURL();
    setObjectURL("");
    setTextContent("");
    setTextTruncated(false);
    if (previewKind === "unavailable") {
      setStatus("ready");
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    setStatus("loading");
    void (async () => {
      try {
        if (previewKind === "text") {
          let blob: Blob | null = null;
          for (const variant of ["display", "original"] as const) {
            try {
              blob = await fetchMangoAttachmentBlob(apiBase, companyID, attachment.attachment_id, variant, { signal: controller.signal });
              break;
            } catch {
              if (controller.signal.aborted) return;
            }
          }
          if (!blob) throw new Error("attachment_preview_unavailable");
          const decoded = await blob.slice(0, TEXT_PREVIEW_MAX_BYTES).text();
          if (disposed) return;
          setTextContent(decoded.slice(0, TEXT_PREVIEW_MAX_CHARACTERS));
          setTextTruncated(blob.size > TEXT_PREVIEW_MAX_BYTES || decoded.length > TEXT_PREVIEW_MAX_CHARACTERS);
          setStatus("ready");
          return;
        }
        let loadedURL = "";
        for (const variant of ["display", "original"] as const) {
          try {
            loadedURL = await loadMangoAttachmentObjectURL(apiBase, companyID, attachment.attachment_id, variant, { signal: controller.signal });
            break;
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        if (!loadedURL) throw new Error("attachment_preview_unavailable");
        if (disposed) {
          URL.revokeObjectURL(loadedURL);
          return;
        }
        objectURLRef.current = loadedURL;
        setObjectURL(loadedURL);
        setStatus("ready");
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        setStatus("failed");
        onError(cause instanceof Error ? cause.message : "attachment_preview_unavailable");
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      revokeObjectURL();
    };
  }, [apiBase, attachment.attachment_id, companyID, onError, previewKind, revokeObjectURL]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadMangoAttachment({ apiBase, companyID, attachmentID: attachment.attachment_id, filename, variant: "original" });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_download_attachment");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AppModalPortal onRequestClose={onClose}>
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ position: "fixed", zIndex: 1, inset: 0, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.52)", padding: 18 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`attachment-preview-title-${attachment.attachment_id}`}
        style={{ width: "min(980px, 94vw)", height: "min(760px, 88vh)", minHeight: 0, display: "grid", gridTemplateRows: "48px minmax(0, 1fr) 50px", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_PANEL_BACKGROUND, color: surfaceText, overflow: "hidden", boxShadow: "0 28px 72px rgba(15,23,42,0.32)" }}
      >
        <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "34px minmax(0, 1fr) 32px", alignItems: "center", gap: 9, borderBottom: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, padding: "7px 8px 7px 11px", background: EDITOR_NEU_SURFACE }}>
          <AttachmentTypeVisual kind={presentationKind} />
          <div id={`attachment-preview-title-${attachment.attachment_id}`} title={filename} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 900 }}>{filename}</div>
          <button type="button" title="Close preview" aria-label="Close preview" onClick={onClose} style={{ width: 30, height: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", fontSize: 14, fontWeight: 900, lineHeight: 1, padding: 0 }}>X</button>
        </div>
        <div style={{ minWidth: 0, minHeight: 0, display: "grid", placeItems: status === "ready" ? undefined : "center", overflow: "auto", background: "#ffffff", padding: previewKind === "text" || previewKind === "unavailable" ? 18 : 0 }}>
          {status === "loading" && <div role="status" style={{ fontSize: 12, fontWeight: 850, color: "rgba(71,85,105,0.82)" }}>Loading preview...</div>}
          {status === "failed" && <div role="alert" style={{ fontSize: 12, fontWeight: 850, color: "#be123c" }}>Preview unavailable</div>}
          {status === "ready" && previewKind === "image" && objectURL && <img src={objectURL} alt={filename} onError={() => { revokeObjectURL(); setObjectURL(""); setStatus("failed"); }} style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
          {status === "ready" && previewKind === "pdf" && objectURL && <iframe src={objectURL} title={`PDF preview: ${filename}`} onError={() => { revokeObjectURL(); setObjectURL(""); setStatus("failed"); }} style={{ width: "100%", height: "100%", border: 0, background: "#ffffff" }} />}
          {status === "ready" && previewKind === "audio" && objectURL && <audio src={objectURL} controls preload="metadata" aria-label={`Audio preview: ${filename}`} onError={() => { revokeObjectURL(); setObjectURL(""); setStatus("failed"); }} style={{ width: "min(680px, 90%)" }} />}
          {status === "ready" && previewKind === "video" && objectURL && <video src={objectURL} controls preload="metadata" aria-label={`Video preview: ${filename}`} onError={() => { revokeObjectURL(); setObjectURL(""); setStatus("failed"); }} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", background: "#000000" }} />}
          {status === "ready" && previewKind === "text" && (
            <div style={{ width: "100%", minHeight: "100%", display: "grid", alignContent: "start", gap: 10 }}>
              {textTruncated && <div role="status" style={{ color: "#92400e", fontSize: 11, fontWeight: 850 }}>Preview limited to 256 KiB / 200,000 characters.</div>}
              <pre style={{ width: "100%", margin: 0, color: "#1f2937", fontFamily: "Consolas, 'Courier New', monospace", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", tabSize: 2 }}>{textContent}</pre>
            </div>
          )}
          {status === "ready" && previewKind === "unavailable" && (
            <div style={{ width: "min(520px, 100%)", display: "grid", gridTemplateColumns: "42px minmax(0, 1fr)", alignItems: "center", gap: 12, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: "#f8fafc", padding: 14 }}>
              <AttachmentTypeVisual kind={presentationKind} />
              <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
                <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 900 }}>{filename}</div>
                <div style={{ color: "rgba(71,85,105,0.82)", fontSize: 10.5, fontWeight: 750 }}>{attachment.mime_type || "Unknown file type"} - {formatFileSize(attachment.byte_size)}</div>
                <div style={{ color: "rgba(71,85,105,0.74)", fontSize: 11, fontWeight: 750 }}>Preview unavailable for this file type.</div>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, borderTop: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, padding: "8px 10px", background: EDITOR_NEU_SURFACE }}>
          <button type="button" disabled={downloading} onClick={() => { void download(); }} style={{ minHeight: 32, display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, cursor: downloading ? "wait" : "pointer", padding: "4px 10px", font: "inherit", fontSize: 11.5, fontWeight: 900, letterSpacing: 0 }}>
            <DownloadIcon color={accent} />
            {downloading ? "Downloading..." : "Download"}
          </button>
        </div>
      </div>
      </div>
    </AppModalPortal>
  );
};

const DownloadIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M9 2.7v8.1m-3-3 3 3 3-3M3.2 13v2.2h11.6V13" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ATTACHMENT_UPLOAD_STATE_LABELS: Record<MangoAttachmentUploadProgress["state"], string> = {
  preparing: "Preparing",
  uploading: "Uploading",
  retrying: "Retrying",
  completing: "Completing",
  complete: "Complete",
  canceled: "Canceled",
  failed: "Failed",
};

const ATTACHMENT_CONTROL_SELECTED_BACKGROUND = "linear-gradient(105deg, rgba(224, 253, 255, 0.98) 0%, rgba(183, 242, 255, 0.98) 48%, rgba(216, 230, 251, 0.98) 100%)";
const ATTACHMENT_CONTROL_HOVER_BACKGROUND = "linear-gradient(105deg, rgba(244, 254, 255, 0.98) 0%, rgba(225, 248, 255, 0.98) 50%, rgba(235, 242, 252, 0.98) 100%)";
const ATTACHMENT_CONTROL_SELECTED_SHADOW = "inset 0 0 0 1px rgba(34, 211, 238, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.94), 0 1px 3px rgba(14, 116, 144, 0.14)";
const ATTACHMENT_CONTROL_HOVER_SHADOW = "inset 0 0 0 1px rgba(34, 211, 238, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.94), 0 1px 3px rgba(14, 116, 144, 0.09)";

const AttachmentUploadProgressRow: React.FC<{
  item: AttachmentUploadDropdownItem;
  accent: string;
  surfaceText: string;
  onCancel?: (uploadID: string) => void;
  onRetry?: (uploadID: string) => void;
}> = ({ item, accent, surfaceText, onCancel, onRetry }) => {
  const filename = splitAttachmentFilename(item.filename);
  const state = item.progress.state;
  const percent = Math.max(0, Math.min(100, Math.round(item.progress.fraction * 100)));
  const canCancel = state === "preparing" || state === "uploading" || state === "retrying" || state === "completing";
  const canRetry = state === "failed" || state === "canceled";
  const statusColor = state === "failed" ? "#be123c" : state === "complete" ? "#047857" : state === "canceled" ? "#64748b" : accent;
  return (
    <div
      role={state === "failed" ? "alert" : "status"}
      aria-live={state === "failed" ? "assertive" : "polite"}
      style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8, border: "1px solid rgba(100,116,139,0.16)", borderRadius: 10, background: "#ffffff", color: surfaceText, padding: "7px 8px" }}
    >
      <span style={{ minWidth: 0, display: "grid", gap: 5 }}>
        <span title={filename.filename} style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 6 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 900 }}>{filename.baseName}</span>
          <span style={{ flex: "0 0 auto", border: "1px solid rgba(100,116,139,0.18)", borderRadius: 5, background: "#f8fafc", padding: "2px 4px", color: "rgba(71,85,105,0.92)", fontSize: 8.5, fontWeight: 950 }}>{filename.extensionLabel}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "rgba(100,116,139,0.86)", fontSize: 10, fontWeight: 750 }}>
          <span>{formatFileSize(item.size)}</span>
          <span style={{ color: statusColor }}>{ATTACHMENT_UPLOAD_STATE_LABELS[state]}{state === "uploading" || state === "preparing" || state === "retrying" ? ` ${percent}%` : ""}</span>
        </span>
        <span
          role="progressbar"
          aria-label={`${filename.filename} upload progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ height: 4, borderRadius: 999, overflow: "hidden", background: "rgba(148,163,184,0.24)" }}
        >
          <span style={{ width: `${percent}%`, height: "100%", display: "block", borderRadius: 999, background: statusColor, transition: "width 120ms linear" }} />
        </span>
      </span>
      {canCancel && onCancel && (
        <button type="button" onClick={() => onCancel(item.id)} style={{ minHeight: 27, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: "#be123c", cursor: "pointer", padding: "2px 7px", font: "inherit", fontSize: 10, fontWeight: 900 }}>Cancel</button>
      )}
      {canRetry && onRetry && (
        <button type="button" onClick={() => onRetry(item.id)} style={{ minHeight: 27, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: accent, cursor: "pointer", padding: "2px 7px", font: "inherit", fontSize: 10, fontWeight: 900 }}>Retry</button>
      )}
    </div>
  );
};

export const AttachmentCountDropdown: React.FC<AttachmentCountDropdownProps> = ({
  items,
  uploads = [],
  apiBase,
  companyID,
  accent,
  surfaceText,
  align = "right",
  compact = false,
  loading = false,
  loadError = "",
  onRetry,
  onAddFiles,
  onRemove,
  onCancelUpload,
  onRetryUpload,
  onError,
}) => {
  const [open, setOpen] = useState(false);
  const [attachmentMenu, setAttachmentMenu] = useState<{ item: AttachmentCountDropdownItem; x: number; y: number } | null>(null);
  const [previewItem, setPreviewItem] = useState<AttachmentCountDropdownItem | null>(null);
  const [downloadingResourceAttachmentID, setDownloadingResourceAttachmentID] = useState("");
  const [hoveredControlZone, setHoveredControlZone] = useState<"list" | "add" | null>(null);
  const activeUploadCount = uploads.filter((item) => item.progress.state === "preparing" || item.progress.state === "uploading" || item.progress.state === "retrying" || item.progress.state === "completing").length;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const attachmentActionMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const portalTarget = useAppOverlayPortalTarget(triggerRef.current?.ownerDocument);
  const triggerRect = useAppViewportAnchorRect(triggerRef, open);
  const attachmentMenuWidth = compact ? 264 : 340;
  const attachmentMenuPlacement = useMemo(() => {
    if (!triggerRect) return null;
    const view = triggerRef.current?.ownerDocument.defaultView;
    const viewportWidth = view?.innerWidth ?? attachmentMenuWidth + 16;
    const viewportHeight = view?.innerHeight ?? 720;
    const width = Math.min(attachmentMenuWidth, Math.max(160, viewportWidth - 16));
    const preferredLeft = align === "right"
      ? triggerRect.left + triggerRect.width - width
      : triggerRect.left;
    const left = Math.max(8, Math.min(preferredLeft, viewportWidth - width - 8));
    const gap = 7;
    const availableBelow = viewportHeight - triggerRect.top - triggerRect.height - gap - 8;
    const availableAbove = triggerRect.top - gap - 8;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    return {
      width,
      left,
      top: openAbove ? undefined : triggerRect.top + triggerRect.height + gap,
      bottom: openAbove ? viewportHeight - triggerRect.top + gap : undefined,
      maxHeight: Math.max(96, Math.min(330, openAbove ? availableAbove : availableBelow)),
    };
  }, [align, attachmentMenuWidth, triggerRect]);
  const close = useCallback(() => {
    setOpen(false);
    setAttachmentMenu(null);
  }, []);
  useAppFloatingMenuDismissal(open || Boolean(attachmentMenu), rootRef, close, menuRef, attachmentActionMenuRef);
  useEffect(() => {
    if (activeUploadCount > 0) setOpen(true);
  }, [activeUploadCount]);
  const closePreview = useCallback(() => {
    setPreviewItem(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const openAttachmentPreview = useCallback((item: AttachmentCountDropdownItem) => {
    if (!item.resourceAttachment.attachment) {
      onError("attachment_metadata_unavailable");
      return;
    }
    setOpen(false);
    setPreviewItem(item);
  }, [onError]);
  const downloadAttachment = useCallback(async (item: AttachmentCountDropdownItem) => {
    const { resourceAttachment } = item;
    const attachment = resourceAttachment.attachment;
    if (!attachment) {
      onError("attachment_metadata_unavailable");
      return;
    }
    setDownloadingResourceAttachmentID(resourceAttachment.resource_attachment_id);
    try {
      await downloadMangoAttachment({
        apiBase,
        companyID,
        attachmentID: attachment.attachment_id,
        filename: attachment.original_filename,
        variant: "original",
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_download_attachment");
    } finally {
      setDownloadingResourceAttachmentID("");
    }
  }, [apiBase, companyID, onError]);
  return (
    <>
    <div
      ref={rootRef}
      data-mango-attachment-control="split"
      style={{ position: "relative", flex: "0 0 auto", minWidth: 0, display: "inline-flex", alignItems: "stretch", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: compact ? 8 : 9, background: EDITOR_NEU_SURFACE, overflow: "hidden", boxShadow: EDITOR_NEU_SHADOW }}
    >
      <button
        ref={triggerRef}
        data-mango-attachment-control-zone="list"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={loadError ? "Attachments unavailable" : `Attachments (${items.length} complete${activeUploadCount ? `, ${activeUploadCount} uploading` : ""})`}
        title={activeUploadCount ? `${activeUploadCount} attachment upload${activeUploadCount === 1 ? "" : "s"} in progress` : "Attachments"}
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        onMouseEnter={() => setHoveredControlZone("list")}
        onMouseLeave={() => setHoveredControlZone((current) => current === "list" ? null : current)}
        onFocus={() => setHoveredControlZone("list")}
        onBlur={() => setHoveredControlZone((current) => current === "list" ? null : current)}
        style={{
          minHeight: compact ? 24 : 30,
          minWidth: compact ? 38 : 54,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          border: 0,
          borderRadius: 0,
          background: open ? ATTACHMENT_CONTROL_SELECTED_BACKGROUND : hoveredControlZone === "list" ? ATTACHMENT_CONTROL_HOVER_BACKGROUND : "transparent",
          color: open ? accent : surfaceText,
          cursor: "pointer",
          font: "inherit",
          fontSize: compact ? 10.5 : 12,
          fontWeight: 900,
          letterSpacing: 0,
          padding: compact ? "2px 7px" : "0 10px",
          boxShadow: open ? ATTACHMENT_CONTROL_SELECTED_SHADOW : hoveredControlZone === "list" ? ATTACHMENT_CONTROL_HOVER_SHADOW : undefined,
          transition: "background 130ms ease, box-shadow 130ms ease, color 130ms ease",
        }}
      >
        <PaperclipIcon color={open ? accent : "rgba(100,116,139,0.85)"} />
        <span>{loading ? "..." : loadError ? "!" : items.length}</span>
        {activeUploadCount > 0 && <span aria-hidden="true" style={{ color: accent, fontSize: 9, fontWeight: 950 }}>+{activeUploadCount}</span>}
      </button>
      {onAddFiles && (
        <>
          <button
            data-mango-attachment-control-zone="add"
            type="button"
            title="Add attachment"
            aria-label="Add attachment"
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={() => setHoveredControlZone("add")}
            onMouseLeave={() => setHoveredControlZone((current) => current === "add" ? null : current)}
            onFocus={() => setHoveredControlZone("add")}
            onBlur={() => setHoveredControlZone((current) => current === "add" ? null : current)}
            style={{ width: compact ? 27 : 31, minHeight: compact ? 24 : 30, flex: "0 0 auto", display: "grid", placeItems: "center", border: 0, borderLeft: "1px solid rgba(100,116,139,0.18)", borderRadius: 0, background: hoveredControlZone === "add" ? ATTACHMENT_CONTROL_HOVER_BACKGROUND : "transparent", color: accent, cursor: "pointer", padding: 0, boxShadow: hoveredControlZone === "add" ? ATTACHMENT_CONTROL_HOVER_SHADOW : undefined, transition: "background 130ms ease, box-shadow 130ms ease, color 130ms ease" }}
          >
            <PlusIcon color={accent} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            style={{ display: "none" }}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length > 0) void onAddFiles(files);
            }}
          />
        </>
      )}
      {open && portalTarget && attachmentMenuPlacement && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Attachments"
          style={{
            position: "fixed",
            zIndex: 1020,
            ...attachmentMenuPlacement,
            maxWidth: "calc(100vw - 16px)",
            overflowY: "auto",
            display: "grid",
            gap: 5,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 13,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 6,
          }}
        >
          {loading && (
            <div role="status" style={{ padding: "8px 10px", color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 800 }}>
              Loading attachments...
            </div>
          )}
          {!loading && loadError && (
            <div role="alert" style={{ minWidth: 0, display: "grid", gridTemplateColumns: onRetry ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)", alignItems: "center", gap: 8, padding: "8px 10px", color: surfaceText, fontSize: 11, fontWeight: 800 }}>
              <span>Could not load attachments</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  style={{ minHeight: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: accent, cursor: "pointer", padding: "2px 8px", font: "inherit", fontSize: 10.5, fontWeight: 900, letterSpacing: 0 }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {uploads.map((upload) => (
            <AttachmentUploadProgressRow
              key={`upload-${upload.id}`}
              item={upload}
              accent={accent}
              surfaceText={surfaceText}
              onCancel={onCancelUpload}
              onRetry={onRetryUpload}
            />
          ))}
          {!loading && !loadError && items.length === 0 && uploads.length === 0 && (
            <div style={{ padding: "8px 10px", color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 800 }}>
              No attachments
            </div>
          )}
          {!loading && !loadError && items.map((item) => {
            const { resourceAttachment } = item;
            const attachment = resourceAttachment.attachment;
            const filename = attachment?.original_filename?.trim() || "Attachment";
            const filenamePresentation = splitAttachmentFilename(filename);
            const presentationKind = classifyAttachmentPresentation({ filename, mimeType: attachment?.mime_type });
            const downloading = downloadingResourceAttachmentID === resourceAttachment.resource_attachment_id;
            return (
              <div
              key={resourceAttachment.resource_attachment_id}
              role="button"
              tabIndex={0}
              title={`Preview ${filename}`}
              aria-label={`Preview ${filename}`}
              onClick={() => openAttachmentPreview(item)}
              onContextMenu={(event) => {
                if (!onRemove) return;
                event.preventDefault();
                event.stopPropagation();
                const listRect = menuRef.current?.getBoundingClientRect();
                const view = event.currentTarget.ownerDocument.defaultView;
                const viewportWidth = view?.innerWidth ?? 1024;
                const viewportHeight = view?.innerHeight ?? 720;
                const actionWidth = 164;
                const actionHeight = 42;
                const margin = 8;
                const gap = 8;
                let x = Math.max(margin, Math.min(event.clientX, viewportWidth - actionWidth - margin));
                if (listRect) {
                  const rightSide = listRect.right + gap;
                  const leftSide = listRect.left - actionWidth - gap;
                  if (rightSide + actionWidth <= viewportWidth - margin) x = rightSide;
                  else if (leftSide >= margin) x = leftSide;
                }
                const y = Math.max(margin, Math.min(event.clientY, viewportHeight - actionHeight - margin));
                setAttachmentMenu({ item, x, y });
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                openAttachmentPreview(item);
              }}
              style={{
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 7,
                border: "1px solid transparent",
                borderRadius: 10,
                background: "#ffffff",
                color: surfaceText,
                cursor: attachment ? "pointer" : "default",
                padding: "7px 8px",
                boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.14), -2px -2px 8px rgba(255,255,255,0.76)",
              }}
            >
              <span style={{ minWidth: 0, display: "grid", gridTemplateColumns: "34px minmax(0, 1fr)", alignItems: "center", gap: 8, color: surfaceText }}>
                {attachment && presentationKind === "image" ? (
                  <AuthenticatedAttachmentThumbnail apiBase={apiBase} companyID={companyID} attachmentID={attachment.attachment_id} />
                ) : (
                  <AttachmentTypeVisual kind={attachment ? presentationKind : "generic"} />
                )}
                <span style={{ minWidth: 0, display: "grid", gap: 4 }}>
                  <span title={filenamePresentation.filename} style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 6 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 900 }}>{filenamePresentation.baseName}</span>
                    <span
                      title={filenamePresentation.extensionLabel}
                      style={{ maxWidth: 96, justifySelf: "end", border: "1px solid rgba(100,116,139,0.18)", borderRadius: 5, background: "#f8fafc", color: "rgba(71,85,105,0.92)", padding: "2px 4px", fontSize: 8.5, fontWeight: 950, lineHeight: 1.05, letterSpacing: 0, textAlign: "right", whiteSpace: "normal", overflowWrap: "anywhere" }}
                    >
                      {filenamePresentation.extensionLabel}
                    </span>
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 750, color: "rgba(100,116,139,0.86)" }}>
                    {attachment ? formatFileSize(attachment.byte_size) : "File unavailable"}
                  </span>
                </span>
              </span>
              <button
                type="button"
                role="menuitem"
                title={`Download ${filename}`}
                aria-label={`Download ${filename}`}
                disabled={!attachment || downloading}
                onClick={(event) => {
                  event.stopPropagation();
                  void downloadAttachment(item);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                style={{ width: 28, height: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: !attachment || downloading ? "not-allowed" : "pointer", opacity: !attachment || downloading ? 0.5 : 1, padding: 0, boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)" }}
              >
                <DownloadIcon color={accent} />
              </button>
            </div>
            );
          })}
        </div>,
        portalTarget,
      )}
      {attachmentMenu && onRemove && portalTarget && createPortal(
        <div
          ref={attachmentActionMenuRef}
          role="menu"
          aria-label="Attachment actions"
          onContextMenu={(event) => event.preventDefault()}
          style={{ position: "fixed", zIndex: 1030, top: attachmentMenu.y, left: attachmentMenu.x, width: 164, boxSizing: "border-box", display: "grid", gap: 3, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, padding: 5 }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const item = attachmentMenu.item;
              setAttachmentMenu(null);
              onRemove(item);
            }}
            style={{ minHeight: 30, border: "1px solid transparent", borderRadius: 7, background: "transparent", color: "#dc2626", cursor: "pointer", padding: "5px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Delete permanently
          </button>
        </div>,
        portalTarget,
      )}
    </div>
    {previewItem?.resourceAttachment.attachment && (
      <AttachmentPreviewModal
        attachment={previewItem.resourceAttachment.attachment}
        previewKind={classifyAttachmentPreview({
          filename: previewItem.resourceAttachment.attachment.original_filename,
          mimeType: previewItem.resourceAttachment.attachment.mime_type,
        })}
        apiBase={apiBase}
        companyID={companyID}
        accent={accent}
        surfaceText={surfaceText}
        onClose={closePreview}
        onError={onError}
      />
    )}
    </>
  );
};

type AttachedEmailFolderLayout = {
  id: string;
  name: string;
  parentID?: string;
  collapsed: boolean;
};

type AttachedEmailPaneLayout = {
  folders: AttachedEmailFolderLayout[];
  emailOrder: string[];
  emailFolderByID: Record<string, string>;
  collapsedThreadIDs: string[];
};

type AttachedEmailOrganizerPaneProps = {
  emails: EditorAttachedEmail[];
  nodeID?: string;
  apiBase?: string;
	companyID: string;
	currentUserID?: string;
	companyUsers?: MentionableCompanyUser[];
  attachmentRequestJSON?: AttachmentRequestJSON;
  attachmentResourceType?: MangoAttachmentResourceType;
  attachmentResourceID?: string;
  attachmentInformationID?: string;
  attachmentEditorSurface?: string;
  storageKey: string;
  tabbed?: boolean;
  expandContent?: boolean;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  selectedMessageID?: string;
  focusMessageID?: string;
  focusMessageRequestID?: number;
  activeEmailSelection?: EmailActiveSelection | null;
  emailHighlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  onSelectMessage?: (messageID: string) => void;
  onClearSelectedMessage?: () => void;
  onRemoveEmail?: (emailID: string) => void;
  onEmailSelectionChatRequest?: (messageID: string, selection: EmailSelectionDraft) => void;
  onEmailSelectionTextBoxRequest?: (messageID: string, quote: string) => void;
  onEmailSelectionNodeRequest?: (messageID: string, quote: string) => void;
  onEmailMessageTextBoxRequest?: (messageID: string) => void;
  onEmailMessageActivate?: (messageID: string) => void;
  messageAccents?: Record<string, string>;
  onReplyEditorFocus?: () => void;
  emailFocusExpanded?: boolean;
  onRequestEmailFocusToggle?: () => void;
  onError: (message: string) => void;
};

const EMPTY_ATTACHED_EMAIL_LAYOUT: AttachedEmailPaneLayout = {
  folders: [],
  emailOrder: [],
  emailFolderByID: {},
  collapsedThreadIDs: [],
};

const FolderPlusIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.4 5.2h5l1.2 1.4h7v8.1H2.4Z" fill="none" stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
    <path d="M12.2 8.5v4M10.2 10.5h4" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" />
  </svg>
);

const FolderIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.4 5.2h5l1.2 1.4h7v8.1H2.4Z" fill="none" stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
  </svg>
);

const TinyDisclosureIcon: React.FC<{ open: boolean; color: string }> = ({ open, color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" style={{ display: "block", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}>
    <path d="M4.7 3.2 8.3 6.5 4.7 9.8" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function uniqueAttachedEmailsByMessageID(emails: EditorAttachedEmail[]): EditorAttachedEmail[] {
  const byID = new Map<string, EditorAttachedEmail>();
  for (const email of emails) {
    const messageID = email.messageID.trim();
    if (!messageID || byID.has(messageID)) continue;
    byID.set(messageID, email);
  }
  return Array.from(byID.values());
}

function readStoredAttachedEmailPaneLayout(storageKey: string): AttachedEmailPaneLayout {
  if (typeof window === "undefined" || !storageKey.trim()) return EMPTY_ATTACHED_EMAIL_LAYOUT;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<AttachedEmailPaneLayout>;
    return {
      folders: Array.isArray(parsed.folders)
        ? parsed.folders
          .map((folder): AttachedEmailFolderLayout | null => {
            const id = typeof folder?.id === "string" ? folder.id.trim() : "";
            const name = typeof folder?.name === "string" ? folder.name.trim() : "";
            const parentID = typeof folder?.parentID === "string" ? folder.parentID.trim() : "";
            return id && name ? { id, name, parentID: parentID || undefined, collapsed: Boolean(folder.collapsed) } : null;
          })
          .filter((folder): folder is AttachedEmailFolderLayout => Boolean(folder))
        : [],
      emailOrder: Array.isArray(parsed.emailOrder) ? parsed.emailOrder.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [],
      emailFolderByID: parsed.emailFolderByID && typeof parsed.emailFolderByID === "object" && !Array.isArray(parsed.emailFolderByID)
        ? Object.fromEntries(Object.entries(parsed.emailFolderByID).filter(([emailID, folderID]) => emailID.trim() && typeof folderID === "string"))
        : {},
      collapsedThreadIDs: Array.isArray(parsed.collapsedThreadIDs) ? parsed.collapsedThreadIDs.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [],
    };
  } catch {
    return EMPTY_ATTACHED_EMAIL_LAYOUT;
  }
}

function writeStoredAttachedEmailPaneLayout(storageKey: string, layout: AttachedEmailPaneLayout): void {
  if (typeof window === "undefined" || !storageKey.trim()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // The email layout is a local convenience and should not block the editor.
  }
}

function normalizeAttachedEmailPaneLayout(layout: AttachedEmailPaneLayout, emails: EditorAttachedEmail[]): AttachedEmailPaneLayout {
  const emailIDs = uniqueAttachedEmailsByMessageID(emails).map((email) => email.messageID);
  const emailIDSet = new Set(emailIDs);
  const folders = layout.folders.reduce<AttachedEmailFolderLayout[]>((next, folder) => {
    const id = folder.id.trim();
    const name = folder.name.trim();
    if (!id || !name || next.some((item) => item.id === id)) return next;
    next.push({ id, name, parentID: folder.parentID?.trim() || undefined, collapsed: Boolean(folder.collapsed) });
    return next;
  }, []);
  const initialFolderIDs = new Set(folders.map((folder) => folder.id));
  const foldersWithValidParents = folders.map((folder) => {
    const parentID = folder.parentID?.trim() ?? "";
    if (!parentID || parentID === folder.id || !initialFolderIDs.has(parentID)) return { ...folder, parentID: undefined };
    return { ...folder, parentID };
  });
  const folderByID = new Map(foldersWithValidParents.map((folder) => [folder.id, folder]));
  const createsCycle = (folderID: string, parentID: string): boolean => {
    let cursor = parentID;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === folderID || visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = folderByID.get(cursor)?.parentID ?? "";
    }
    return false;
  };
  const normalizedFolders = foldersWithValidParents.map((folder) => (
    folder.parentID && createsCycle(folder.id, folder.parentID) ? { ...folder, parentID: undefined } : folder
  ));
  const folderIDs = new Set(normalizedFolders.map((folder) => folder.id));
  const emailOrder = layout.emailOrder.filter((id) => emailIDSet.has(id));
  for (const id of emailIDs) {
    if (!emailOrder.includes(id)) emailOrder.push(id);
  }
  const emailFolderByID: Record<string, string> = {};
  for (const [emailID, folderID] of Object.entries(layout.emailFolderByID)) {
    if (emailIDSet.has(emailID) && folderIDs.has(folderID)) emailFolderByID[emailID] = folderID;
  }
  return {
    folders: normalizedFolders,
    emailOrder,
    emailFolderByID,
    collapsedThreadIDs: layout.collapsedThreadIDs.filter((id) => emailIDSet.has(id)),
  };
}

function createAttachedEmailFolderID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `folder:${Date.now()}:${Math.round(Math.random() * 1_000_000)}`;
}

type AttachedEmailThreadPreview = {
  messages: EmailMessage[];
  downloadStatus: EmailThreadDownloadStatus;
};

async function loadAttachedEmailThreadPreview(email: EditorAttachedEmail, companyID: string, nodeID: string): Promise<AttachedEmailThreadPreview> {
  const durableThreadID = email.emailThreadID?.trim() ?? "";
  if (durableThreadID && nodeID.trim()) {
    const durableThread = await getNodeEmailThread(companyID, nodeID, durableThreadID);
    const primary = durableThread.messages.find((message) => message.id === email.messageID)
      ?? durableThread.messages[0] ?? null;
    return { messages: primary
      ? mergeEmailThreadMessages(primary, durableThread.messages, primary.local_replies ?? [])
      : [], downloadStatus: resolveEmailThreadDownloadStatus(durableThread.download_status, durableThread.history_complete, durableThread.thread_id) };
  }
  const mailboxScope = resolveEditorEmailMailboxScope(email.sharedInboxID, email.accountEmail);
  const collaborationID = email.collaborationID?.trim() ?? "";
  if (collaborationID) {
    const collaborationThread = await getEmailCollaborationThread(companyID, collaborationID);
    const primary = collaborationThread.messages.find((message) => message.id === email.messageID)
      ?? collaborationThread.messages[0]
      ?? null;
    return { messages: primary
      ? mergeEmailThreadMessages(primary, collaborationThread.messages, primary.local_replies ?? [])
      : [], downloadStatus: resolveEmailThreadDownloadStatus(collaborationThread.download_status, collaborationThread.history_complete, collaborationThread.thread_id) };
  }
  const primary = await getEmailMessage(email.messageID, companyID, mailboxScope.sharedInboxID, { accountEmail: mailboxScope.accountEmail });
  const threadID = primary.thread_id?.trim() || email.threadID?.trim() || "";
  if (!threadID) return { messages: mergeEmailThreadMessages(primary, [primary], primary.local_replies ?? []), downloadStatus: "complete" };
  try {
    const thread = await getEmailThread(threadID, companyID, mailboxScope.sharedInboxID, mailboxScope.accountEmail);
    const ids = Array.from(new Set((thread.message_ids ?? []).map((id) => id.trim()).filter(Boolean)));
    if (!ids.includes(primary.id)) ids.unshift(primary.id);
    const details = await Promise.all(ids.map(async (id) => {
      if (id === primary.id) return primary;
      try {
        return await getEmailMessage(id, companyID, mailboxScope.sharedInboxID, { accountEmail: mailboxScope.accountEmail });
      } catch {
        return thread.latest_draft_or_message?.id === id ? thread.latest_draft_or_message : null;
      }
    }));
    return { messages: mergeEmailThreadMessages(primary, details.filter((item): item is EmailMessage => Boolean(item)), primary.local_replies ?? []), downloadStatus: "complete" };
  } catch {
    return { messages: mergeEmailThreadMessages(primary, [primary], primary.local_replies ?? []), downloadStatus: "complete" };
  }
}

const AttachedEmailThreadCard: React.FC<{
  email: EditorAttachedEmail;
  nodeID?: string;
  apiBase?: string;
	companyID: string;
	currentUserID?: string;
	attachmentRequestJSON?: AttachmentRequestJSON;
  attachmentResourceType?: MangoAttachmentResourceType;
  attachmentResourceID?: string;
  attachmentInformationID?: string;
  attachmentEditorSurface?: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  selected: boolean;
  collapsed: boolean;
  draggable: boolean;
  replyTargetMessageID?: string;
  replyAll?: boolean;
  activeSelection?: EmailActiveSelection | null;
  initialFocusMessageID?: string;
  initialFocusMessageRequestID?: number;
  highlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onFocusMessageFound?: (rootMessageID: string) => void;
  onMessageActivate?: (messageID: string) => void;
  onReply: (messageID: string, replyAll: boolean) => void;
  onReplyComplete: () => void;
  onReplyEditorFocus?: () => void;
  onError: (message: string) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>, email: EditorAttachedEmail) => void;
  onDragStart: React.DragEventHandler<HTMLDivElement>;
  onDragEnd: React.DragEventHandler<HTMLDivElement>;
  onDropOnEmail: React.DragEventHandler<HTMLDivElement>;
  onSelectionChatRequest?: (messageID: string, selection: EmailSelectionDraft) => void;
  onSelectionTextBoxRequest?: (messageID: string, quote: string) => void;
  onSelectionNodeRequest?: (messageID: string, quote: string) => void;
  onMessageTextBoxRequest?: (messageID: string) => void;
  messageAccents?: Record<string, string>;
  companyUsers?: MentionableCompanyUser[];
}> = ({ email, nodeID = "", apiBase = "", companyID, currentUserID = "", companyUsers = [], attachmentRequestJSON, attachmentResourceType, attachmentResourceID, attachmentInformationID, attachmentEditorSurface, editable, accent, surfaceText, strokeColor, ruleColor, selected, collapsed, draggable, replyTargetMessageID = "", replyAll = false, activeSelection = null, initialFocusMessageID, initialFocusMessageRequestID = 0, highlightRemovalRequest = null, onToggleCollapsed, onSelect, onFocusMessageFound, onMessageActivate, onReply, onReplyComplete, onReplyEditorFocus, onError, onContextMenu, onDragStart, onDragEnd, onDropOnEmail, onSelectionChatRequest, onSelectionTextBoxRequest, onSelectionNodeRequest, onMessageTextBoxRequest, messageAccents = {} }) => {
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
	const [threadDownloadStatus, setThreadDownloadStatus] = useState<EmailThreadDownloadStatus>("complete");
	const handledFocusMessageRequestRef = useRef("");
	const refreshStoredThreadRef = useRef<() => void>(() => undefined);
	const [activeSharedDraft, setActiveSharedDraft] = useState<CommunicationsEmailDraft | null>(null);
	const autoOpenedSharedDraftRef = useRef("");

	useEffect(() => {
		let cancelled = false;
		let initialLoad = true;
    setLoading(true);
    setLoadError("");
    setThreadMessages([]);
    const refreshStoredThread = async () => {
      try {
        const preview = await loadAttachedEmailThreadPreview(email, companyID, nodeID);
        if (cancelled) return;
        setThreadMessages(preview.messages);
        setThreadDownloadStatus(preview.downloadStatus);
        setLoadError("");
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "failed_to_load_thread");
      } finally {
        if (initialLoad && !cancelled) setLoading(false);
        initialLoad = false;
      }
		};
		refreshStoredThreadRef.current = () => { void refreshStoredThread(); };
		void refreshStoredThread();
		return () => {
			cancelled = true;
			refreshStoredThreadRef.current = () => undefined;
		};
	}, [companyID, email, nodeID]);

	useEffect(() => {
		if (threadDownloadStatus !== "downloading") return;
		const mailbox = resolveEditorEmailMailboxScope(email.sharedInboxID, email.accountEmail);
		const scope = mailbox.sharedInboxID
			? realtimeSharedMailboxScope(mailbox.sharedInboxID)
			: realtimePersonalMailboxScope(currentUserID, mailbox.accountEmail ?? "");
		if (!apiBase.trim() || !companyID.trim() || !scope) return;
		return subscribeRealtimeScope(apiBase, companyID, scope, {
			onMailboxMessageChanged: (change) => {
				const messageMatches = !change.message_id || change.message_id === email.messageID;
				const threadMatches = !change.thread_id || change.thread_id === email.threadID;
				if (messageMatches || threadMatches) refreshStoredThreadRef.current();
			},
		});
	}, [apiBase, companyID, currentUserID, email.accountEmail, email.messageID, email.sharedInboxID, email.threadID, threadDownloadStatus]);

  useEffect(() => {
    const durableThreadID = email.emailThreadID?.trim() ?? "";
    if (!durableThreadID || !email.collaborationID?.trim()) {
      setActiveSharedDraft(null);
      return;
    }
    let cancelled = false;
    void listEmailDrafts(companyID, {}).then((drafts) => {
      if (cancelled) return;
      const draft = drafts.find((candidate) => candidate.is_shared && candidate.email_thread_id?.trim() === durableThreadID) ?? null;
      setActiveSharedDraft(draft);
      if (draft?.origin_node_id?.trim() === nodeID.trim() && autoOpenedSharedDraftRef.current !== draft.draft_id) {
        autoOpenedSharedDraftRef.current = draft.draft_id;
        onSelect();
        onReply(draft.reply_to_message?.id?.trim() || email.messageID, true);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyID, email.collaborationID, email.emailThreadID, email.messageID, nodeID, onReply, onSelect]);

  const initialFocusProviderMessageID = initialFocusMessageID?.trim() === email.emailMessageID
    ? email.messageID
    : threadMessages.find((message) => message.email_message_id?.trim() === initialFocusMessageID?.trim())?.id ?? "";

  useEffect(() => {
    const targetMessageID = initialFocusMessageID?.trim() ?? "";
    if (!targetMessageID || !initialFocusProviderMessageID || !onFocusMessageFound) return;
    const requestKey = `${targetMessageID}:${initialFocusMessageRequestID}`;
    if (handledFocusMessageRequestRef.current === requestKey) return;
    handledFocusMessageRequestRef.current = requestKey;
    onFocusMessageFound(email.messageID);
  }, [email.messageID, initialFocusMessageID, initialFocusMessageRequestID, initialFocusProviderMessageID, onFocusMessageFound]);

  const childMessages = threadMessages.filter((message) => message.id !== email.messageID);
  const hasThreadChildren = childMessages.length > 0;
  const threadDownloadMessage = threadDownloadStatus === "downloading"
    ? "Downloading the rest of this email thread..."
    : threadDownloadStatus === "failed"
      ? "The rest of this email thread could not be downloaded. Import this email again to retry."
      : threadDownloadStatus === "partial"
        ? "Only part of this email thread is stored. Import this email again to retry."
        : "";
  const replyButtonStyle = (enabled: boolean): React.CSSProperties => ({
    minHeight: 22,
    border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
    borderRadius: 7,
    background: EDITOR_NEU_SURFACE,
    color: accent,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.45,
    padding: "2px 7px",
    fontSize: 9.5,
    fontWeight: 850,
    letterSpacing: 0,
    boxShadow: "1px 1px 4px rgba(174,174,192,0.14), -1px -1px 4px rgba(255,255,255,0.76)",
  });
  const replyComposerOpen = Boolean(replyTargetMessageID.trim());
  const replyAvailable = editable;
  const internalMessageIDForProvider = (providerMessageID: string): string => {
    const cleanProviderMessageID = providerMessageID.trim();
    return threadMessages.find((message) => message.id.trim() === cleanProviderMessageID)?.email_message_id?.trim()
      || (cleanProviderMessageID === email.messageID.trim() ? email.emailMessageID?.trim() : "")
      || "";
  };
  const durableSelection = (selection: EmailSelectionDraft): [string, EmailSelectionDraft] | null => {
    const internalMessageID = internalMessageIDForProvider(selection.messageID || email.messageID);
    if (!internalMessageID) {
      onError("email_message_id_missing");
      return null;
    }
    return [internalMessageID, { ...selection, messageID: internalMessageID }];
  };
  const rootMessageAccent = messageAccents[email.emailMessageID?.trim() || email.messageID]?.trim() || "";
  return (
    <div
      onDragEnd={onDragEnd}
      onContextMenu={(event) => {
        if (!editable || !onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event, email);
      }}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={onDropOnEmail}
      style={{ minWidth: 0, display: "grid", gap: selected || collapsed ? 0 : 7 }}
    >
      <div
        style={{
          minWidth: 0,
          overflow: "hidden",
          borderStyle: "solid",
          borderTopWidth: 1,
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderLeftWidth: rootMessageAccent ? 3 : 1,
          borderTopColor: selected ? "transparent" : strokeColor,
          borderRightColor: selected ? "transparent" : strokeColor,
          borderBottomColor: selected ? "transparent" : strokeColor,
          borderLeftColor: rootMessageAccent || (selected ? "transparent" : strokeColor),
          borderRadius: 10,
          background: "#ffffff",
          color: surfaceText,
          boxShadow: selected ? "0 9px 22px rgba(15,23,42,0.12), 0 0 14px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 8px rgba(174,174,192,0.15), -2px -2px 8px rgba(255,255,255,0.76), inset 1px 1px 0 rgba(255,255,255,0.86)",
        }}
      >
        <div
          role="button"
          tabIndex={0}
          draggable={draggable}
          title={selected ? "Collapse email" : email.subject}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={() => {
            onMessageActivate?.(email.messageID);
            onSelect();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            onSelect();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onMessageActivate?.(email.messageID);
              onSelect();
            }
          }}
          style={{
            minWidth: 0,
            display: "grid",
            gap: 5,
            color: surfaceText,
            cursor: selected ? "pointer" : draggable ? "grab" : "pointer",
            userSelect: "none",
            padding: selected ? "9px 10px 6px" : "9px 10px",
            background: rootMessageAccent ? `linear-gradient(90deg, ${rootMessageAccent}30, ${rootMessageAccent}0c 58%, rgba(255,255,255,0.96))` : undefined,
          }}
        >
          <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) auto${activeSharedDraft ? " auto" : ""} auto auto${hasThreadChildren ? " 22px" : ""}`, alignItems: "center", gap: 7 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 900 }}>{email.subject}</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: accent, whiteSpace: "nowrap" }}>{formatTimestamp(email.date)}</span>
            {activeSharedDraft && (
              <button
                type="button"
                title="Toggle universal shared draft"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (replyComposerOpen) onReplyComplete();
                  else onReply(activeSharedDraft.reply_to_message?.id?.trim() || email.messageID, true);
                }}
                style={replyButtonStyle(true)}
              >
                Draft 1
              </button>
            )}
            <button
              type="button"
              disabled={!replyAvailable}
              title="Reply"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (replyAvailable) onReply(email.messageID, false);
              }}
              style={replyButtonStyle(replyAvailable)}
            >
              <ChatIcon color={accent} />
              Reply
            </button>
            <button
              type="button"
              disabled={!replyAvailable}
              title="Reply all"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (replyAvailable) onReply(email.messageID, true);
              }}
              style={replyButtonStyle(replyAvailable)}
            >
              Reply all
            </button>
            {hasThreadChildren && (
              <button
                type="button"
                title={collapsed ? "Expand email thread" : "Collapse email thread"}
                aria-expanded={!collapsed}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleCollapsed();
                }}
                style={{ width: 22, height: 22, border: `1px solid ${strokeColor}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}
              >
                <TinyDisclosureIcon open={!collapsed} color={accent} />
              </button>
            )}
          </div>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.86)", fontSize: 10.5, fontWeight: 800 }}>
            {email.from || "Unknown sender"}
          </div>
          {email.snippet && <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.72)", fontSize: 10.5, fontWeight: 650 }}>{email.snippet}</div>}
          {threadDownloadMessage && (
            <div
              role={threadDownloadStatus === "failed" ? "alert" : "status"}
              data-email-thread-download-status={threadDownloadStatus}
              aria-live={threadDownloadStatus === "failed" ? "assertive" : "polite"}
              style={{ color: threadDownloadStatus === "failed" ? "#991b1b" : accent, fontSize: 10, fontWeight: 800 }}
            >
              {threadDownloadMessage}
            </div>
          )}
        </div>
        {selected && (
          <div
            className="mango-email-inline-detail"
            style={{
              minWidth: 0,
              display: replyComposerOpen ? "grid" : "block",
              gridTemplateRows: replyComposerOpen ? "minmax(0, 1fr)" : undefined,
              height: replyComposerOpen ? "clamp(420px, calc(100vh - 300px), 760px)" : "auto",
              minHeight: replyComposerOpen ? undefined : 0,
              maxHeight: undefined,
              overflow: replyComposerOpen ? "hidden" : "visible",
              padding: replyComposerOpen ? "0 10px" : "0 10px 10px",
              boxSizing: "border-box",
              cursor: "text",
              userSelect: "text",
            }}
          >
            <EmailConversationPane
              messageID={email.messageID}
              collaborationID={email.collaborationID}
              emailThreadID={email.emailThreadID}
              nodeID={nodeID}
              apiBase={apiBase}
			companyID={companyID}
			currentUserID={currentUserID}
			companyUsers={companyUsers}
              sharedInboxID={email.sharedInboxID}
              accountEmail={email.accountEmail}
              attachmentRequestJSON={attachmentRequestJSON}
              attachmentResourceType={attachmentResourceType}
              attachmentResourceID={attachmentResourceID}
              attachmentInformationID={attachmentInformationID}
              attachmentEditorSurface={attachmentEditorSurface}
              editable={editable}
              accent={accent}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              ruleColor={ruleColor}
              activeSelection={activeSelection}
              initialFocusMessageID={initialFocusProviderMessageID}
              initialFocusMessageRequestID={initialFocusMessageRequestID}
              onMessageActivate={onMessageActivate}
              highlightRemovalRequest={highlightRemovalRequest}
              initialReplyTargetMessageID={replyTargetMessageID}
              initialReplyAll={replyAll}
              inlineExpansion
              onReplyComplete={onReplyComplete}
              onReplyEditorFocus={onReplyEditorFocus}
              onError={onError}
              onSelectionChatRequest={onSelectionChatRequest ? (selection) => { const durable = durableSelection(selection); if (durable) onSelectionChatRequest(...durable); } : undefined}
              onSelectionTextBoxRequest={onSelectionTextBoxRequest ? (selection) => { const durable = durableSelection(selection); if (durable) onSelectionTextBoxRequest(durable[0], selection.quote); } : undefined}
              onSelectionNodeRequest={onSelectionNodeRequest ? (selection) => { const durable = durableSelection(selection); if (durable) onSelectionNodeRequest(durable[0], selection.quote); } : undefined}
              onMessageTextBoxRequest={onMessageTextBoxRequest ? (providerMessageID) => { const internalMessageID = internalMessageIDForProvider(providerMessageID); if (!internalMessageID) { onError("email_message_id_missing"); return; } onMessageTextBoxRequest(internalMessageID); } : undefined}
              messageAccents={messageAccents}
            />
          </div>
        )}
      </div>
      {!selected && !collapsed && (loading || loadError || hasThreadChildren) && (
        <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
          {loading && <div style={{ color: accent, fontSize: 10.5, fontWeight: 850, padding: "2px 0 2px 28px" }}>Loading thread</div>}
          {loadError && <div style={{ color: "#991b1b", fontSize: 10.5, fontWeight: 800, paddingLeft: 28 }}>{loadError}</div>}
          {childMessages.map((message, index) => {
            const relative = formatEmailRelativeTime(message.date);
            const messageAccent = messageAccents[message.id]?.trim() || "";
            const sent = (message.folders ?? []).some((folder) => folder.trim().toLowerCase() === "sent" || folder.trim().toLowerCase() === "\\sent")
              || (message.from ?? []).some((address) => Boolean(email.accountEmail?.trim()) && address.email.trim().toLowerCase() === email.accountEmail?.trim().toLowerCase());
            const activateMessage = () => {
              onMessageActivate?.(message.id);
              onSelect();
            };
            return (
              <div
                key={message.id}
                style={{ minWidth: 0, display: "grid", gridTemplateColumns: "20px minmax(0, 1fr)", gap: 8, alignItems: "stretch" }}
              >
                <NodeEmailConversationTimeline
                  expanded={false}
                  sent={sent}
                  timelineStart={index === 0}
                  timelineEnd={index === childMessages.length - 1}
                />
                <div
                role="button"
                tabIndex={0}
                title={message.subject || email.subject}
                onClick={activateMessage}
                onKeyDown={(event) => {
                  if (event.key === "Enter") activateMessage();
                }}
                style={{ minWidth: 0, display: "grid", gap: 3, border: `1px solid ${strokeColor}`, borderLeft: messageAccent ? `3px solid ${messageAccent}` : undefined, borderRadius: 9, background: messageAccent ? `linear-gradient(135deg, ${messageAccent}26, rgba(255,255,255,0.94))` : "rgba(255,255,255,0.82)", color: surfaceText, cursor: "pointer", padding: "7px 8px", textAlign: "left", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)" }}
              >
                <span style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto auto", gap: 7, alignItems: "center" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.8, fontWeight: 900 }}>{formatAddressList(message.from) || "Unknown sender"}</span>
                  <span style={{ color: "rgba(100,116,139,0.76)", fontSize: 9.3, fontWeight: 760, whiteSpace: "nowrap" }}>{formatTimestamp(message.date)}{relative ? ` (${relative})` : ""}</span>
                  <button
                    type="button"
                    disabled={!editable}
                    title="Reply"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (editable) onReply(message.id, false);
                    }}
                    style={replyButtonStyle(editable)}
                  >
                    <ChatIcon color={accent} />
                    Reply
                  </button>
                  <button
                    type="button"
                    disabled={!editable}
                    title="Reply all"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (editable) onReply(message.id, true);
                    }}
                    style={replyButtonStyle(editable)}
                  >
                    Reply all
                  </button>
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.76)", fontSize: 10, fontWeight: 650 }}>{emailBodyText(message.body || message.snippet || "") || "(empty email)"}</span>
              </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

type LinkedEmailPreviewPaneProps = {
  messageID: string;
  emails: EditorAttachedEmail[];
  nodeID?: string;
  apiBase?: string;
  companyID: string;
  currentUserID?: string;
  companyUsers?: MentionableCompanyUser[];
  attachmentRequestJSON?: AttachmentRequestJSON;
  attachmentResourceType?: MangoAttachmentResourceType;
  attachmentResourceID?: string;
  attachmentInformationID?: string;
  attachmentEditorSurface?: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  activeSelection?: EmailActiveSelection | null;
  highlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  onEmailSelectionChatRequest?: (messageID: string, selection: EmailSelectionDraft) => void;
  onEmailSelectionTextBoxRequest?: (messageID: string, quote: string) => void;
  onEmailSelectionNodeRequest?: (messageID: string, quote: string) => void;
  onError: (message: string) => void;
};

type ResolvedLinkedEmailPreview = {
  email: EditorAttachedEmail;
  focusMessageID: string;
};

async function resolveLinkedEmailPreview(
  messageID: string,
  emails: EditorAttachedEmail[],
  companyID: string,
  nodeID: string,
): Promise<ResolvedLinkedEmailPreview | null> {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return null;
  const directMessage = emails.find((email) => email.emailMessageID.trim() === cleanMessageID);
  if (directMessage) return { email: directMessage, focusMessageID: directMessage.messageID };
  const directProjection = emails.find((email) => email.id.trim() === cleanMessageID);
  if (directProjection) return { email: directProjection, focusMessageID: directProjection.messageID };

  const threadResults = await Promise.allSettled(emails.map(async (email) => ({
    email,
    messages: (await loadAttachedEmailThreadPreview(email, companyID, nodeID)).messages,
  })));
  for (const result of threadResults) {
    if (result.status !== "fulfilled") continue;
    const matchedMessage = result.value.messages.find((message) => message.email_message_id?.trim() === cleanMessageID);
    if (matchedMessage) {
      return { email: result.value.email, focusMessageID: matchedMessage.id };
    }
  }

  const mailboxCandidates: Array<EditorAttachedEmail | null> = emails.length > 0 ? emails : [null];
  const attemptedScopes = new Set<string>();
  for (const candidate of mailboxCandidates) {
    if (candidate?.collaborationID?.trim()) continue;
    const mailboxScope = resolveEditorEmailMailboxScope(candidate?.sharedInboxID, candidate?.accountEmail);
    const scopeKey = `${mailboxScope.sharedInboxID ?? ""}\u0000${mailboxScope.accountEmail ?? ""}`;
    if (attemptedScopes.has(scopeKey)) continue;
    attemptedScopes.add(scopeKey);
    try {
      const message = await getEmailMessage(cleanMessageID, companyID, mailboxScope.sharedInboxID, { accountEmail: mailboxScope.accountEmail });
      const emailMessageID = message.email_message_id?.trim() ?? "";
      if (!emailMessageID) throw new Error("email_message_id_missing");
      return {
        email: {
          ...(candidate ?? {
            id: `linked-email:${cleanMessageID}`,
            messageID: message.id,
            emailMessageID,
            attachedTimestamp: "",
            subject: message.subject || "(no subject)",
          }),
          collaborationID: undefined,
          emailThreadID: undefined,
          messageID: message.id,
          emailMessageID,
          threadID: message.thread_id?.trim() || candidate?.threadID,
          subject: message.subject || candidate?.subject || "(no subject)",
          snippet: message.snippet || candidate?.snippet,
          from: formatAddressList(message.from) || candidate?.from,
          date: message.date ?? candidate?.date,
        },
        focusMessageID: message.id,
      };
    } catch {
      // Try the next attached mailbox scope before reporting that the link is unavailable.
    }
  }
  return null;
}

/** One exact provider message embedded below its linked text-box header. */
export const LinkedEmailPreviewPane: React.FC<LinkedEmailPreviewPaneProps> = ({
  messageID,
  emails,
  nodeID = "",
  apiBase = "",
  companyID,
  currentUserID = "",
  companyUsers = [],
  attachmentRequestJSON,
  attachmentResourceType,
  attachmentResourceID,
  attachmentInformationID,
  attachmentEditorSurface,
  editable,
  accent,
  surfaceText,
  strokeColor,
  activeSelection = null,
  highlightRemovalRequest = null,
  onEmailSelectionChatRequest,
  onEmailSelectionTextBoxRequest,
  onEmailSelectionNodeRequest,
  onError,
}) => {
  const [resolvedPreview, setResolvedPreview] = useState<ResolvedLinkedEmailPreview | null>(null);
  const [resolving, setResolving] = useState(true);
  const [resolveError, setResolveError] = useState("");
  const [resolveRequestID, setResolveRequestID] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResolvedPreview(null);
    setResolveError("");
    setResolving(true);
    void resolveLinkedEmailPreview(messageID, emails, companyID, nodeID)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved) setResolvedPreview(resolved);
        else setResolveError("The linked email could not be loaded from this Node's attached email threads.");
      })
      .catch(() => {
        if (!cancelled) setResolveError("The linked email could not be loaded from this Node's attached email threads.");
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => { cancelled = true; };
  }, [companyID, emails, messageID, nodeID, resolveRequestID]);

  return (
    <div data-node-linked-email-preview="true" className="editor-document-scroll" style={{ minWidth: 0, minHeight: 0, overflow: "visible", padding: 8, background: "#ffffff", ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
      {resolving && (
        <div role="status" style={{ minHeight: 72, display: "grid", placeItems: "center", color: accent, fontSize: 11, fontWeight: 850 }}>
          Loading linked email
        </div>
      )}
      {!resolving && resolveError && (
        <div role="alert" style={{ minHeight: 72, display: "grid", placeItems: "center", gap: 8, color: "#991b1b", fontSize: 11, fontWeight: 800, textAlign: "center", padding: 10 }}>
          <span>{resolveError}</span>
          <button type="button" onClick={() => setResolveRequestID((current) => current + 1)} style={{ minHeight: 28, border: `1px solid ${strokeColor}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, cursor: "pointer", padding: "0 10px", fontSize: 10.5, fontWeight: 900 }}>
            Retry
          </button>
        </div>
      )}
      {resolvedPreview && (
        <EmailConversationPane
          messageID={resolvedPreview.focusMessageID}
          collaborationID={resolvedPreview.email.collaborationID}
          nodeID={nodeID}
          emailThreadID={resolvedPreview.email.emailThreadID}
          apiBase={apiBase}
          companyID={companyID}
          currentUserID={currentUserID}
          companyUsers={companyUsers}
          sharedInboxID={resolvedPreview.email.sharedInboxID}
          accountEmail={resolvedPreview.email.accountEmail}
          attachmentRequestJSON={attachmentRequestJSON}
          attachmentResourceType={attachmentResourceType}
          attachmentResourceID={attachmentResourceID}
          attachmentInformationID={attachmentInformationID}
          attachmentEditorSurface={attachmentEditorSurface}
          editable={editable}
          accent={accent}
          surfaceText={surfaceText}
          strokeColor={strokeColor}
          ruleColor="transparent"
          activeSelection={activeSelection?.messageID === resolvedPreview.focusMessageID ? activeSelection : null}
          highlightRemovalRequest={highlightRemovalRequest?.messageID === resolvedPreview.focusMessageID ? highlightRemovalRequest : null}
          initialFocusMessageID={resolvedPreview.focusMessageID}
          initialFocusMessageRequestID={resolveRequestID + 1}
          inlineExpansion
          singleMessageOnly
          onError={onError}
          onSelectionChatRequest={onEmailSelectionChatRequest ? (selection) => onEmailSelectionChatRequest(selection.messageID, selection) : undefined}
          onSelectionTextBoxRequest={onEmailSelectionTextBoxRequest ? (selection) => onEmailSelectionTextBoxRequest(selection.messageID, selection.quote) : undefined}
          onSelectionNodeRequest={onEmailSelectionNodeRequest ? (selection) => onEmailSelectionNodeRequest(selection.messageID, selection.quote) : undefined}
          messageAccents={{ [resolvedPreview.focusMessageID]: accent }}
        />
      )}
    </div>
  );
};
export const AttachedEmailOrganizerPane: React.FC<AttachedEmailOrganizerPaneProps> = ({ emails, nodeID = "", apiBase = "", companyID, currentUserID = "", companyUsers = [], attachmentRequestJSON, attachmentResourceType, attachmentResourceID, attachmentInformationID, attachmentEditorSurface, storageKey, tabbed = false, expandContent = false, editable, accent, surfaceText, strokeColor, ruleColor, selectedMessageID, focusMessageID, focusMessageRequestID = 0, activeEmailSelection = null, emailHighlightRemovalRequest = null, onSelectMessage, onClearSelectedMessage, onRemoveEmail, onEmailSelectionChatRequest, onEmailSelectionTextBoxRequest, onEmailSelectionNodeRequest, onEmailMessageTextBoxRequest, onEmailMessageActivate, messageAccents = {}, onReplyEditorFocus, emailFocusExpanded = false, onRequestEmailFocusToggle, onError }) => {
  const [layout, setLayout] = useState<AttachedEmailPaneLayout>(() => readStoredAttachedEmailPaneLayout(storageKey));
  const [draggingMessageID, setDraggingMessageID] = useState("");
  const [localSelectedMessageID, setLocalSelectedMessageID] = useState("");
  const [activeTabbedMessageID, setActiveTabbedMessageID] = useState("");
  const [replyComposer, setReplyComposer] = useState<{ rootMessageID: string; targetMessageID: string; replyAll: boolean } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ folderID: string; x: number; y: number } | null>(null);
  const [emailMenu, setEmailMenu] = useState<{ messageID: string; x: number; y: number } | null>(null);
  const [editingFolder, setEditingFolder] = useState<{ folderID: string; draft: string; isNew: boolean } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const emailMenuRef = useRef<HTMLDivElement | null>(null);
  const folderTitleInputRef = useRef<HTMLInputElement | null>(null);
  const uniqueEmails = useMemo(() => uniqueAttachedEmailsByMessageID(emails), [emails]);
  const normalizedLayout = useMemo(() => normalizeAttachedEmailPaneLayout(layout, uniqueEmails), [layout, uniqueEmails]);
  const emailByID = useMemo(() => new Map(uniqueEmails.map((email) => [email.messageID, email])), [uniqueEmails]);
  const orderedEmails = useMemo(() => normalizedLayout.emailOrder.map((id) => emailByID.get(id)).filter((email): email is EditorAttachedEmail => Boolean(email)), [emailByID, normalizedLayout.emailOrder]);
  const collapsedThreadIDs = useMemo(() => new Set(normalizedLayout.collapsedThreadIDs), [normalizedLayout.collapsedThreadIDs]);
  const activeSelectedMessageID = selectedMessageID?.trim() || localSelectedMessageID;
  const allThreadsCollapsed = uniqueEmails.length > 0 && uniqueEmails.every((email) => collapsedThreadIDs.has(email.messageID));
  const childFoldersByParentID = useMemo(() => {
    const groups = new Map<string, AttachedEmailFolderLayout[]>();
    for (const folder of normalizedLayout.folders) {
      const parentID = folder.parentID ?? "";
      const group = groups.get(parentID) ?? [];
      group.push(folder);
      groups.set(parentID, group);
    }
    return groups;
  }, [normalizedLayout.folders]);
  const emailsByFolderID = useMemo(() => {
    const groups = new Map<string, EditorAttachedEmail[]>();
    for (const email of orderedEmails) {
      const folderID = normalizedLayout.emailFolderByID[email.messageID] ?? "";
      const group = groups.get(folderID) ?? [];
      group.push(email);
      groups.set(folderID, group);
    }
    return groups;
  }, [normalizedLayout.emailFolderByID, orderedEmails]);
  const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
  const closeEmailMenu = useCallback(() => setEmailMenu(null), []);
  useAppFloatingMenuDismissal(Boolean(folderMenu), folderMenuRef, closeFolderMenu);
  useAppFloatingMenuDismissal(Boolean(emailMenu), emailMenuRef, closeEmailMenu);

  useEffect(() => {
    setLayout(readStoredAttachedEmailPaneLayout(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (replyComposer && !emailByID.has(replyComposer.rootMessageID)) setReplyComposer(null);
  }, [emailByID, replyComposer]);

  useEffect(() => {
    if (localSelectedMessageID && !emailByID.has(localSelectedMessageID)) setLocalSelectedMessageID("");
  }, [emailByID, localSelectedMessageID]);
  useEffect(() => {
    if (activeTabbedMessageID && emailByID.has(activeTabbedMessageID)) return;
    setActiveTabbedMessageID(orderedEmails[0]?.messageID ?? "");
  }, [activeTabbedMessageID, emailByID, orderedEmails]);

  useEffect(() => {
    writeStoredAttachedEmailPaneLayout(storageKey, normalizedLayout);
  }, [normalizedLayout, storageKey]);

  const updateLayout = useCallback((recipe: (current: AttachedEmailPaneLayout) => AttachedEmailPaneLayout) => {
    setLayout((current) => normalizeAttachedEmailPaneLayout(recipe(normalizeAttachedEmailPaneLayout(current, uniqueEmails)), uniqueEmails));
  }, [uniqueEmails]);

  const removeFolder = useCallback((folderID: string) => {
    const folder = normalizedLayout.folders.find((item) => item.id === folderID);
    if (!folder) return;
    updateLayout((current) => {
      const childFolders = new Map<string, AttachedEmailFolderLayout[]>();
      for (const item of current.folders) {
        const parentID = item.parentID ?? "";
        const group = childFolders.get(parentID) ?? [];
        group.push(item);
        childFolders.set(parentID, group);
      }
      const removedFolderIDs = new Set<string>();
      const stack = [folderID];
      while (stack.length > 0) {
        const currentID = stack.pop() ?? "";
        if (!currentID || removedFolderIDs.has(currentID)) continue;
        removedFolderIDs.add(currentID);
        for (const child of childFolders.get(currentID) ?? []) stack.push(child.id);
      }
      const parentID = current.folders.find((item) => item.id === folderID)?.parentID ?? "";
      const nextFolderByID = { ...current.emailFolderByID };
      for (const [emailID, emailFolderID] of Object.entries(nextFolderByID)) {
        if (!removedFolderIDs.has(emailFolderID)) continue;
        if (parentID) nextFolderByID[emailID] = parentID;
        else delete nextFolderByID[emailID];
      }
      return {
        ...current,
        folders: current.folders.filter((item) => !removedFolderIDs.has(item.id)),
        emailFolderByID: nextFolderByID,
      };
    });
  }, [normalizedLayout.folders, updateLayout]);

  const beginFolderTitleEdit = useCallback((folderID: string, draft: string, isNew = false) => {
    if (!editable) return;
    closeFolderMenu();
    setEditingFolder({ folderID, draft, isNew });
  }, [closeFolderMenu, editable]);

  const createFolder = useCallback((parentID = "") => {
    if (!editable) return;
    const folderID = createAttachedEmailFolderID();
    const folderName = `Email folder ${normalizedLayout.folders.length + 1}`;
    updateLayout((current) => ({
      ...current,
      folders: [
        ...current.folders.map((folder) => folder.id === parentID ? { ...folder, collapsed: false } : folder),
        { id: folderID, name: folderName, parentID: parentID || undefined, collapsed: false },
      ],
    }));
    beginFolderTitleEdit(folderID, folderName, true);
  }, [beginFolderTitleEdit, editable, normalizedLayout.folders.length, updateLayout]);

  const renameFolder = useCallback((folderID: string) => {
    if (!editable) return;
    const folder = normalizedLayout.folders.find((item) => item.id === folderID);
    if (!folder) return;
    beginFolderTitleEdit(folderID, folder.name);
  }, [beginFolderTitleEdit, editable, normalizedLayout.folders]);

  const commitFolderTitleEdit = useCallback(() => {
    if (!editingFolder) return;
    const cleanName = editingFolder.draft.trim();
    const folder = normalizedLayout.folders.find((item) => item.id === editingFolder.folderID);
    if (!folder) {
      setEditingFolder(null);
      return;
    }
    if (!cleanName) {
      if (editingFolder.isNew) removeFolder(editingFolder.folderID);
      setEditingFolder(null);
      return;
    }
    updateLayout((current) => ({
      ...current,
      folders: current.folders.map((item) => item.id === editingFolder.folderID ? { ...item, name: cleanName } : item),
    }));
    setEditingFolder(null);
  }, [editingFolder, normalizedLayout.folders, removeFolder, updateLayout]);

  const cancelFolderTitleEdit = useCallback(() => {
    if (editingFolder?.isNew) removeFolder(editingFolder.folderID);
    setEditingFolder(null);
  }, [editingFolder, removeFolder]);

  const deleteFolder = useCallback((folderID: string) => {
    if (!editable) return;
    if (editingFolder?.folderID === folderID) setEditingFolder(null);
    removeFolder(folderID);
  }, [editable, editingFolder?.folderID, removeFolder]);

  useEffect(() => {
    if (!editingFolder) return;
    const frame = window.requestAnimationFrame(() => {
      folderTitleInputRef.current?.focus();
      folderTitleInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingFolder?.folderID]);

  const moveEmail = useCallback((messageID: string, folderID: string, beforeMessageID = "") => {
    if (!editable || !messageID) return;
    updateLayout((current) => {
      const nextFolderByID = { ...current.emailFolderByID };
      if (folderID) nextFolderByID[messageID] = folderID;
      else delete nextFolderByID[messageID];
      const nextOrder = current.emailOrder.filter((id) => id !== messageID);
      let insertIndex = beforeMessageID ? nextOrder.indexOf(beforeMessageID) : -1;
      if (insertIndex < 0) {
        const folderEmailIDs = nextOrder.filter((id) => (nextFolderByID[id] ?? "") === folderID);
        const lastFolderEmailID = folderEmailIDs[folderEmailIDs.length - 1] ?? "";
        insertIndex = lastFolderEmailID ? nextOrder.indexOf(lastFolderEmailID) + 1 : nextOrder.length;
      }
      nextOrder.splice(insertIndex, 0, messageID);
      return { ...current, emailOrder: nextOrder, emailFolderByID: nextFolderByID };
    });
  }, [editable, updateLayout]);

  const dropMessageIDFromEvent = useCallback((event: React.DragEvent): string => (
    draggingMessageID || readAttachedEmailDragMessageID(event.dataTransfer)
  ), [draggingMessageID]);

  const canAcceptAttachedEmailDrop = useCallback((event: React.DragEvent): boolean => (
    editable && Boolean(draggingMessageID || hasAttachedEmailDragData(event.dataTransfer))
  ), [draggingMessageID, editable]);

  const toggleFolder = useCallback((folderID: string) => {
    updateLayout((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === folderID ? { ...folder, collapsed: !folder.collapsed } : folder) }));
  }, [updateLayout]);

  const toggleThread = useCallback((messageID: string) => {
    updateLayout((current) => {
      const collapsed = new Set(current.collapsedThreadIDs);
      if (collapsed.has(messageID)) collapsed.delete(messageID);
      else collapsed.add(messageID);
      return { ...current, collapsedThreadIDs: Array.from(collapsed) };
    });
  }, [updateLayout]);

  const expandAllThreads = useCallback(() => {
    updateLayout((current) => ({ ...current, collapsedThreadIDs: [] }));
  }, [updateLayout]);

  const selectMessage = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return;
    setLocalSelectedMessageID(cleanMessageID);
    onSelectMessage?.(cleanMessageID);
  }, [onSelectMessage]);

  const clearSelectedMessage = useCallback(() => {
    setLocalSelectedMessageID("");
    setReplyComposer(null);
    onClearSelectedMessage?.();
  }, [onClearSelectedMessage]);

  const collapseAllThreads = useCallback(() => {
    clearSelectedMessage();
    updateLayout((current) => ({ ...current, collapsedThreadIDs: uniqueEmails.map((email) => email.messageID) }));
  }, [clearSelectedMessage, uniqueEmails, updateLayout]);

  const removeEmailFromNode = useCallback((messageID: string) => {
    if (!editable || !onRemoveEmail) return;
    const email = emailByID.get(messageID);
    if (!email) return;
    closeEmailMenu();
    if (activeSelectedMessageID === messageID) clearSelectedMessage();
    setReplyComposer((current) => current?.rootMessageID === messageID ? null : current);
    onRemoveEmail(email.id);
  }, [activeSelectedMessageID, clearSelectedMessage, closeEmailMenu, editable, emailByID, onRemoveEmail]);

  const toggleSelectedMessage = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return;
    if (activeSelectedMessageID === cleanMessageID) {
      clearSelectedMessage();
      return;
    }
    selectMessage(cleanMessageID);
  }, [activeSelectedMessageID, clearSelectedMessage, selectMessage]);

  const renderEmailCard = (email: EditorAttachedEmail, folderID: string) => (
    <AttachedEmailThreadCard
      key={email.messageID}
      email={email}
      nodeID={nodeID}
      apiBase={apiBase}
		companyID={companyID}
		currentUserID={currentUserID}
      companyUsers={companyUsers}
      attachmentRequestJSON={attachmentRequestJSON}
      attachmentResourceType={attachmentResourceType}
      attachmentResourceID={attachmentResourceID}
      attachmentInformationID={attachmentInformationID}
      attachmentEditorSurface={attachmentEditorSurface}
      editable={editable}
      accent={accent}
      surfaceText={surfaceText}
      strokeColor={strokeColor}
      ruleColor={ruleColor}
      selected={tabbed || activeSelectedMessageID === email.messageID}
      collapsed={collapsedThreadIDs.has(email.messageID)}
      draggable={editable && !tabbed}
      replyTargetMessageID={replyComposer?.rootMessageID === email.messageID ? replyComposer.targetMessageID : ""}
      replyAll={replyComposer?.rootMessageID === email.messageID ? replyComposer.replyAll : false}
      activeSelection={activeEmailSelection}
      initialFocusMessageID={focusMessageID}
      initialFocusMessageRequestID={focusMessageRequestID}
      highlightRemovalRequest={emailHighlightRemovalRequest?.messageID === email.messageID ? emailHighlightRemovalRequest : null}
      onToggleCollapsed={() => {
        if (!collapsedThreadIDs.has(email.messageID) && activeSelectedMessageID === email.messageID) {
          clearSelectedMessage();
        }
        toggleThread(email.messageID);
      }}
      onSelect={() => toggleSelectedMessage(email.messageID)}
      onFocusMessageFound={selectMessage}
      onMessageActivate={onEmailMessageActivate}
      onReply={(targetMessageID, replyAll) => {
        selectMessage(email.messageID);
        setReplyComposer({ rootMessageID: email.messageID, targetMessageID, replyAll });
      }}
      onReplyComplete={() => {
        setReplyComposer((current) => current?.rootMessageID === email.messageID ? null : current);
      }}
      onReplyEditorFocus={onReplyEditorFocus}
      onError={onError}
      onContextMenu={tabbed ? undefined : (event, targetEmail) => setEmailMenu({ messageID: targetEmail.messageID, x: event.clientX, y: event.clientY })}
      onDragStart={(event) => {
        if (!editable || tabbed) return;
        setDraggingMessageID(email.messageID);
        writeAttachedEmailDragData(event.dataTransfer, email);
      }}
      onDragEnd={() => {
        setDraggingMessageID("");
      }}
      onDropOnEmail={(event) => {
        const droppedMessageID = dropMessageIDFromEvent(event);
        if (!droppedMessageID || droppedMessageID === email.messageID) return;
        event.preventDefault();
        event.stopPropagation();
        moveEmail(droppedMessageID, folderID, email.messageID);
        setDraggingMessageID("");
      }}
      onSelectionChatRequest={onEmailSelectionChatRequest}
      onSelectionTextBoxRequest={onEmailSelectionTextBoxRequest}
      onSelectionNodeRequest={onEmailSelectionNodeRequest}
      onMessageTextBoxRequest={onEmailMessageTextBoxRequest}
      messageAccents={messageAccents}
    />
  );

  const renderEmailCards = (folderID: string) => (emailsByFolderID.get(folderID) ?? []).map((email) => renderEmailCard(email, folderID));
  const renderFolder = (folder: AttachedEmailFolderLayout, depth = 0): React.ReactNode => {
    const childFolders = childFoldersByParentID.get(folder.id) ?? [];
    const directEmails = emailsByFolderID.get(folder.id) ?? [];
    const hasContent = childFolders.length > 0 || directEmails.length > 0;
    const nested = depth > 0;
    return (
      <div
        key={folder.id}
        onDragOver={(event) => {
          if (!canAcceptAttachedEmailDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          const droppedMessageID = dropMessageIDFromEvent(event);
          if (!droppedMessageID) return;
          event.preventDefault();
          event.stopPropagation();
          moveEmail(droppedMessageID, folder.id);
          setDraggingMessageID("");
        }}
        style={{
          minWidth: 0,
          display: "grid",
          gap: folder.collapsed ? 0 : 8,
          border: "1px solid transparent",
          borderRadius: 13,
          background: `${nested ? "rgba(255,255,255,0.76)" : EDITOR_NEU_PANEL_BACKGROUND} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
          boxShadow: nested ? "2px 2px 8px rgba(174,174,192,0.13), -2px -2px 8px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.8)" : EDITOR_NEU_SHADOW,
          padding: 8,
        }}
      >
        <div
          onContextMenu={(event) => {
            if (!editable) return;
            event.preventDefault();
            event.stopPropagation();
            setFolderMenu({ folderID: folder.id, x: event.clientX, y: event.clientY });
          }}
          style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, minHeight: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_SURFACE, padding: "4px 7px", color: surfaceText, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)" }}
        >
          <FolderIcon color={accent} />
          {editingFolder?.folderID === folder.id ? (
            <input
              ref={folderTitleInputRef}
              value={editingFolder.draft}
              onChange={(event) => {
                const nextDraft = event.currentTarget.value;
                setEditingFolder((current) => current?.folderID === folder.id ? { ...current, draft: nextDraft } : current);
              }}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={commitFolderTitleEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitFolderTitleEdit();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelFolderTitleEdit();
                }
              }}
              style={{ minWidth: 0, flex: "1 1 auto", height: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 6px", fontSize: 11.5, fontWeight: 950, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.14)" }}
            />
          ) : (
            <span
              onDoubleClick={(event) => {
                event.stopPropagation();
                renameFolder(folder.id);
              }}
              style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 950 }}
            >
              {folder.name}
            </span>
          )}
          {editable && (
            <button type="button" title="Create nested folder" onClick={(event) => { event.stopPropagation(); createFolder(folder.id); }} style={{ width: 24, height: 23, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0, boxShadow: "1px 1px 5px rgba(174,174,192,0.14), -1px -1px 5px rgba(255,255,255,0.78)" }}>
              <FolderPlusIcon color={accent} />
            </button>
          )}
          {hasContent && (
            <button type="button" title={folder.collapsed ? "Expand folder" : "Collapse folder"} onClick={() => toggleFolder(folder.id)} style={{ width: 22, height: 22, border: `1px solid ${strokeColor}`, borderRadius: 7, background: EDITOR_NEU_ACTIVE_SURFACE, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
              <TinyDisclosureIcon open={!folder.collapsed} color={accent} />
            </button>
          )}
        </div>
        {!folder.collapsed && (
          <div style={{ minWidth: 0, display: "grid", gap: 8, marginLeft: 12, paddingLeft: 11, paddingBottom: 2, borderLeft: `2px solid ${ruleColor}` }}>
            {childFolders.map((childFolder) => renderFolder(childFolder, depth + 1))}
            {renderEmailCards(folder.id)}
            {!hasContent && (
              <div style={{ minWidth: 0, minHeight: 34, display: "grid", placeItems: "center", border: `1px dashed ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, color: "rgba(100,116,139,0.68)", fontSize: 10.5, fontWeight: 850, background: "rgba(255,255,255,0.5)" }}>
                Drop emails here
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderUnfiledGroup = () => {
    const unfiledEmails = emailsByFolderID.get("") ?? [];
    if (normalizedLayout.folders.length === 0) {
      return (
        <div data-node-email-thread-list="true" style={{ minWidth: 0, display: "grid", alignContent: "start", gap: 8 }}>
          {renderEmailCards("")}
        </div>
      );
    }
    const label = "Unfiled emails";
    return (
      <div
        key="unfiled"
        onDragOver={(event) => {
          if (!canAcceptAttachedEmailDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          const droppedMessageID = dropMessageIDFromEvent(event);
          if (!droppedMessageID) return;
          event.preventDefault();
          event.stopPropagation();
          moveEmail(droppedMessageID, "");
          setDraggingMessageID("");
        }}
        style={{ minWidth: 0, display: "grid", gap: 8, border: "1px solid transparent", borderRadius: 13, background: `${EDITOR_NEU_PANEL_BACKGROUND} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`, boxShadow: EDITOR_NEU_SHADOW, padding: 8 }}
      >
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, minHeight: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_SURFACE, padding: "4px 7px", color: surfaceText, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)" }}>
          <MailIcon color={accent} />
          <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 950 }}>{label}</span>
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: 8, padding: "0 1px 1px" }}>
          {renderEmailCards("")}
          {unfiledEmails.length === 0 && (
            <div style={{ minWidth: 0, minHeight: 34, display: "grid", placeItems: "center", border: `1px dashed ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, color: "rgba(100,116,139,0.68)", fontSize: 10.5, fontWeight: 850, background: "rgba(255,255,255,0.5)" }}>
              Drop emails here
            </div>
          )}
        </div>
      </div>
    );
  };

  if (tabbed) {
    const activeEmail = emailByID.get(activeTabbedMessageID) ?? orderedEmails[0] ?? null;
    const activeFolderID = activeEmail ? normalizedLayout.emailFolderByID[activeEmail.messageID] ?? "" : "";
    return (
      <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", color: surfaceText, overflow: "hidden" }}>
        <div style={{ minHeight: 34, display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${ruleColor}`, padding: "5px 7px", color: surfaceText, fontSize: 11, fontWeight: 900, background: "linear-gradient(90deg, rgba(255,241,242,0.60), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.62))" }}>
          <MailIcon color={accent} />
          <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Email thread{orderedEmails.length === 1 ? "" : "s"}</span>
          <span style={{ opacity: 0.62 }}>{orderedEmails.length}</span>
        </div>
        <div className="mango-editor-header-scroll" role="tablist" aria-label="Attached email threads" style={{ minWidth: 0, display: "flex", gap: 4, overflowX: "auto", borderBottom: `1px solid ${ruleColor}`, padding: "5px 6px 0", background: "rgba(248,250,252,0.86)" }}>
          {orderedEmails.map((email) => {
            const active = email.messageID === activeEmail?.messageID;
            return (
              <div key={email.messageID} style={{ minWidth: 0, maxWidth: 220, display: "flex", alignItems: "center", border: `1px solid ${active ? accent : EDITOR_NEU_SOFT_BORDER}`, borderBottomColor: active ? EDITOR_NEU_PANEL_BACKGROUND : EDITOR_NEU_SOFT_BORDER, borderRadius: "9px 9px 0 0", background: active ? EDITOR_NEU_PANEL_BACKGROUND : EDITOR_NEU_SURFACE, marginBottom: -1, boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.9)" : "none" }}>
                <button type="button" role="tab" aria-selected={active} title={email.subject} onClick={() => { setActiveTabbedMessageID(email.messageID); selectMessage(email.messageID); }} style={{ minWidth: 0, flex: "1 1 auto", height: 30, border: 0, background: "transparent", color: surfaceText, cursor: "pointer", padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", fontSize: 10.5, fontWeight: active ? 950 : 800 }}>
                  {email.subject || "(no subject)"}
                </button>
                {editable && onRemoveEmail && (
                  <button type="button" title="Remove email from node" onClick={() => removeEmailFromNode(email.messageID)} style={{ width: 24, height: 24, border: 0, background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ minHeight: 0, overflow: "auto", padding: 7, background: EDITOR_NEU_PANEL_BACKGROUND }}>
          {activeEmail ? renderEmailCard(activeEmail, activeFolderID) : (
            <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontSize: 11 }}>No attached email</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={{ height: expandContent ? "auto" : "100%", minHeight: 0, display: "grid", gridTemplateRows: expandContent ? "auto auto" : "auto minmax(0, 1fr)", color: surfaceText, overflow: expandContent ? "visible" : "hidden" }}>
      <div style={{ minHeight: 34, display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${ruleColor}`, padding: "5px 7px", color: surfaceText, fontSize: 11, fontWeight: 900, background: "linear-gradient(90deg, rgba(255,241,242,0.60), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.62))" }}>
        <MailIcon color={accent} />
        <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Email</span>
        {onRequestEmailFocusToggle && (
          <button
            type="button"
            title={emailFocusExpanded ? "Restore email layout" : "Expand email column"}
            aria-label={emailFocusExpanded ? "Restore email layout" : "Expand email column"}
            aria-expanded={emailFocusExpanded}
            onClick={onRequestEmailFocusToggle}
            data-node-email-focus-toggle="true"
            style={{ width: 26, height: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0, fontSize: 16, fontWeight: 950, lineHeight: 1, boxShadow: EDITOR_NEU_SHADOW }}
          >
            <span aria-hidden="true">{emailFocusExpanded ? "←" : "→"}</span>
          </button>
        )}
        {uniqueEmails.length > 0 && (
          <button
            type="button"
            aria-expanded={!allThreadsCollapsed}
            onClick={allThreadsCollapsed ? expandAllThreads : collapseAllThreads}
            style={{ minHeight: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, cursor: "pointer", padding: "2px 8px", font: "inherit", fontSize: 10.5, fontWeight: 850, letterSpacing: 0, boxShadow: EDITOR_NEU_SHADOW }}
          >
            {allThreadsCollapsed ? "Expand all threads" : "Collapse all threads"}
          </button>
        )}
        {editable && (
          <button type="button" title="Create email folder" onClick={() => createFolder("")} style={{ width: 26, height: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0, boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}>
            <FolderPlusIcon color={accent} />
          </button>
        )}
      </div>
      {folderMenu && (
        <div
          ref={folderMenuRef}
          role="menu"
          aria-label="Email folder actions"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            zIndex: 120,
            top: folderMenu.y,
            left: folderMenu.x,
            minWidth: 132,
            display: "grid",
            gap: 4,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 11,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 5,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const folderID = folderMenu.folderID;
              closeFolderMenu();
              renameFolder(folderID);
            }}
            style={{ minHeight: 28, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: surfaceText, cursor: "pointer", padding: "4px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const folderID = folderMenu.folderID;
              closeFolderMenu();
              deleteFolder(folderID);
            }}
            style={{ minHeight: 28, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "#dc2626", cursor: "pointer", padding: "4px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Delete
          </button>
        </div>
      )}
      {emailMenu && onRemoveEmail && (
        <div
          ref={emailMenuRef}
          role="menu"
          aria-label="Email actions"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            zIndex: 120,
            top: emailMenu.y,
            left: emailMenu.x,
            minWidth: 162,
            display: "grid",
            gap: 4,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 11,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 5,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => removeEmailFromNode(emailMenu.messageID)}
            style={{ minHeight: 28, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "#dc2626", cursor: "pointer", padding: "4px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Remove from node
          </button>
        </div>
      )}
      <div className="editor-document-scroll" style={{ minHeight: 0, overflowY: expandContent ? "visible" : "auto", overflowX: "hidden", display: "grid", alignContent: "start", gap: 10, padding: 9, ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
        {uniqueEmails.length === 0 ? (
          <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 14, color: surfaceText }}>
            <div style={{ display: "grid", justifyItems: "center", gap: 9, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 13, background: EDITOR_NEU_SURFACE, padding: 14, boxShadow: EDITOR_NEU_SHADOW }}>
              <MailIcon color={accent} />
              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(100,116,139,0.86)" }}>No emails attached</div>
            </div>
          </div>
        ) : (
          <>
            {(childFoldersByParentID.get("") ?? []).map((folder) => renderFolder(folder))}
            {renderUnfiledGroup()}
          </>
        )}
      </div>
    </div>
  );
};

type EmailConversationPaneProps = {
  messageID: string;
  collaborationID?: string;
  nodeID?: string;
  emailThreadID?: string;
  apiBase?: string;
	companyID: string;
	currentUserID?: string;
  companyUsers?: MentionableCompanyUser[];
  sharedInboxID?: string;
  accountEmail?: string;
  attachmentRequestJSON?: AttachmentRequestJSON;
  attachmentResourceType?: MangoAttachmentResourceType;
  attachmentResourceID?: string;
  attachmentInformationID?: string;
  attachmentEditorSurface?: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  activeSelection?: EmailActiveSelection | null;
  highlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  initialReplyTargetMessageID?: string;
  initialFocusMessageID?: string;
  initialFocusMessageRequestID?: number;
  initialReplyAll?: boolean;
  inlineExpansion?: boolean;
  singleMessageOnly?: boolean;
  onReplyComplete?: () => void;
  onReplyEditorFocus?: () => void;
  onError: (message: string) => void;
  onSelectionChatRequest?: (selection: EmailSelectionDraft) => void;
  onSelectionTextBoxRequest?: (selection: EmailSelectionDraft) => void;
  onSelectionNodeRequest?: (selection: EmailSelectionDraft) => void;
  onMessageTextBoxRequest?: (messageID: string) => void;
  onMessageActivate?: (messageID: string) => void;
  messageAccents?: Record<string, string>;
};

type EmailSelectionDraft = {
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
};

type EmailFrameSelection = Pick<EmailSelectionDraft, "quote" | "startOffset" | "endOffset"> & {
  clientLeft: number;
  clientTop: number;
  clientRight: number;
  clientBottom: number;
};

type EmailLocalHighlight = EmailBodyHighlightRange;

type EmailLocalHighlightsByMessageID = Record<string, EmailLocalHighlight[]>;

export type EmailHighlightSelection = {
  quote: string;
  startOffset: number;
  endOffset: number;
};

type EmailActiveSelection = {
  messageID?: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

export type EmailHighlightRemovalRequest = {
  requestID: number;
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

const EMAIL_LOCAL_HIGHLIGHTS_STORAGE_PREFIX = "node-editor-email-local-highlights-v1";
const EMAIL_BODY_MESSAGE_ID_ATTRIBUTE = "data-mango-email-body-message-id";
const EMAIL_SELECTION_ACTION_BUTTON_SIZE = 28;
const EMAIL_SELECTION_ACTION_GAP = 5;
const EMAIL_SELECTION_ACTION_PADDING = 4;
const EMAIL_SELECTION_ACTION_BORDER = 1;
const EMAIL_SELECTION_ACTION_OFFSET = 8;
const EMAIL_THREAD_MESSAGE_BATCH_SIZE = 12;

type EmailBodyImageSelection = {
  src: string;
  filename: string;
};

function emailAttachmentFilename(attachment: EmailAttachment): string {
  return attachment.filename?.trim() || "attachment";
}

function emailAttachmentContentType(attachment: EmailAttachment): string {
  return attachment.content_type?.trim() || "application/octet-stream";
}

function emailAttachmentIsCalendarInvite(attachment: EmailAttachment): boolean {
  return (emailAttachmentContentType(attachment).toLowerCase().split(";", 1)[0] ?? "").trim() === "text/calendar"
    || emailAttachmentFilename(attachment).toLowerCase().endsWith(".ics");
}

function emailAttachmentDataURL(attachment: EmailAttachment): string {
  const content = attachment.content?.trim() ?? "";
  return content ? `data:${emailAttachmentContentType(attachment)};base64,${content}` : "";
}

function emailAttachmentContentIDKeys(attachment: EmailAttachment): string[] {
  const keys = [attachment.content_id, attachment.filename]
    .map((value) => value?.trim().replace(/^cid:/i, "").replace(/^<|>$/g, "") ?? "")
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteEmailCIDImages(documentHTML: string, sources: Array<{ attachment: EmailAttachment; sourceURL: string }>): string {
  let next = documentHTML;
  for (const item of sources) {
    if (!item.sourceURL) continue;
    for (const key of emailAttachmentContentIDKeys(item.attachment)) {
      next = next.replace(new RegExp(`cid:${escapeRegularExpression(key)}`, "gi"), item.sourceURL);
    }
  }
  return next;
}

function triggerEmailBodyImageDownload(image: EmailBodyImageSelection): void {
  if (typeof document === "undefined" || !image.src) return;
  const anchor = document.createElement("a");
  anchor.href = image.src;
  anchor.download = image.filename || "email-image";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

const EmailBodyFrame: React.FC<{
  message: EmailMessage;
  body: string;
  apiBase: string;
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  collaborationID?: string;
  compact: boolean;
  strokeColor: string;
  accent: string;
  highlights?: readonly EmailLocalHighlight[];
  activeSelection?: EmailActiveSelection | null;
  onSelectionChange?: (selection: EmailFrameSelection | null) => void;
}> = ({ message, body, apiBase, companyID, sharedInboxID, accountEmail, collaborationID, compact, strokeColor, accent, highlights = [], activeSelection = null, onSelectionChange }) => {
  const attachments = useMemo(() => message.attachments ?? [], [message.attachments]);
  const [srcDoc, setSrcDoc] = useState(() => messageDocument(body, compact));
  const [height, setHeight] = useState(compact ? 96 : 420);
  const [selectedImage, setSelectedImage] = useState<EmailBodyImageSelection | null>(null);
  const [previewImage, setPreviewImage] = useState<EmailBodyImageSelection | null>(null);
  const frameCleanupRef = useRef<() => void>(() => undefined);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const filenameBySourceRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const objectURLs: string[] = [];
    setSelectedImage(null);
    setPreviewImage(null);
    setSrcDoc(messageDocument(body, compact));
    filenameBySourceRef.current = {};
    const inlineAttachments = attachments.filter((attachment) => (
      attachment.is_inline
      || Boolean(attachment.content_id?.trim())
      || emailAttachmentContentIDKeys(attachment).some((key) => body.toLowerCase().includes(`cid:${key.toLowerCase()}`))
    ));
    if (inlineAttachments.length === 0) return undefined;
    const controller = new AbortController();
    void Promise.all(inlineAttachments.map(async (attachment) => {
      const inlineURL = emailAttachmentDataURL(attachment);
      if (inlineURL) return { attachment, sourceURL: inlineURL };
      const mangoAttachmentID = attachment.attachment_id?.trim() ?? "";
      const providerAttachmentID = attachment.id?.trim() ?? "";
      try {
        const sourceURL = mangoAttachmentID
          ? await loadMangoAttachmentObjectURL(apiBase, companyID, mangoAttachmentID, "display", { signal: controller.signal })
          : providerAttachmentID
            ? URL.createObjectURL(await downloadEmailAttachment(message.id, providerAttachmentID, companyID, sharedInboxID, { signal: controller.signal, accountEmail, collaborationID }))
            : "";
        if (cancelled) {
          if (sourceURL.startsWith("blob:")) URL.revokeObjectURL(sourceURL);
          return { attachment, sourceURL: "" };
        }
        if (sourceURL.startsWith("blob:")) objectURLs.push(sourceURL);
        return { attachment, sourceURL };
      } catch {
        return { attachment, sourceURL: "" };
      }
    })).then((sources) => {
      if (cancelled) return;
      filenameBySourceRef.current = Object.fromEntries(sources.filter((item) => item.sourceURL).map((item) => [item.sourceURL, emailAttachmentFilename(item.attachment)]));
      setSrcDoc(rewriteEmailCIDImages(messageDocument(body, compact), sources));
    });
    return () => {
      cancelled = true;
      controller.abort();
      objectURLs.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [accountEmail, apiBase, attachments, body, collaborationID, compact, companyID, message.id, sharedInboxID]);

  useEffect(() => () => frameCleanupRef.current(), []);

  useEffect(() => {
    applyEmailBodyHighlights(iframeRef.current?.contentDocument, highlights, activeSelection);
  }, [activeSelection, highlights]);

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    frameCleanupRef.current();
    frameCleanupRef.current = () => undefined;
    const frame = event.currentTarget;
    const frameDocument = frame.contentDocument;
    if (!frameDocument?.body || !frameDocument.documentElement) return;
    applyEmailBodyHighlights(frameDocument, highlights, activeSelection);
    const resize = () => {
      const measured = Math.max(frameDocument.body.scrollHeight, frameDocument.documentElement.scrollHeight);
      setHeight(Math.max(compact ? 64 : 190, measured + 4));
    };
    const imageCleanups: Array<() => void> = [];
    Array.from(frameDocument.images).forEach((image, index) => {
      image.style.cursor = "zoom-in";
      const select = (mouseEvent: MouseEvent) => {
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        Array.from(frameDocument.images).forEach((candidate) => { candidate.style.outline = ""; });
        image.style.outline = `2px solid ${accent}`;
        image.style.outlineOffset = "2px";
        const src = image.currentSrc || image.src;
        setSelectedImage({ src, filename: filenameBySourceRef.current[src] || image.alt?.trim() || `email-image-${index + 1}` });
      };
      const preview = (mouseEvent: MouseEvent) => {
        select(mouseEvent);
        const src = image.currentSrc || image.src;
        setPreviewImage({ src, filename: filenameBySourceRef.current[src] || image.alt?.trim() || `email-image-${index + 1}` });
      };
      image.addEventListener("click", select);
      image.addEventListener("dblclick", preview);
      image.addEventListener("load", resize);
      image.addEventListener("error", resize);
      imageCleanups.push(() => {
        image.removeEventListener("click", select);
        image.removeEventListener("dblclick", preview);
        image.removeEventListener("load", resize);
        image.removeEventListener("error", resize);
      });
    });
    const publishSelection = () => {
      if (!onSelectionChange) return;
      const selection = frameDocument.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        onSelectionChange(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!frameDocument.body.contains(range.startContainer) || !frameDocument.body.contains(range.endContainer)) {
        onSelectionChange(null);
        return;
      }
      const rawQuote = range.toString();
      const quote = rawQuote.trim();
      if (!quote) {
        onSelectionChange(null);
        return;
      }
      const leadingTrim = rawQuote.length - rawQuote.trimStart().length;
      const beforeRange = frameDocument.createRange();
      beforeRange.selectNodeContents(frameDocument.body);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = beforeRange.toString().length + leadingTrim;
      const endOffset = startOffset + quote.length;
      const rangeRect = range.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      onSelectionChange({
        quote,
        startOffset,
        endOffset,
        clientLeft: frameRect.left + rangeRect.left,
        clientTop: frameRect.top + rangeRect.top,
        clientRight: frameRect.left + rangeRect.right,
        clientBottom: frameRect.top + rangeRect.bottom,
      });
    };
    frameDocument.addEventListener("mouseup", publishSelection);
    frameDocument.addEventListener("keyup", publishSelection);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(frameDocument.body);
    resize();
    frameCleanupRef.current = () => {
      observer?.disconnect();
      frameDocument.removeEventListener("mouseup", publishSelection);
      frameDocument.removeEventListener("keyup", publishSelection);
      imageCleanups.forEach((cleanup) => cleanup());
    };
  }, [accent, activeSelection, compact, highlights, onSelectionChange]);

  return (
    <>
      <div style={{ position: "relative", minWidth: 0 }}>
        {selectedImage && (
          <button
            type="button"
            title={`Download ${selectedImage.filename}`}
            onClick={() => triggerEmailBodyImageDownload(selectedImage)}
            style={{ position: "absolute", zIndex: 3, top: 8, right: 8, minHeight: 30, display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, cursor: "pointer", padding: "4px 9px", fontSize: 10.5, fontWeight: 850, boxShadow: EDITOR_NEU_SHADOW }}
          >
            <DownloadIcon color={accent} />
            Download image
          </button>
        )}
        <iframe
          ref={iframeRef}
          title={`Email body ${message.id}`}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          onLoad={handleLoad}
          style={{ width: "100%", height, border: compact ? 0 : `1px solid ${strokeColor}`, borderRadius: compact ? 0 : 8, background: "#ffffff", boxSizing: "border-box" }}
        />
      </div>
      {previewImage && (
        <AppModalPortal onRequestClose={() => setPreviewImage(null)}>
        <div role="dialog" aria-modal="true" aria-label="Email image preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewImage(null); }} style={{ position: "fixed", zIndex: 1, inset: 0, display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", placeItems: "center", background: "rgba(15,23,42,0.82)", padding: 18 }}>
          <img src={previewImage.src} alt={previewImage.filename} style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100vh - 90px)", objectFit: "contain" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10 }}>
            <button type="button" onClick={() => triggerEmailBodyImageDownload(previewImage)} style={{ minHeight: 34, display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid rgba(255,255,255,0.52)", borderRadius: 8, background: "rgba(255,255,255,0.94)", color: "#0f172a", cursor: "pointer", padding: "5px 11px", fontSize: 11.5, fontWeight: 850 }}>
              <DownloadIcon color="#0f172a" />
              Download
            </button>
            <button type="button" onClick={() => setPreviewImage(null)} style={{ minHeight: 34, border: "1px solid rgba(255,255,255,0.52)", borderRadius: 8, background: "rgba(255,255,255,0.94)", color: "#0f172a", cursor: "pointer", padding: "5px 11px", fontSize: 11.5, fontWeight: 850 }}>Close</button>
          </div>
        </div>
        </AppModalPortal>
      )}
    </>
  );
};

const EmailMessageAttachments: React.FC<{
  message: EmailMessage;
  apiBase: string;
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  collaborationID?: string;
  respondable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  onError: (message: string) => void;
}> = ({ message, apiBase, companyID, sharedInboxID, accountEmail, collaborationID, respondable, accent, surfaceText, strokeColor, onError }) => {
  const allAttachments = message.attachments ?? [];
  const attachments = visibleEmailAttachmentsForBody(message.body || message.snippet || "", allAttachments);
  const hasCalendarInvite = allAttachments.some(emailAttachmentIsCalendarInvite);
  const [previewAttachment, setPreviewAttachment] = useState<EmailAttachment | null>(null);
  const [previewURL, setPreviewURL] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadAttachmentURL = useCallback(async (attachment: EmailAttachment, variant: "display" | "original") => {
    const inlineURL = emailAttachmentDataURL(attachment);
    if (inlineURL) return { url: inlineURL, revoke: false };
    const mangoAttachmentID = attachment.attachment_id?.trim() ?? "";
    if (mangoAttachmentID) {
      return { url: await loadMangoAttachmentObjectURL(apiBase, companyID, mangoAttachmentID, variant), revoke: true };
    }
    const providerAttachmentID = attachment.id?.trim() ?? "";
    if (!providerAttachmentID) throw new Error("attachment_unavailable");
    return { url: URL.createObjectURL(await downloadEmailAttachment(message.id, providerAttachmentID, companyID, sharedInboxID, { accountEmail, collaborationID })), revoke: true };
  }, [accountEmail, apiBase, collaborationID, companyID, message.id, sharedInboxID]);

  const downloadAttachment = useCallback(async (attachment: EmailAttachment) => {
    const filename = emailAttachmentFilename(attachment);
    const mangoAttachmentID = attachment.attachment_id?.trim() ?? "";
    try {
      if (mangoAttachmentID) {
        await downloadMangoAttachment({ apiBase, companyID, attachmentID: mangoAttachmentID, filename, variant: "original" });
        return;
      }
      const loaded = await loadAttachmentURL(attachment, "original");
      triggerEmailBodyImageDownload({ src: loaded.url, filename });
      if (loaded.revoke) window.setTimeout(() => URL.revokeObjectURL(loaded.url), 1000);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_download_attachment");
    }
  }, [apiBase, companyID, loadAttachmentURL, onError]);

  useEffect(() => {
    if (!previewAttachment) {
      setPreviewURL("");
      setPreviewLoading(false);
      return undefined;
    }
    let cancelled = false;
    let revokeURL = false;
    let loadedURL = "";
    setPreviewURL("");
    setPreviewLoading(true);
    void loadAttachmentURL(previewAttachment, "display")
      .then((loaded) => {
        if (cancelled) {
          if (loaded.revoke) URL.revokeObjectURL(loaded.url);
          return;
        }
        loadedURL = loaded.url;
        revokeURL = loaded.revoke;
        setPreviewURL(loaded.url);
      })
      .catch((cause) => {
        if (!cancelled) {
          onError(cause instanceof Error ? cause.message : "failed_to_preview_attachment");
          setPreviewAttachment(null);
        }
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => {
      cancelled = true;
      if (revokeURL && loadedURL) URL.revokeObjectURL(loadedURL);
    };
  }, [loadAttachmentURL, onError, previewAttachment]);

  if (attachments.length === 0 && !hasCalendarInvite) return null;
  return (
    <>
      <div style={{ minWidth: 0, display: "grid", gap: 6, marginTop: 6, paddingTop: 7, borderTop: `1px solid ${strokeColor}` }}>
        <div style={{ color: "rgba(71,85,105,0.82)", fontSize: 10.5, fontWeight: 850 }}>
          {attachments.length === 1 ? "1 attachment" : `${attachments.length} attachments`}
        </div>
        {hasCalendarInvite && (
          <CalendarInviteCard
            messageID={message.id}
            companyID={companyID}
            sharedInboxID={sharedInboxID}
            accountEmail={accountEmail}
            disabled={!respondable}
            compact
            accent={accent}
            onError={onError}
          />
        )}
        <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 7 }}>
          {attachments.map((attachment, index) => {
            const filename = emailAttachmentFilename(attachment);
            const contentType = emailAttachmentContentType(attachment);
            const presentationKind = classifyAttachmentPresentation({ filename, mimeType: contentType });
            const image = presentationKind === "image";
            const sizeLabel = typeof attachment.size === "number" && Number.isFinite(attachment.size) && attachment.size >= 0
              ? formatFileSize(attachment.size)
              : "Size unavailable";
            return (
              <div
                key={attachment.id?.trim() || attachment.attachment_id?.trim() || `${filename}:${index}`}
                role={image ? "button" : undefined}
                tabIndex={image ? 0 : undefined}
                title={image ? `Double-click to preview ${filename}` : filename}
                onDoubleClick={() => { if (image) setPreviewAttachment(attachment); }}
                onKeyDown={(event) => { if (image && event.key === "Enter") setPreviewAttachment(attachment); }}
                style={{ minWidth: 0, display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) 30px", alignItems: "center", gap: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: "#ffffff", color: surfaceText, padding: "6px 7px", cursor: image ? "zoom-in" : "default", boxShadow: "2px 2px 7px rgba(174,174,192,0.14), -2px -2px 7px rgba(255,255,255,0.76)" }}
              >
                {attachment.attachment_id?.trim() && image ? (
                  <AuthenticatedAttachmentThumbnail apiBase={apiBase} companyID={companyID} attachmentID={attachment.attachment_id.trim()} />
                ) : (
                  <AttachmentTypeVisual kind={presentationKind} />
                )}
                <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
                  <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.8 }}>{filename}</strong>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.76)", fontSize: 9.5, fontWeight: 700 }} title={`${contentType} - ${sizeLabel}`}>{contentType} · {sizeLabel}</span>
                </span>
                <button type="button" title={`Download ${filename}`} aria-label={`Download ${filename}`} onClick={(event) => { event.stopPropagation(); void downloadAttachment(attachment); }} style={{ width: 28, height: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
                  <DownloadIcon color={accent} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {previewAttachment && (
        <AppModalPortal onRequestClose={() => setPreviewAttachment(null)}>
        <div role="dialog" aria-modal="true" aria-label="Email attachment image preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewAttachment(null); }} style={{ position: "fixed", zIndex: 1, inset: 0, display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", placeItems: "center", background: "rgba(15,23,42,0.82)", padding: 18 }}>
          {previewLoading ? <div style={{ color: "#ffffff", fontSize: 12, fontWeight: 850 }}>Loading image</div> : <img src={previewURL} alt={emailAttachmentFilename(previewAttachment)} style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100vh - 90px)", objectFit: "contain" }} />}
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10 }}>
            <button type="button" onClick={() => { void downloadAttachment(previewAttachment); }} style={{ minHeight: 34, display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid rgba(255,255,255,0.52)", borderRadius: 8, background: "rgba(255,255,255,0.94)", color: "#0f172a", cursor: "pointer", padding: "5px 11px", fontSize: 11.5, fontWeight: 850 }}><DownloadIcon color="#0f172a" />Download</button>
            <button type="button" onClick={() => setPreviewAttachment(null)} style={{ minHeight: 34, border: "1px solid rgba(255,255,255,0.52)", borderRadius: 8, background: "rgba(255,255,255,0.94)", color: "#0f172a", cursor: "pointer", padding: "5px 11px", fontSize: 11.5, fontWeight: 850 }}>Close</button>
          </div>
        </div>
        </AppModalPortal>
      )}
    </>
  );
};

function emailSelectionActionToolbarWidth(actionCount: number): number {
  return (actionCount * EMAIL_SELECTION_ACTION_BUTTON_SIZE)
    + (Math.max(0, actionCount - 1) * EMAIL_SELECTION_ACTION_GAP)
    + (EMAIL_SELECTION_ACTION_PADDING * 2)
    + (EMAIL_SELECTION_ACTION_BORDER * 2);
}

function clampEmailSelectionActionPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

const emailSelectionActionButtonStyle: React.CSSProperties = {
  width: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  height: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  minWidth: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  minHeight: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  flex: `0 0 ${EMAIL_SELECTION_ACTION_BUTTON_SIZE}px`,
  borderRadius: 8,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  background: EDITOR_NEU_SURFACE,
  color: "inherit",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
  lineHeight: 0,
  boxSizing: "border-box",
  boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)",
};

const EmailSelectionActionIconFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span aria-hidden="true" style={{ width: 16, height: 16, display: "grid", placeItems: "center", lineHeight: 0 }}>
    {children}
  </span>
);

const EmailSelectionCreateNodeIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
    <rect x="2.7" y="2.7" width="10.6" height="10.6" rx="2.2" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="M8 5.2v5.6M5.2 8h5.6" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" />
  </svg>
);

function emailLocalHighlightsStorageKey(messageID: string): string {
  return `${EMAIL_LOCAL_HIGHLIGHTS_STORAGE_PREFIX}:${messageID}`;
}

function readStoredEmailLocalHighlights(messageID: string): EmailLocalHighlight[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(emailLocalHighlightsStorageKey(messageID)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): EmailLocalHighlight | null => {
        if (!item || typeof item !== "object") return null;
        const quote = typeof item.quote === "string" ? item.quote : "";
        const startOffset = Number(item.startOffset);
        const endOffset = Number(item.endOffset);
        const id = typeof item.id === "string" && item.id.trim() ? item.id : `${startOffset}:${endOffset}:${quote}`;
        if (!quote || !Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) return null;
        return { id, quote, startOffset, endOffset };
      })
      .filter((item): item is EmailLocalHighlight => Boolean(item));
  } catch {
    return [];
  }
}

function storeEmailLocalHighlights(messageID: string, highlights: EmailLocalHighlight[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(emailLocalHighlightsStorageKey(messageID), JSON.stringify(highlights.slice(-80)));
}

function emailLocalHighlightMatchesSelection(highlight: EmailLocalHighlight, selection: EmailHighlightSelection): boolean {
  return highlight.quote.trim() === selection.quote.trim()
    && Math.round(highlight.startOffset) === Math.round(selection.startOffset)
    && Math.round(highlight.endOffset) === Math.round(selection.endOffset);
}

export function removeStoredEmailLocalHighlight(messageID: string, selection: EmailHighlightSelection): boolean {
  const highlights = readStoredEmailLocalHighlights(messageID);
  const next = highlights.filter((highlight) => !emailLocalHighlightMatchesSelection(highlight, selection));
  if (next.length === highlights.length) return false;
  storeEmailLocalHighlights(messageID, next);
  return true;
}

function renderEmailTextWithHighlights(text: string, highlights: EmailLocalHighlight[], activeSelection?: EmailActiveSelection | null): React.ReactNode[] {
  if (!text) return [text];
  const activeHighlight: EmailLocalHighlight | null = activeSelection?.quote.trim()
    ? {
      id: "active-email-chat-selection",
      quote: activeSelection.quote.trim(),
      startOffset: activeSelection.startOffset,
      endOffset: activeSelection.endOffset,
    }
    : null;
  const sourceHighlights = activeHighlight ? [activeHighlight, ...highlights] : highlights;
  if (sourceHighlights.length === 0) return [text];
  const ranges = sourceHighlights
    .map((highlight) => {
      let start = Math.max(0, Math.min(text.length, Math.round(highlight.startOffset)));
      let end = Math.max(start, Math.min(text.length, Math.round(highlight.endOffset)));
      if (!highlight.quote || end <= start || text.slice(start, end) !== highlight.quote) {
        const found = text.indexOf(highlight.quote);
        if (found < 0) return null;
        start = found;
        end = found + highlight.quote.length;
      }
      return { ...highlight, start, end };
    })
    .filter((range): range is EmailLocalHighlight & { start: number; end: number } => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end || (a.id === "active-email-chat-selection" ? -1 : b.id === "active-email-chat-selection" ? 1 : 0));
  if (ranges.length === 0) return [text];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end <= range.start) continue;
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <span
        key={range.id}
        style={{
          borderRadius: 4,
          background: range.id === "active-email-chat-selection" ? EDITOR_SOURCE_HIGHLIGHT_ACTIVE_BACKGROUND : EDITOR_SOURCE_HIGHLIGHT_BACKGROUND,
          boxShadow: range.id === "active-email-chat-selection"
            ? EDITOR_SOURCE_HIGHLIGHT_OUTLINE
            : EDITOR_SOURCE_HIGHLIGHT_SOFT_OUTLINE,
        }}
      >
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function replySubject(subject: string): string {
  const clean = subject.trim() || "(no subject)";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

function parseEmailAddressDraft(value: string): EmailAddress[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)<([^<>]+)>$/);
      if (match) {
        return { name: match[1].trim(), email: match[2].trim() };
      }
      return { email: part };
    })
    .filter((address) => address.email.includes("@"));
}

export function replyAllAddressDrafts(message: EmailMessage, accountEmail = ""): { to: string; cc: string } {
  const recipients = buildReplyAllRecipients(message, accountEmail.trim() ? [accountEmail] : []);
  return {
    to: formatAddressList(recipients.to),
    cc: formatAddressList(recipients.cc),
  };
}

function emailBodyText(body: string): string {
  const value = body.trim();
  if (!value) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(value) && typeof DOMParser !== "undefined") {
    const preserveWhitespace = isMangoEditorEmailBodyHTML(value) || /white-space\s*:\s*pre-wrap/i.test(value);
    const document = new DOMParser().parseFromString(value, "text/html");
    document.querySelectorAll("script, style, noscript").forEach((element) => element.remove());
    const blockTags = new Set(["address", "article", "aside", "blockquote", "div", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "p", "section", "tr"]);
    const parts: string[] = [];
    const appendText = (node: ChildNode) => {
      if (node.nodeType === 3) {
        parts.push(node.textContent ?? "");
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tagName = node.tagName.toLowerCase();
      if (tagName === "br") parts.push("\n");
      for (const child of Array.from(node.childNodes)) appendText(child);
      if (blockTags.has(tagName)) parts.push("\n");
    };
    for (const child of Array.from(document.body.childNodes)) appendText(child);
    const text = parts.join("").replace(/\u00a0/g, " ");
    return (preserveWhitespace
      ? text
      : text.replace(/[ \t\f\v]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n")
    )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatEmailRelativeTime(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) return "just now";
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.round(diffMs / minuteMs));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / hourMs));
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.max(1, Math.round(diffMs / dayMs));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function mergeEmailThreadMessages(primary: EmailMessage | null, fetchedMessages: EmailMessage[], sentReplies: EmailMessage[]): EmailMessage[] {
  const fallbackScopeKey = primary?.client_source_scope_key?.trim() || "mailbox";
  const candidates: EmailThreadMessageCandidate[] = [];
  const appendAuthoritative = (message: EmailMessage | null | undefined) => {
    if (!message?.id?.trim()) return;
    const scopeKey = message.client_source_scope_key?.trim() || fallbackScopeKey;
    candidates.push({
      message,
      source: message.collaboration_id?.trim() ? "collaboration" : "provider",
      scopeKey,
    });
    for (const reply of message.local_replies ?? []) {
      candidates.push({
        message: { ...reply, local_replies: undefined },
        source: "local",
        scopeKey,
        inheritedThreadID: message.thread_id,
      });
    }
  };
  for (const threadMessage of fetchedMessages) appendAuthoritative(threadMessage);
  appendAuthoritative(primary);
  for (const reply of sentReplies) {
    candidates.push({
      message: { ...reply, local_replies: undefined },
      source: "local",
      scopeKey: reply.client_source_scope_key?.trim() || fallbackScopeKey,
      inheritedThreadID: primary?.thread_id,
    });
  }
  return normalizeEmailThreadMessages(candidates, "oldest");
}
function estimateEditorBodyLineCount(value: string): number {
  if (!value.trim()) return 1;
  const raw = value.startsWith(EDITOR_RICH_TEXT_PREFIX) ? value.slice(EDITOR_RICH_TEXT_PREFIX.length) : value;
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return Math.max(1, normalized.split("\n").length);
}

export const EmailConversationPane: React.FC<EmailConversationPaneProps> = ({
  messageID,
  collaborationID,
  nodeID = "",
  emailThreadID,
  apiBase = "",
	companyID,
	currentUserID = "",
  companyUsers = [],
  sharedInboxID,
  accountEmail = "",
  attachmentRequestJSON,
  attachmentResourceType = "email_message",
  attachmentResourceID = "",
  attachmentInformationID,
  attachmentEditorSurface = "attached-email-reply",
  editable,
  accent,
  surfaceText,
  strokeColor,
  ruleColor,
  activeSelection,
  highlightRemovalRequest,
  initialReplyTargetMessageID,
  initialFocusMessageID,
  initialFocusMessageRequestID = 0,
  initialReplyAll = false,
  inlineExpansion = false,
  singleMessageOnly = false,
  onReplyComplete,
  onReplyEditorFocus,
  onError,
  onSelectionChatRequest,
  onSelectionTextBoxRequest,
  onSelectionNodeRequest,
  onMessageTextBoxRequest,
  onMessageActivate,
  messageAccents = {},
}) => {
  const mailboxScope = useMemo(
    () => resolveEditorEmailMailboxScope(sharedInboxID, accountEmail),
    [accountEmail, sharedInboxID],
  );
  const mailboxSignatureScopeKey = useMemo(() => (
    [companyID.trim(), mailboxScope.sharedInboxID ?? "", mailboxScope.accountEmail ?? ""].join("\u0000")
  ), [companyID, mailboxScope]);
  const conversationRootRef = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([]);
  const [sentReplies, setSentReplies] = useState<EmailMessage[]>([]);
  const [expandedThreadMessageID, setExpandedThreadMessageID] = useState("");
  const [quotedHistoryMessageIDs, setQuotedHistoryMessageIDs] = useState<Set<string>>(() => new Set());
  const [toDraft, setToDraft] = useState("");
  const [ccDraft, setCcDraft] = useState("");
  const [bccDraft, setBccDraft] = useState("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [mailboxSignatureState, setMailboxSignatureState] = useState<ScopedEmailSignatureState>({
    scopeKey: "",
    loaded: false,
    body: "",
  });
  const [replyTargetMessageID, setReplyTargetMessageID] = useState("");
  const [replyAllMode, setReplyAllMode] = useState(false);
  const [draftAttachments, setDraftAttachments] = useState<EditorChatAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<EditorChatAttachment | null>(null);
  const [replyOutlineStyle, setReplyOutlineStyle] = useState<EditorOutlineStyleID>("automatic-outline-numbering");
  const [replyToolbarTab, setReplyToolbarTab] = useState<EditorTabID>("format");
  const [replySelectionFontSize, setReplySelectionFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [replySelectionInlineFormat, setReplySelectionInlineFormat] = useState<EditorSelectionInlineFormatState>({ bold: false, underline: false, italic: false, strikethrough: false });
  const [replyTextAlignment, setReplyTextAlignment] = useState<EditorTextAlignment>("left");
  const [replyHighlightColor, setReplyHighlightColor] = useState<EditorHighlightColor | null>(null);
  const [storedThreadDownloadStatus, setStoredThreadDownloadStatus] = useState<EmailThreadDownloadStatus>("complete");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sharedDraft, setSharedDraft] = useState<CommunicationsEmailDraft | null>(null);
  const [senderAccountDraft, setSenderAccountDraft] = useState(accountEmail?.trim() ?? "");
  const lastSharedDraftSavedFingerprintRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replyEditorControllerRef = useRef<UnifiedRichEditorFormattingController | null>(null);
  const appliedInitialReplyTargetRef = useRef("");
  const mailboxSignatureStateRef = useRef<ScopedEmailSignatureState>(mailboxSignatureState);
  const mailboxSignatureLoadRef = useRef<{ scopeKey: string; promise: Promise<string> } | null>(null);
  const replySignatureSessionRef = useRef<EmailSignatureApplicationSession | null>(null);
  const replySubmissionIdentityRef = useRef({ messageID, replyTargetMessageID: "", scopeKey: mailboxSignatureScopeKey });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const replyDockRef = useRef<HTMLDivElement | null>(null);
  const selectedEmailBodyRef = useRef<HTMLDivElement | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<EmailSelectionDraft | null>(null);
  const [emailHighlightsByMessageID, setEmailHighlightsByMessageID] = useState<EmailLocalHighlightsByMessageID>(() => ({
    [messageID]: readStoredEmailLocalHighlights(messageID),
  }));
  const universalDraftEnabled = Boolean(collaborationID?.trim() && emailThreadID?.trim() && nodeID.trim());
  const applySharedDraft = useCallback((draft: CommunicationsEmailDraft) => {
    setSharedDraft(draft);
    setSenderAccountDraft(draft.account_email?.trim() || accountEmail?.trim() || "");
    setToDraft(draft.to_recipients);
    setCcDraft(draft.cc_recipients);
    setBccDraft(draft.bcc_recipients);
    setSubjectDraft(draft.subject);
    setBodyDraft(draft.body_editor_html);
    lastSharedDraftSavedFingerprintRef.current = universalEmailDraftFingerprint({
      sender: draft.account_email ?? "", to: draft.to_recipients, cc: draft.cc_recipients,
      bcc: draft.bcc_recipients, subject: draft.subject, body: draft.body_editor_html,
    });
    const sourceProviderMessageID = draft.reply_to_message?.id?.trim() || "";
    if (sourceProviderMessageID) setReplyTargetMessageID(sourceProviderMessageID);
  }, [accountEmail]);

  useEffect(() => {
    if (!universalDraftEnabled) {
      setSharedDraft(null);
      return;
    }
    let cancelled = false;
    void listEmailDrafts(companyID, {}).then((drafts) => {
      if (cancelled) return;
      const activeDraft = drafts.find((draft) => draft.is_shared && draft.email_thread_id?.trim() === emailThreadID?.trim()) ?? null;
      setSharedDraft(activeDraft);
      if (activeDraft?.origin_node_id?.trim() === nodeID.trim()) applySharedDraft(activeDraft);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [applySharedDraft, companyID, emailThreadID, nodeID, universalDraftEnabled]);

  mailboxSignatureStateRef.current = mailboxSignatureState;
  replySubmissionIdentityRef.current = { messageID, replyTargetMessageID, scopeKey: mailboxSignatureScopeKey };

  const loadMailboxSignature = useCallback((): Promise<string> => {
    const cleanCompanyID = companyID.trim();
    if (!cleanCompanyID || (!mailboxScope.sharedInboxID && !mailboxScope.accountEmail)) {
      const nextState = { scopeKey: mailboxSignatureScopeKey, loaded: true, body: "" };
      mailboxSignatureStateRef.current = nextState;
      setMailboxSignatureState(nextState);
      return Promise.resolve("");
    }
    const loadedSignature = loadedEmailSignatureForScope(mailboxSignatureStateRef.current, mailboxSignatureScopeKey);
    if (loadedSignature !== null) return Promise.resolve(loadedSignature);
    const activeLoad = mailboxSignatureLoadRef.current;
    if (activeLoad?.scopeKey === mailboxSignatureScopeKey) return activeLoad.promise;

    const pendingState = { scopeKey: mailboxSignatureScopeKey, loaded: false, body: "" };
    mailboxSignatureStateRef.current = pendingState;
    setMailboxSignatureState(pendingState);
    let request: Promise<string>;
    request = getEmailSignature(cleanCompanyID, mailboxScope.sharedInboxID, mailboxScope.accountEmail)
      .then((signature) => {
        const body = signature?.body_editor_html ?? "";
        if (mailboxSignatureLoadRef.current?.promise === request) {
          mailboxSignatureLoadRef.current = null;
          const nextState = { scopeKey: mailboxSignatureScopeKey, loaded: true, body };
          mailboxSignatureStateRef.current = nextState;
          setMailboxSignatureState(nextState);
        }
        return body;
      })
      .catch((cause) => {
        if (mailboxSignatureLoadRef.current?.promise === request) {
          mailboxSignatureLoadRef.current = null;
          const nextState = { scopeKey: mailboxSignatureScopeKey, loaded: false, body: "" };
          mailboxSignatureStateRef.current = nextState;
          setMailboxSignatureState(nextState);
        }
        throw cause;
      });
    mailboxSignatureLoadRef.current = { scopeKey: mailboxSignatureScopeKey, promise: request };
    return request;
  }, [companyID, mailboxScope.accountEmail, mailboxScope.sharedInboxID, mailboxSignatureScopeKey]);

  useEffect(() => {
    void loadMailboxSignature().catch(() => undefined);
  }, [loadMailboxSignature]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStoredThreadDownloadStatus("complete");
    setError("");
    setMessage(null);
    setThreadMessages([]);
    setSentReplies([]);
    setReplyTargetMessageID("");
    setReplyAllMode(false);
    setBodyDraft("");
    replySignatureSessionRef.current = null;
    setReplyToolbarTab("format");
    setReplySelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
    setReplySelectionInlineFormat({ bold: false, underline: false, italic: false, strikethrough: false });
    setReplyTextAlignment("left");
    setReplyHighlightColor(null);
    setDraftAttachments([]);
    setCcDraft("");
    setBccDraft("");
    setPreviewAttachment(null);
    setSelectionDraft(null);
    setEmailHighlightsByMessageID({ [messageID]: readStoredEmailLocalHighlights(messageID) });
    void (async () => {
      const cleanEmailThreadID = emailThreadID?.trim() ?? "";
      const storedThread = cleanEmailThreadID && nodeID.trim()
        ? await getNodeEmailThread(companyID, nodeID, cleanEmailThreadID)
        : null;
      const cleanCollaborationID = collaborationID?.trim() ?? "";
      const collaborationThread = !storedThread && cleanCollaborationID
        ? await getEmailCollaborationThread(companyID, cleanCollaborationID)
        : null;
      const immediateMessages = storedThread?.messages.length ? storedThread.messages : collaborationThread?.messages ?? [];
      const payload = immediateMessages.find((item) => item.id === messageID)
        ?? immediateMessages[0]
        ?? await getEmailMessage(messageID, companyID, mailboxScope.sharedInboxID, { accountEmail: mailboxScope.accountEmail });
      if (!payload) throw new Error("email_collaboration_thread_unavailable");
      if (cancelled) return;
      setMessage(payload);
      const storedDownload = storedThread ?? collaborationThread;
      setStoredThreadDownloadStatus(resolveEmailThreadDownloadStatus(
        storedDownload?.download_status,
        storedDownload?.history_complete ?? true,
        storedDownload?.thread_id,
      ));
      setThreadMessages(singleMessageOnly ? [payload] : immediateMessages.length ? immediateMessages : [payload]);
      setSentReplies(payload.local_replies ?? []);
      setToDraft(formatAddressList(payload.reply_to?.length ? payload.reply_to : payload.from));
      setCcDraft("");
      setBccDraft("");
      setSubjectDraft(replySubject(payload.subject));
      setBodyDraft("");

      if (singleMessageOnly || storedThread || collaborationThread) return;

      const threadID = payload.thread_id?.trim();
      if (!threadID) return;
      try {
        const thread = await getEmailThread(threadID, companyID, mailboxScope.sharedInboxID, mailboxScope.accountEmail);
        if (cancelled) return;
        let ids = Array.from(new Set((thread.message_ids ?? []).map((item) => item.trim()).filter(Boolean)));
        if (ids.length === 0) {
          const page = await listEmailMessages({ companyID, ...mailboxScope, mailbox: "all", limit: EMAIL_THREAD_MESSAGE_BATCH_SIZE, threadID, refresh: true });
          ids = Array.from(new Set((page.messages ?? []).map((item) => item.id).filter(Boolean)));
        }
        if (!ids.includes(payload.id)) ids.unshift(payload.id);
        const details = await Promise.all(ids.map(async (id) => {
          if (id === payload.id) return payload;
          try {
            return await getEmailMessage(id, companyID, mailboxScope.sharedInboxID, { accountEmail: mailboxScope.accountEmail });
          } catch {
            return thread.latest_draft_or_message?.id === id ? thread.latest_draft_or_message : null;
          }
        }));
        if (!cancelled) setThreadMessages(details.filter((item): item is EmailMessage => Boolean(item)));
      } catch {
        try {
          const page = await listEmailMessages({ companyID, ...mailboxScope, mailbox: "all", limit: EMAIL_THREAD_MESSAGE_BATCH_SIZE, threadID, refresh: true });
          if (cancelled) return;
          const ids = Array.from(new Set((page.messages ?? []).map((item) => item.id).filter(Boolean)));
          if (!ids.includes(payload.id)) ids.unshift(payload.id);
          const details = await Promise.all(ids.map(async (id) => {
            if (id === payload.id) return payload;
            try {
              return await getEmailMessage(id, companyID, mailboxScope.sharedInboxID, { accountEmail: mailboxScope.accountEmail });
            } catch {
              return (page.messages ?? []).find((item) => item.id === id) ?? null;
            }
          }));
          if (!cancelled) setThreadMessages(details.filter((item): item is EmailMessage => Boolean(item)));
        } catch {
          if (!cancelled) setThreadMessages([payload]);
        }
      }
    })()
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [collaborationID, companyID, emailThreadID, mailboxScope, messageID, nodeID, singleMessageOnly]);

	useEffect(() => {
		if (storedThreadDownloadStatus !== "downloading" || singleMessageOnly || replyTargetMessageID) return;
		const cleanEmailThreadID = emailThreadID?.trim() ?? "";
		const cleanCollaborationID = collaborationID?.trim() ?? "";
		if ((!cleanEmailThreadID || !nodeID.trim()) && !cleanCollaborationID) return;
		const scope = mailboxScope.sharedInboxID
			? realtimeSharedMailboxScope(mailboxScope.sharedInboxID)
			: realtimePersonalMailboxScope(currentUserID, mailboxScope.accountEmail ?? "");
		if (!apiBase.trim() || !scope) return;
		let cancelled = false;
		const unsubscribe = subscribeRealtimeScope(apiBase, companyID, scope, {
			onMailboxMessageChanged: (change) => {
				if (change.message_id && change.message_id !== messageID && change.thread_id !== message?.thread_id) return;
				void (async () => {
				const storedThread = cleanEmailThreadID && nodeID.trim()
					? await getNodeEmailThread(companyID, nodeID, cleanEmailThreadID)
          : null;
        const collaborationThread = !storedThread && cleanCollaborationID
          ? await getEmailCollaborationThread(companyID, cleanCollaborationID)
          : null;
        if (cancelled) return;
        const refreshed = storedThread ?? collaborationThread;
        if (!refreshed) {
          setStoredThreadDownloadStatus("partial");
          return;
        }
        const refreshedMessages = refreshed.messages ?? [];
        const refreshedMessage = refreshedMessages.find((item) => item.id === messageID)
          ?? refreshedMessages[0]
          ?? null;
        if (refreshedMessage) {
          setMessage(refreshedMessage);
          setThreadMessages(refreshedMessages.length ? refreshedMessages : [refreshedMessage]);
        }
				setStoredThreadDownloadStatus(resolveEmailThreadDownloadStatus(
          refreshed.download_status,
          refreshed.history_complete,
          refreshed.thread_id,
				));
				})().catch(() => undefined);
			},
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [apiBase, collaborationID, companyID, currentUserID, emailThreadID, mailboxScope, message?.thread_id, messageID, nodeID, replyTargetMessageID, singleMessageOnly, storedThreadDownloadStatus]);

  useEffect(() => {
    if (!highlightRemovalRequest) return;
    const targetMessageID = highlightRemovalRequest.messageID.trim() || messageID;
    setEmailHighlightsByMessageID((current) => {
      const currentHighlights = current[targetMessageID] ?? readStoredEmailLocalHighlights(targetMessageID);
      const nextHighlights = currentHighlights.filter((highlight) => !emailLocalHighlightMatchesSelection(highlight, highlightRemovalRequest));
      if (nextHighlights.length === currentHighlights.length) return current;
      storeEmailLocalHighlights(targetMessageID, nextHighlights);
      return { ...current, [targetMessageID]: nextHighlights };
    });
  }, [highlightRemovalRequest?.requestID, highlightRemovalRequest?.messageID, messageID]);

  const recipients = parseEmailAddressDraft(toDraft);
  const ccRecipients = parseEmailAddressDraft(ccDraft);
  const bccRecipients = parseEmailAddressDraft(bccDraft);
  const providerReplyAvailable = editable && !singleMessageOnly;
  const replyEditingEnabled = providerReplyAvailable && !sending;
  const canSend = replyEditingEnabled && Boolean(message) && Boolean(replyTargetMessageID) && (recipients.length + ccRecipients.length + bccRecipients.length) > 0 && subjectDraft.trim() && editorBodyHasEmailContent(bodyDraft);
  const replyEditorLineCount = useMemo(() => estimateEditorBodyLineCount(bodyDraft), [bodyDraft]);
  const replyEditorMinHeight = inlineExpansion ? 112 : 138;
  const replyEditorMaxHeight = inlineExpansion ? 272 : 340;
  const replyEditorHeight = Math.min(replyEditorMaxHeight, replyEditorMinHeight + Math.max(0, replyEditorLineCount - 4) * 18);
  const replyAttachmentResourceID = useMemo(() => (
    attachmentResourceID.trim()
    || messageID.trim()
  ), [attachmentResourceID, messageID, nodeID]);
  const replyEditorImageAttachmentContext = attachmentRequestJSON && apiBase.trim() && companyID.trim() && replyAttachmentResourceID
    ? {
      requestJSON: attachmentRequestJSON,
      apiBase,
      companyID,
      resourceType: attachmentResourceType,
      resourceID: replyAttachmentResourceID,
      informationID: attachmentInformationID?.trim() || undefined,
      editorSurface: attachmentEditorSurface,
    }
    : undefined;
  const canUseEmailSelection = editable && Boolean(onSelectionChatRequest || onSelectionTextBoxRequest || onSelectionNodeRequest);
  const displayThreadMessages = useMemo(() => {
    const merged = mergeEmailThreadMessages(message, threadMessages, sentReplies);
    if (!singleMessageOnly) return merged;
    const exactMessage = merged.find((candidate) => candidate.id === messageID)
      ?? (message?.id === messageID ? message : null)
      ?? merged[0]
      ?? null;
    return exactMessage ? [exactMessage] : [];
  }, [message, messageID, sentReplies, singleMessageOnly, threadMessages]);
  useEffect(() => {
    setExpandedThreadMessageID((current) => {
      if (current && displayThreadMessages.some((threadMessage) => threadMessage.id === current)) return current;
      for (let index = displayThreadMessages.length - 1; index >= 0; index -= 1) {
        const candidateID = displayThreadMessages[index]?.id?.trim();
        if (candidateID) return candidateID;
      }
      return "";
    });
  }, [displayThreadMessages]);
  useEffect(() => {
    const targetMessageID = initialFocusMessageID?.trim() ?? "";
    if (!targetMessageID || !displayThreadMessages.some((threadMessage) => threadMessage.id === targetMessageID)) return undefined;
    setExpandedThreadMessageID(targetMessageID);
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(conversationRootRef.current?.querySelectorAll<HTMLElement>("[data-email-message-id]") ?? [])
        .find((element) => element.dataset.emailMessageId === targetMessageID);
      target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      target?.animate?.([
        { transform: "translateX(0)", boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
        { transform: "translateX(3px)", boxShadow: "0 0 0 3px rgba(14,165,233,0.22)" },
        { transform: "translateX(0)", boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
      ], { duration: 820, easing: "ease-out" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayThreadMessages, initialFocusMessageID, initialFocusMessageRequestID]);
  useEffect(() => {
    setEmailHighlightsByMessageID((current) => {
      let changed = false;
      const next = { ...current };
      for (const threadMessage of displayThreadMessages) {
        const threadMessageID = threadMessage.id?.trim();
        if (!threadMessageID || threadMessageID in next) continue;
        next[threadMessageID] = readStoredEmailLocalHighlights(threadMessageID);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [displayThreadMessages]);
  const selectionActionCount = (onSelectionChatRequest ? 1 : 0) + (onSelectionTextBoxRequest ? 1 : 0) + (onSelectionNodeRequest ? 1 : 0);
  const selectionActionToolbarWidth = emailSelectionActionToolbarWidth(selectionActionCount);
  const selectionActionToolbarHeight = EMAIL_SELECTION_ACTION_BUTTON_SIZE + (EMAIL_SELECTION_ACTION_PADDING * 2) + (EMAIL_SELECTION_ACTION_BORDER * 2);
  const updateFrameSelection = useCallback((selectionMessageID: string, frameSelection: EmailFrameSelection | null) => {
    if (!canUseEmailSelection) return;
    if (!frameSelection) {
      setSelectionDraft((current) => current?.messageID === selectionMessageID ? null : current);
      return;
    }
    const root = bodyRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const minX = root.scrollLeft + EMAIL_SELECTION_ACTION_OFFSET;
    const maxX = root.scrollLeft + root.clientWidth - selectionActionToolbarWidth - EMAIL_SELECTION_ACTION_OFFSET;
    const minY = root.scrollTop + EMAIL_SELECTION_ACTION_OFFSET;
    const maxY = root.scrollTop + root.clientHeight - selectionActionToolbarHeight - EMAIL_SELECTION_ACTION_OFFSET;
    const rawX = frameSelection.clientRight - rootRect.left + root.scrollLeft + EMAIL_SELECTION_ACTION_OFFSET;
    const centeredX = frameSelection.clientLeft - rootRect.left + root.scrollLeft + ((frameSelection.clientRight - frameSelection.clientLeft - selectionActionToolbarWidth) / 2);
    const x = rawX >= minX && rawX <= maxX ? rawX : clampEmailSelectionActionPosition(centeredX, minX, maxX);
    const centeredY = frameSelection.clientTop - rootRect.top + root.scrollTop + ((frameSelection.clientBottom - frameSelection.clientTop - selectionActionToolbarHeight) / 2);
    const y = clampEmailSelectionActionPosition(centeredY, minY, maxY);
    setSelectionDraft({
      messageID: selectionMessageID,
      quote: frameSelection.quote,
      startOffset: frameSelection.startOffset,
      endOffset: frameSelection.endOffset,
      x,
      y,
    });
  }, [canUseEmailSelection, selectionActionToolbarHeight, selectionActionToolbarWidth]);
  const replyTargetMessage = useMemo(() => (
    replyTargetMessageID ? displayThreadMessages.find((item) => item.id === replyTargetMessageID) ?? null : null
  ), [displayThreadMessages, replyTargetMessageID]);
  const ensureReplySignature = useCallback((targetMessageID: string) => {
    const cleanTargetMessageID = targetMessageID.trim();
    if (!cleanTargetMessageID) return;
    replySignatureSessionRef.current = beginEmailSignatureApplicationSession(
      replySignatureSessionRef.current,
      mailboxSignatureScopeKey,
    );
    const loadedSignature = loadedEmailSignatureForScope(
      mailboxSignatureStateRef.current,
      mailboxSignatureScopeKey,
    );
    if (loadedSignature !== null) {
      setBodyDraft((current) => {
        const result = applyEmailSignatureOnceForSession(
          current,
          loadedSignature,
          replySignatureSessionRef.current,
          mailboxSignatureScopeKey,
        );
        replySignatureSessionRef.current = result.session;
        return result.body;
      });
      return;
    }
    void loadMailboxSignature().catch(() => undefined);
  }, [loadMailboxSignature, mailboxSignatureScopeKey]);

  useEffect(() => {
    const session = replySignatureSessionRef.current;
    if (!replyTargetMessageID || !session || session.scopeKey !== mailboxSignatureScopeKey || session.applied) return;
    const loadedSignature = loadedEmailSignatureForScope(mailboxSignatureState, mailboxSignatureScopeKey);
    if (loadedSignature === null) return;
    setBodyDraft((current) => {
      const result = applyEmailSignatureOnceForSession(
        current,
        loadedSignature,
        replySignatureSessionRef.current,
        mailboxSignatureScopeKey,
      );
      replySignatureSessionRef.current = result.session;
      return result.body;
    });
  }, [mailboxSignatureScopeKey, mailboxSignatureState, replyTargetMessageID]);

  const openUniversalDraft = useCallback(async (target: EmailMessage, replyAll: boolean) => {
    if (!universalDraftEnabled) return null;
    if (sharedDraft) {
      applySharedDraft(sharedDraft);
      setReplyAllMode(replyAll);
      return sharedDraft;
    }
    const sourceMessageID = target.email_message_id?.trim() || "";
    if (!sourceMessageID) throw new Error("email_message_id_missing");
    const recipientDrafts = replyAll ? replyAllAddressDrafts(target, senderAccountDraft || accountEmail) : null;
    const saved = await saveEmailDraft({
      companyID,
      draftID: `draft:reply:thread:${emailThreadID?.trim()}`,
      sharedInboxID: mailboxScope.sharedInboxID,
      accountEmail: mailboxScope.accountEmail,
      senderAccountEmail: senderAccountDraft || accountEmail,
      kind: "reply",
      sourceMessageID,
      replyToMessageID: target.id,
      to: recipientDrafts?.to ?? formatAddressList(target.reply_to?.length ? target.reply_to : target.from),
      cc: recipientDrafts?.cc ?? "",
      bcc: "",
      subject: replySubject(target.subject || message?.subject || ""),
      bodyEditorHTML: bodyDraft,
      replyToMessage: target,
      collaborationID: collaborationID?.trim(),
      emailThreadID: emailThreadID?.trim(),
      originNodeID: nodeID.trim(),
      sharedDraft: true,
      revision: 0,
    });
    applySharedDraft(saved);
    setReplyAllMode(replyAll);
    return saved;
  }, [accountEmail, applySharedDraft, bodyDraft, collaborationID, companyID, emailThreadID, mailboxScope.accountEmail, mailboxScope.sharedInboxID, message?.subject, nodeID, senderAccountDraft, sharedDraft, universalDraftEnabled]);

  useEffect(() => {
    const targetID = initialReplyTargetMessageID?.trim() ?? "";
    if (!targetID) {
      appliedInitialReplyTargetRef.current = "";
      return;
    }
    const targetKey = `${messageID}:${targetID}:${initialReplyAll ? "all" : "reply"}`;
    if (!editable || appliedInitialReplyTargetRef.current === targetKey) return;
    const target = displayThreadMessages.find((item) => item.id === targetID);
    if (!target) return;
    appliedInitialReplyTargetRef.current = targetKey;
    setReplyTargetMessageID(target.id);
    setReplyAllMode(initialReplyAll);
    const replyDrafts = initialReplyAll ? replyAllAddressDrafts(target, accountEmail) : null;
    setToDraft(replyDrafts?.to ?? formatAddressList(target.reply_to?.length ? target.reply_to : target.from));
    setCcDraft(replyDrafts?.cc ?? "");
    setBccDraft("");
    setSubjectDraft(replySubject(target.subject || message?.subject || ""));
    ensureReplySignature(target.id);
    if (universalDraftEnabled) {
      void openUniversalDraft(target, initialReplyAll).catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_open_shared_email_draft";
        setError(nextError);
        onError(nextError);
      });
    }
    window.requestAnimationFrame(() => replyEditorControllerRef.current?.focus());
  }, [accountEmail, displayThreadMessages, editable, ensureReplySignature, initialReplyAll, initialReplyTargetMessageID, message?.subject, messageID, onError, openUniversalDraft, universalDraftEnabled]);

  const readEmailSelectionDraft = useCallback((): EmailSelectionDraft | null => {
    if (!canUseEmailSelection) return null;
    const root = bodyRef.current;
    if (!root) return null;
    const selection = root.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const commonElement = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const content = commonElement?.closest(`[${EMAIL_BODY_MESSAGE_ID_ATTRIBUTE}]`);
    if (!(content instanceof HTMLElement) || !root.contains(content)) return null;
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
    const selectionMessageID = content.getAttribute(EMAIL_BODY_MESSAGE_ID_ATTRIBUTE)?.trim() || messageID;
    const contentText = content.textContent ?? "";
    const rawQuote = range.toString();
    const quote = rawQuote.trim();
    if (!quote) return null;
    const leadingTrim = rawQuote.length - rawQuote.trimStart().length;
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(content);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = Math.max(0, Math.min(contentText.length, beforeRange.toString().length + leadingTrim));
    const endOffset = Math.max(startOffset, Math.min(contentText.length, startOffset + quote.length));
    if (endOffset <= startOffset) return null;
    const selectionIsBackward = selection.anchorNode && selection.focusNode
      ? selection.anchorNode === selection.focusNode
        ? selection.focusOffset < selection.anchorOffset
        : Boolean(selection.anchorNode.compareDocumentPosition(selection.focusNode) & Node.DOCUMENT_POSITION_PRECEDING)
      : false;
    const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const focusRect = (selectionIsBackward ? rangeRects[0] : rangeRects[rangeRects.length - 1]) ?? range.getBoundingClientRect();
    const selectionRect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const minX = root.scrollLeft + EMAIL_SELECTION_ACTION_OFFSET;
    const maxX = root.scrollLeft + root.clientWidth - selectionActionToolbarWidth - EMAIL_SELECTION_ACTION_OFFSET;
    const minY = root.scrollTop + EMAIL_SELECTION_ACTION_OFFSET;
    const maxY = root.scrollTop + root.clientHeight - selectionActionToolbarHeight - EMAIL_SELECTION_ACTION_OFFSET;
    const rawSideX = selectionIsBackward
      ? focusRect.left - rootRect.left + root.scrollLeft - selectionActionToolbarWidth - EMAIL_SELECTION_ACTION_OFFSET
      : focusRect.right - rootRect.left + root.scrollLeft + EMAIL_SELECTION_ACTION_OFFSET;
    const sideHasRoom = rawSideX >= minX && rawSideX <= maxX;
    const rawCenteredX = selectionRect.left - rootRect.left + root.scrollLeft + ((selectionRect.width - selectionActionToolbarWidth) / 2);
    const x = sideHasRoom ? rawSideX : clampEmailSelectionActionPosition(rawCenteredX, minX, maxX);
    const rawCenteredY = focusRect.top - rootRect.top + root.scrollTop + ((focusRect.height - selectionActionToolbarHeight) / 2);
    const rawBelowY = selectionRect.bottom - rootRect.top + root.scrollTop + EMAIL_SELECTION_ACTION_OFFSET;
    const rawAboveY = selectionRect.top - rootRect.top + root.scrollTop - selectionActionToolbarHeight - EMAIL_SELECTION_ACTION_OFFSET;
    const rawY = sideHasRoom
      ? rawCenteredY
      : rawBelowY <= maxY
        ? rawBelowY
        : rawAboveY >= minY
          ? rawAboveY
          : rawCenteredY;
    const y = clampEmailSelectionActionPosition(rawY, minY, maxY);
    return { messageID: selectionMessageID, quote, startOffset, endOffset, x, y };
  }, [canUseEmailSelection, messageID, selectionActionToolbarHeight, selectionActionToolbarWidth]);

  const captureEmailSelection = useCallback(() => {
    window.setTimeout(() => setSelectionDraft(readEmailSelectionDraft()), 0);
  }, [readEmailSelectionDraft]);

  const addEmailLocalHighlight = useCallback((draft: EmailSelectionDraft) => {
    const targetMessageID = draft.messageID.trim() || messageID;
    const highlight: EmailLocalHighlight = {
      id: `${Date.now()}:${draft.startOffset}:${draft.endOffset}`,
      quote: draft.quote,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
    };
    setEmailHighlightsByMessageID((current) => {
      const currentHighlights = current[targetMessageID] ?? readStoredEmailLocalHighlights(targetMessageID);
      if (currentHighlights.some((item) => item.startOffset === highlight.startOffset && item.endOffset === highlight.endOffset && item.quote === highlight.quote)) return current;
      const nextHighlights = [...currentHighlights, highlight].slice(-80);
      storeEmailLocalHighlights(targetMessageID, nextHighlights);
      return { ...current, [targetMessageID]: nextHighlights };
    });
  }, [messageID]);

  const addEmailDraftAttachments = useCallback((files: FileList | File[]) => {
    if (!editable) return;
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
    if (!attachmentRequestJSON || !apiBase.trim() || !companyID.trim() || !replyAttachmentResourceID) {
      const nextError = "Email attachment upload context is unavailable.";
      setError(nextError);
      onError(nextError);
      return;
    }
    void Promise.allSettled(incomingFiles.map((file) => uploadEditorAttachment(file, {
      requestJSON: attachmentRequestJSON,
      companyID,
      resourceType: attachmentResourceType,
      resourceID: replyAttachmentResourceID,
      sourceKind: "email_outgoing",
      relationshipKind: "email_attachment",
      informationID: attachmentInformationID?.trim() || undefined,
      messageID: replyTargetMessageID || messageID,
      editorSurface: attachmentEditorSurface,
    })))
      .then((results) => {
        const attachments = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (attachments.length > 0) setDraftAttachments((current) => [...current, ...attachments]);
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failures.length === 0) {
          setError("");
          return;
        }
        const cause = failures[0]?.reason;
        const nextError = cause instanceof Error ? cause.message : "failed_to_upload_attachment";
        setError(nextError);
        onError(nextError);
      });
  }, [apiBase, attachmentEditorSurface, attachmentInformationID, attachmentRequestJSON, attachmentResourceType, companyID, editable, messageID, onError, replyAttachmentResourceID, replyTargetMessageID]);

  const removeEmailDraftAttachment = useCallback((attachmentID: string) => {
    setDraftAttachments((current) => current.filter((attachment) => attachment.id !== attachmentID));
  }, []);

  const selectReplyTarget = useCallback((target: EmailMessage, replyAll = false) => {
    if (!replyEditingEnabled) return;
    if (replyTargetMessageID === target.id && replyAllMode === replyAll) {
      replySignatureSessionRef.current = null;
      setReplyTargetMessageID("");
      setReplyAllMode(false);
      return;
    }
    setReplyTargetMessageID(target.id);
    setReplyAllMode(replyAll);
    const replyDrafts = replyAll ? replyAllAddressDrafts(target, accountEmail) : null;
    setToDraft(replyDrafts?.to ?? formatAddressList(target.reply_to?.length ? target.reply_to : target.from));
    setCcDraft(replyDrafts?.cc ?? "");
    setBccDraft("");
    setSubjectDraft(replySubject(target.subject || message?.subject || ""));
    ensureReplySignature(target.id);
    if (universalDraftEnabled) {
      void openUniversalDraft(target, replyAll).catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_open_shared_email_draft";
        setError(nextError);
        onError(nextError);
      });
    }
    window.requestAnimationFrame(() => replyEditorControllerRef.current?.focus());
  }, [accountEmail, ensureReplySignature, message?.subject, onError, openUniversalDraft, replyAllMode, replyEditingEnabled, replyTargetMessageID, universalDraftEnabled]);

  useEffect(() => {
    if (!universalDraftEnabled || !sharedDraft || !replyTargetMessage || sending) return undefined;
    const fingerprint = universalEmailDraftFingerprint({
      sender: senderAccountDraft, to: toDraft, cc: ccDraft, bcc: bccDraft, subject: subjectDraft, body: bodyDraft,
    });
    if (fingerprint === lastSharedDraftSavedFingerprintRef.current) return undefined;
    const timer = window.setTimeout(() => {
      void saveEmailDraft({
        companyID,
        draftID: sharedDraft.draft_id,
        sharedInboxID: mailboxScope.sharedInboxID,
        accountEmail: mailboxScope.accountEmail,
        senderAccountEmail: senderAccountDraft || accountEmail,
        kind: "reply",
        sourceMessageID: sharedDraft.source_message_id,
        replyToMessageID: sharedDraft.reply_to_message?.id,
        to: toDraft,
        cc: ccDraft,
        bcc: bccDraft,
        subject: subjectDraft,
        bodyEditorHTML: bodyDraft,
        replyToMessage: sharedDraft.reply_to_message,
        collaborationID: collaborationID?.trim(),
        emailThreadID: emailThreadID?.trim(),
        originNodeID: sharedDraft.origin_node_id,
        sharedDraft: true,
        revision: sharedDraft.revision ?? 0,
      }).then((saved) => {
        lastSharedDraftSavedFingerprintRef.current = fingerprint;
        setSharedDraft(saved);
      }).catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_save_shared_email_draft";
        setError(nextError);
        onError(nextError);
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [accountEmail, bccDraft, bodyDraft, ccDraft, collaborationID, companyID, emailThreadID, mailboxScope.accountEmail, mailboxScope.sharedInboxID, onError, replyTargetMessage, senderAccountDraft, sending, sharedDraft, subjectDraft, toDraft, universalDraftEnabled]);

  const submitReply = () => {
    if (!message || !replyTargetMessage || !canSend) return;
    if (universalDraftEnabled && sharedDraft && collaborationID?.trim()) {
      setSending(true);
      setError("");
      void saveEmailDraft({
        companyID,
        draftID: sharedDraft.draft_id,
        sharedInboxID: mailboxScope.sharedInboxID,
        accountEmail: mailboxScope.accountEmail,
        senderAccountEmail: senderAccountDraft || accountEmail,
        kind: "reply",
        sourceMessageID: sharedDraft.source_message_id,
        replyToMessageID: sharedDraft.reply_to_message?.id,
        to: toDraft,
        cc: ccDraft,
        bcc: bccDraft,
        subject: subjectDraft,
        bodyEditorHTML: replyEditorControllerRef.current?.flush() ?? bodyDraft,
        replyToMessage: sharedDraft.reply_to_message,
        collaborationID: collaborationID.trim(),
        emailThreadID: emailThreadID?.trim(),
        originNodeID: sharedDraft.origin_node_id,
        sharedDraft: true,
        revision: sharedDraft.revision ?? 0,
      }).then((saved) => sendEmailCollaborationDraft({
        companyID,
        collaborationID: collaborationID.trim(),
        draftID: saved.draft_id,
        expectedRevision: saved.revision ?? 0,
      })).then((result) => {
        setSentReplies((current) => [...current, result.message]);
        setSharedDraft(null);
        setReplyTargetMessageID("");
        setReplyAllMode(false);
        setBodyDraft("");
        setDraftAttachments([]);
        onReplyComplete?.();
      }).catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_send_shared_email_draft";
        setError(nextError);
        onError(nextError);
      }).finally(() => setSending(false));
      return;
    }
    const submittedIdentity = {
      messageID: message.id,
      replyTargetMessageID: replyTargetMessage.id,
      scopeKey: mailboxSignatureScopeKey,
    };
    const submittedBody = replyEditorControllerRef.current?.flush() ?? bodyDraft;
    const submittedRecipients = {
      to: recipients,
      cc: ccRecipients,
      bcc: bccRecipients,
      subject: subjectDraft.trim(),
      attachments: draftAttachments,
    };
    setSending(true);
    setError("");
    void (async () => {
      try {
        const signature = await loadMailboxSignature();
        const currentIdentity = replySubmissionIdentityRef.current;
        if (
          currentIdentity.messageID !== submittedIdentity.messageID
          || currentIdentity.replyTargetMessageID !== submittedIdentity.replyTargetMessageID
          || currentIdentity.scopeKey !== submittedIdentity.scopeKey
        ) return;
        const signedBody = applyEmailSignatureOnceForSession(
          submittedBody,
          signature,
          replySignatureSessionRef.current,
          submittedIdentity.scopeKey,
        );
        replySignatureSessionRef.current = signedBody.session;
        if (signedBody.body !== submittedBody) setBodyDraft(signedBody.body);
        const sent = await sendEmail({
          to: submittedRecipients.to,
          cc: submittedRecipients.cc,
          bcc: submittedRecipients.bcc,
          subject: submittedRecipients.subject,
          body: serializeEditorBodyForEmailHTML(signedBody.body),
          attachments: submittedRecipients.attachments
            .map((attachment) => {
              const attachmentID = attachment.attachmentID?.trim() || attachment.id.trim();
              return {
                id: attachmentID,
                attachment_id: attachmentID,
                filename: attachment.name.trim() || "attachment",
                content_type: attachment.type.trim() || "application/octet-stream",
                size: attachment.size,
              };
            })
            .filter((attachment) => attachment.attachment_id),
          reply_to_message_id: submittedIdentity.replyTargetMessageID,
          company_id: companyID,
          shared_inbox_id: mailboxScope.sharedInboxID,
          account_email: mailboxScope.accountEmail,
        });
        const sentWithTimestamp = sent.date ? sent : { ...sent, date: Math.floor(Date.now() / 1000) };
        const latestIdentity = replySubmissionIdentityRef.current;
        if (
          latestIdentity.messageID !== submittedIdentity.messageID
          || latestIdentity.replyTargetMessageID !== submittedIdentity.replyTargetMessageID
          || latestIdentity.scopeKey !== submittedIdentity.scopeKey
        ) return;
        setSentReplies((current) => [...current, sentWithTimestamp]);
        setBodyDraft("");
        setDraftAttachments([]);
        replySignatureSessionRef.current = null;
        setReplyTargetMessageID("");
        setReplyAllMode(false);
        onReplyComplete?.();
      } catch (cause) {
        if (isOutboundEmailUndoneError(cause)) {
          setError("");
        } else {
          const nextError = cause instanceof Error ? cause.message : "failed_to_send_email";
          setError(nextError);
          onError(nextError);
        }
      } finally {
        setSending(false);
      }
    })();
  };

  const syncReplyToolbarFormatState = useCallback(() => {
    const state = replyEditorControllerRef.current?.readFormatState();
    if (!state) return;
    setReplySelectionFontSize(state.fontSize);
    setReplySelectionInlineFormat({ bold: state.bold, underline: state.underline, italic: state.italic, strikethrough: state.strikethrough });
    setReplyHighlightColor(state.highlightColor);
    setReplyTextAlignment(state.textAlignment);
  }, []);
  const adjustReplyFontSize = useCallback((delta: number) => {
    replyEditorControllerRef.current?.adjustFontSize(delta);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const setReplyFontSize = useCallback((fontSize: number) => {
    replyEditorControllerRef.current?.applyFontSizeValue(fontSize);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const toggleReplyInlineFormat = useCallback((command: EditorInlineStyleCommand) => {
    replyEditorControllerRef.current?.toggleInlineFormat(command);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const setReplySelectionHighlightColor = useCallback((color: EditorHighlightColor | null) => {
    replyEditorControllerRef.current?.applyHighlightColor(color);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const setReplySelectionTextAlignment = useCallback((alignment: EditorTextAlignment) => {
    replyEditorControllerRef.current?.applyTextAlignment(alignment);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const changeReplyOutlineStyle = useCallback((nextOutlineStyle: EditorOutlineStyleID) => {
    setReplyOutlineStyle(nextOutlineStyle);
    setReplyToolbarTab("outline-styles");
  }, []);

  const showConversationHeader = loading || Boolean(error) || Boolean(message && !inlineExpansion);
  const replyDockVisible = Boolean(message && replyTargetMessage);
  useEffect(() => {
    if (!replyDockVisible) return undefined;
    const frame = window.requestAnimationFrame(() => {
      replyDockRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
      window.setTimeout(() => replyEditorControllerRef.current?.focus(), 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [replyDockVisible, replyTargetMessage?.id]);
  const conversationGridRows = inlineExpansion
    ? replyDockVisible
      ? (showConversationHeader ? "auto minmax(0, 1fr) auto" : "minmax(0, 1fr) auto")
      : (showConversationHeader ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)")
    : replyDockVisible
      ? (showConversationHeader ? "auto minmax(0, 1fr) auto" : "minmax(0, 1fr) auto")
      : (showConversationHeader ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)");

  return (
    <>
      <div ref={conversationRootRef} style={{ position: "relative", height: inlineExpansion && !replyDockVisible ? "auto" : "100%", minHeight: 0, display: "grid", gridTemplateRows: conversationGridRows, gap: inlineExpansion ? 0 : 8, padding: inlineExpansion ? (replyDockVisible ? 0 : "0 0 8px") : 9, color: surfaceText, overflow: inlineExpansion && !replyDockVisible ? "visible" : "hidden", boxSizing: "border-box" }}>
        {showConversationHeader && (
          <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
            {loading && <div style={{ padding: "6px 4px", color: accent, fontSize: 12, fontWeight: 900 }}>Loading</div>}
            {error && <div style={{ border: "1px solid rgba(185,28,28,0.24)", borderRadius: 10, background: "rgba(254,242,242,0.86)", color: "#991b1b", padding: "7px 9px", fontSize: 11, fontWeight: 850 }}>{error}</div>}
            {!inlineExpansion && message && (
              <div style={{ minWidth: 0, overflowWrap: "anywhere", padding: "0 4px", color: surfaceText, fontSize: 13.5, fontWeight: 900 }}>
                {message.subject || "(no subject)"}
              </div>
            )}
          </div>
        )}
        {message ? (
          <div
            ref={bodyRef}
            className="editor-document-scroll"
            onPointerDown={() => setSelectionDraft(null)}
            onPointerUp={captureEmailSelection}
            style={{
              position: "relative",
              minHeight: 0,
              border: inlineExpansion ? 0 : `1px solid ${strokeColor}`,
              borderRadius: inlineExpansion ? 0 : 8,
              background: "#ffffff",
              overflow: inlineExpansion && !replyDockVisible ? "visible" : "auto",
              maxHeight: undefined,
              color: "#111827",
              padding: inlineExpansion ? "0 10px" : "0 14px",
              boxShadow: inlineExpansion ? "none" : "inset 1px 1px 0 rgba(255,255,255,0.86)",
              ["--editor-document-scroll-accent" as string]: accent,
              ["--editor-document-scroll-track" as string]: "transparent",
            }}
          >
            {displayThreadMessages.map((threadMessage, index) => {
              const threadMessageID = threadMessage.id || messageID;
              const threadMessageAccent = messageAccents[threadMessageID]?.trim() || "";
              const isSelectedMessage = threadMessage.id === message.id;
              const hideInlineMessageChrome = singleMessageOnly;
              const isExpanded = singleMessageOnly || expandedThreadMessageID === threadMessageID;
              const fullThreadBody = threadMessage.body || threadMessage.snippet || "";
              const quotedContent = splitEmailQuotedHistory(fullThreadBody);
              const quotedHistoryVisible = quotedHistoryMessageIDs.has(threadMessageID);
              const displayThreadBody = quotedHistoryVisible ? fullThreadBody : quotedContent.authoredBody;
              const threadBody = emailBodyText(displayThreadBody);
              const collapsedSnippet = emailBodyText(quotedContent.authoredBody || threadMessage.snippet || "").replace(/\s+/g, " ").trim();
              const useRichThreadBody = !canUseEmailSelection || /<(?:img|table|video|audio)\b|\bcid:/i.test(threadMessage.body ?? "") || (threadMessage.attachments ?? []).some((attachment) => attachment.is_inline || Boolean(attachment.content_id));
              const threadMessageIsSent = sentReplies.some((reply) => reply.id === threadMessage.id)
                || (threadMessage.from ?? []).some((address) => Boolean(accountEmail?.trim()) && address.email.trim().toLowerCase() === accountEmail?.trim().toLowerCase())
                || (threadMessage.folders ?? []).some((folder) => folder.trim().toLowerCase() === "sent" || folder.trim().toLowerCase() === "\\sent");
              const fromLine = formatAddressList(threadMessage.from) || "Unknown sender";
              const toLine = formatAddressList(threadMessage.to) || "Me";
              const isReplyTarget = replyTargetMessage?.id === threadMessage.id;
              const relativeTime = formatEmailRelativeTime(threadMessage.date);
              return (
                <div
                  key={emailThreadMessageRenderKey(threadMessage) || `${index}`}
                  data-email-timeline-item={singleMessageOnly ? undefined : "true"}
                  data-email-message-id={threadMessage.id}
                  data-email-single-message={singleMessageOnly ? "true" : undefined}
                  data-email-message-sources={emailThreadMessageSourceLabel(threadMessage)}
                  draggable={editable && Boolean(threadMessage.email_message_id?.trim())}
                  onDragStart={(event) => {
                    if (!editable || !threadMessage.email_message_id?.trim()) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = "link";
                    event.dataTransfer.setData(EMAIL_DRAG_MIME, JSON.stringify(messageAttachmentPayload(
                      threadMessage,
                      mailboxScope.sharedInboxID,
                      mailboxScope.accountEmail,
                    )));
                    event.dataTransfer.setData("text/plain", threadMessage.subject || threadMessage.id);
                  }}
                  style={{
                    minWidth: 0,
                    display: "grid",
                    gridTemplateColumns: singleMessageOnly ? "minmax(0, 1fr)" : "20px minmax(0, 1fr)",
                    gap: 8,
                    alignItems: "stretch",
                    margin: inlineExpansion ? "8px 0" : "12px 0",
                  }}
                >
                  {!singleMessageOnly && <NodeEmailConversationTimeline expanded={isExpanded} sent={threadMessageIsSent} timelineStart={index === 0} timelineEnd={index === displayThreadMessages.length - 1} />}
                  <div
                    style={{
                      position: "relative",
                      display: "grid",
                      gap: inlineExpansion ? 5 : 7,
                      padding: hideInlineMessageChrome ? "0 8px 5px" : inlineExpansion ? "9px 10px 10px" : "13px 12px 15px",
                      borderStyle: "solid",
                      borderTopWidth: 1,
                      borderRightWidth: 1,
                      borderBottomWidth: 1,
                      borderLeftWidth: 3,
                      borderTopColor: isExpanded ? "transparent" : EDITOR_NEU_SOFT_BORDER,
                      borderRightColor: isExpanded ? "transparent" : EDITOR_NEU_SOFT_BORDER,
                      borderBottomColor: isExpanded ? "transparent" : EDITOR_NEU_SOFT_BORDER,
                      borderLeftColor: threadMessageAccent || (threadMessageIsSent ? "rgba(124,58,237,0.42)" : "rgba(14,165,233,0.42)"),
                      borderRadius: 12,
                      background: "#ffffff",
                      boxShadow: isReplyTarget && !hideInlineMessageChrome
                        ? "0 0 0 2px rgba(124,58,237,0.22), 0 0 0 3px rgba(6,182,212,0.24)"
                        : isExpanded ? EDITOR_NEU_SHADOW : "4px 4px 11px rgba(174,174,192,0.2), -4px -4px 11px rgba(255,255,255,0.82)",
                      transition: "background 140ms ease, box-shadow 160ms ease, border-color 140ms ease",
                    }}
                  >
                  {hideInlineMessageChrome && (
                    <div data-linked-email-message-metadata="true" role="group" aria-label="Linked email message details" style={{ display: "grid", gap: 3, color: "rgba(71,85,105,0.9)", fontSize: 10.5, fontWeight: 700, padding: "7px 8px", borderRadius: 8, background: `linear-gradient(90deg, ${threadMessageAccent || accent}28, ${threadMessageAccent || accent}0b 58%, rgba(255,255,255,0.96))` }}>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: surfaceText, fontSize: 12 }}>{threadMessage.subject || "(no subject)"}</strong>
                        <span style={{ flex: "0 0 auto", color: "rgba(100,116,139,0.78)" }}>{formatTimestamp(threadMessage.date)}{relativeTime ? ` (${relativeTime})` : ""}</span>
                      </div>
                      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>From:</strong> {fromLine}</div>
                      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>To:</strong> {toLine}</div>
                      {formatAddressList(threadMessage.cc) && <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>Cc:</strong> {formatAddressList(threadMessage.cc)}</div>}
                      {formatAddressList(threadMessage.bcc) && <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>Bcc:</strong> {formatAddressList(threadMessage.bcc)}</div>}
                    </div>
                  )}
                  {!hideInlineMessageChrome && (
                    <div data-email-message-header="true" style={{ display: "grid", gap: 5, padding: "7px 8px", borderRadius: 8, background: `linear-gradient(90deg, ${threadMessageAccent || accent}28, ${threadMessageAccent || accent}0b 58%, rgba(255,255,255,0.96))` }}>
                      <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr)${onMessageTextBoxRequest ? " auto" : ""} auto auto`, alignItems: "start", gap: 8 }}>
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} email from ${fromLine}`}
                          onClick={() => {
                            onMessageActivate?.(threadMessageID);
                            setExpandedThreadMessageID((current) => current === threadMessageID ? "" : threadMessageID);
                          }}
                          style={{
                            minWidth: 0,
                            display: "grid",
                            gridTemplateColumns: "auto minmax(0, 1fr) auto",
                            alignItems: "center",
                            gap: 7,
                            border: 0,
                            background: "transparent",
                            color: surfaceText,
                            cursor: "pointer",
                            padding: "2px 0",
                            textAlign: "left",
                          }}
                        >
                          <span aria-hidden="true" style={{ color: accent, fontSize: 13, fontWeight: 900 }}>{isExpanded ? "▾" : "›"}</span>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 900 }}>
                            {fromLine}
                          </span>
                          <span style={{ color: "rgba(100,116,139,0.78)", fontSize: 10.5, fontWeight: 750, whiteSpace: "nowrap" }}>
                            {formatTimestamp(threadMessage.date)}{relativeTime ? ` (${relativeTime})` : ""}
                          </span>
                        </button>
                        {onMessageTextBoxRequest && (
                          <button
                            type="button"
                            title="Create text box for this email"
                            aria-label="Create text box for this email"
                            onClick={() => onMessageTextBoxRequest(threadMessageID)}
                            style={{ minHeight: 22, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: threadMessageAccent || accent, cursor: "pointer", padding: "0 6px", display: "grid", placeItems: "center", boxShadow: "2px 2px 6px rgba(174,174,192,0.14), -2px -2px 6px rgba(255,255,255,0.78)" }}
                          >
                            <TextEditorIcon color={threadMessageAccent || accent} />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!replyEditingEnabled}
                          onClick={() => selectReplyTarget(threadMessage, false)}
                          style={{
                            minHeight: 22,
                            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                            borderRadius: 7,
                            background: EDITOR_NEU_SURFACE,
                            color: accent,
                            cursor: replyEditingEnabled ? "pointer" : "default",
                            opacity: replyEditingEnabled ? 1 : 0.46,
                            padding: "0 8px",
                            fontSize: 10.5,
                            fontWeight: 900,
                            letterSpacing: 0,
                            boxShadow: "2px 2px 6px rgba(174,174,192,0.14), -2px -2px 6px rgba(255,255,255,0.78)",
                          }}
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          disabled={!replyEditingEnabled}
                          onClick={() => selectReplyTarget(threadMessage, true)}
                          style={{
                            minHeight: 22,
                            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                            borderRadius: 7,
                            background: EDITOR_NEU_SURFACE,
                            color: accent,
                            cursor: replyEditingEnabled ? "pointer" : "default",
                            opacity: replyEditingEnabled ? 1 : 0.46,
                            padding: "0 8px",
                            fontSize: 10.5,
                            fontWeight: 900,
                            letterSpacing: 0,
                            boxShadow: "2px 2px 6px rgba(174,174,192,0.14), -2px -2px 6px rgba(255,255,255,0.78)",
                          }}
                        >
                          Reply all
                        </button>
                      </div>
                      {isExpanded ? (
                        <div role="group" aria-label="Message participants" style={{ display: "grid", gap: 2, color: "rgba(100,116,139,0.88)", fontSize: 10.5, fontWeight: 700 }}>
                          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>From:</strong> {fromLine}</div>
                          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>To:</strong> {toLine}</div>
                          {formatAddressList(threadMessage.cc) && (
                            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>Cc:</strong> {formatAddressList(threadMessage.cc)}</div>
                          )}
                          {formatAddressList(threadMessage.bcc) && (
                            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>Bcc:</strong> {formatAddressList(threadMessage.bcc)}</div>
                          )}
                        </div>
                      ) : collapsedSnippet ? (
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 11, fontWeight: 650 }}>
                          {collapsedSnippet}
                        </div>
                      ) : null}
                    </div>
                  )}
                  {isExpanded && (useRichThreadBody ? (
                    <EmailBodyFrame
                      message={threadMessage}
                      body={displayThreadBody}
                      apiBase={apiBase}
                      companyID={companyID}
                      sharedInboxID={sharedInboxID}
                      accountEmail={accountEmail}
                      collaborationID={collaborationID}
                      compact={inlineExpansion}
                      strokeColor={strokeColor}
                      accent={accent}
                      highlights={emailHighlightsByMessageID[threadMessageID] ?? []}
                      activeSelection={activeSelection?.messageID === threadMessageID ? activeSelection : null}
                      onSelectionChange={canUseEmailSelection ? (selection) => updateFrameSelection(threadMessageID, selection) : undefined}
                    />
                  ) : (
                    <div
                      ref={isSelectedMessage ? selectedEmailBodyRef : undefined}
                      {...{ [EMAIL_BODY_MESSAGE_ID_ATTRIBUTE]: threadMessageID }}
                      style={{
                        marginTop: 7,
                        color: "#111827",
                        cursor: "text",
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        userSelect: "text",
                      }}
                    >
                      {renderEmailTextWithHighlights(
                        threadBody || "(empty email)",
                        emailHighlightsByMessageID[threadMessageID] ?? [],
                        activeSelection?.messageID === threadMessageID ? activeSelection : null
                      )}
                    </div>
                  ))}
                  {isExpanded && quotedContent.hasQuotedHistory && (
                    <div
                      data-email-quoted-history-control="true"
                      style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7, flexWrap: "wrap", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: "rgba(248,250,252,0.78)", padding: "6px 7px", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.12), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
                    >
                      <span style={{ color: "rgba(100,116,139,0.82)", fontSize: 10.5, fontWeight: 700 }}>
                        {quotedHistoryVisible ? "Full provider body is visible." : "Earlier quoted messages are hidden from this reply."}
                      </span>
                      <button
                        type="button"
                        aria-expanded={quotedHistoryVisible}
                        onClick={() => {
                          setSelectionDraft(null);
                          setQuotedHistoryMessageIDs((current) => {
                            const next = new Set(current);
                            if (next.has(threadMessageID)) next.delete(threadMessageID);
                            else next.add(threadMessageID);
                            return next;
                          });
                        }}
                        style={{ minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, cursor: "pointer", padding: "3px 8px", fontSize: 10.5, fontWeight: 850, boxShadow: EDITOR_NEU_SHADOW }}
                      >
                        {quotedHistoryVisible ? "Hide quoted history" : "Show quoted history"}
                      </button>
                    </div>
                  )}
                  {isExpanded && (
                    <EmailMessageAttachments
                      message={threadMessage}
                      apiBase={apiBase}
                      companyID={companyID}
                      sharedInboxID={sharedInboxID}
                      accountEmail={accountEmail}
                      collaborationID={collaborationID}
                      respondable={providerReplyAvailable}
                      accent={accent}
                      surfaceText={surfaceText}
                      strokeColor={strokeColor}
                      onError={onError}
                    />
                  )}
                </div>
                </div>
              );
            })}
            {canUseEmailSelection && selectionDraft && (
              <div
                role="toolbar"
                aria-label="Email selection actions"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                style={{
                  position: "absolute",
                  left: selectionDraft.x,
                  top: selectionDraft.y,
                  zIndex: 4,
                  display: "grid",
                  gridTemplateColumns: `repeat(${selectionActionCount}, ${EMAIL_SELECTION_ACTION_BUTTON_SIZE}px)`,
                  gridAutoRows: `${EMAIL_SELECTION_ACTION_BUTTON_SIZE}px`,
                  alignItems: "center",
                  justifyContent: "start",
                  gap: EMAIL_SELECTION_ACTION_GAP,
                  width: selectionActionToolbarWidth,
                  minHeight: selectionActionToolbarHeight,
                  padding: EMAIL_SELECTION_ACTION_PADDING,
                  border: "1px solid transparent",
                  borderRadius: 10,
                  background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                  boxShadow: EDITOR_NEU_SHADOW,
                  boxSizing: "border-box",
                }}
              >
                {onSelectionChatRequest && (
                  <button
                    type="button"
                    title="Chat about selection"
                    aria-label="Chat about selection"
                    onClick={(event) => {
                      event.stopPropagation();
                      addEmailLocalHighlight(selectionDraft);
                      onSelectionChatRequest(selectionDraft);
                      setSelectionDraft(null);
                      bodyRef.current?.ownerDocument.getSelection()?.removeAllRanges();
                    }}
                    style={{ ...emailSelectionActionButtonStyle, color: accent }}
                  >
                    <EmailSelectionActionIconFrame>
                      <ChatIcon color={accent} />
                    </EmailSelectionActionIconFrame>
                  </button>
                )}
                {onSelectionTextBoxRequest && (
                  <button
                    type="button"
                    title="Create text box from selection"
                    aria-label="Create text box from selection"
                    onClick={(event) => {
                      event.stopPropagation();
                      addEmailLocalHighlight(selectionDraft);
                      onSelectionTextBoxRequest(selectionDraft);
                      setSelectionDraft(null);
                      bodyRef.current?.ownerDocument.getSelection()?.removeAllRanges();
                    }}
                    style={{ ...emailSelectionActionButtonStyle, color: accent }}
                  >
                    <EmailSelectionActionIconFrame>
                      <TextEditorIcon color={accent} />
                    </EmailSelectionActionIconFrame>
                  </button>
                )}
                {onSelectionNodeRequest && (
                  <button
                    type="button"
                    title="Create node from selection"
                    aria-label="Create node from selection"
                    onClick={(event) => {
                      event.stopPropagation();
                      addEmailLocalHighlight(selectionDraft);
                      onSelectionNodeRequest(selectionDraft);
                      setSelectionDraft(null);
                      bodyRef.current?.ownerDocument.getSelection()?.removeAllRanges();
                    }}
                    style={{ ...emailSelectionActionButtonStyle, color: accent }}
                  >
                    <EmailSelectionActionIconFrame>
                      <EmailSelectionCreateNodeIcon color={accent} />
                    </EmailSelectionActionIconFrame>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div aria-hidden="true" style={{ minHeight: 0 }} />
        )}
        {message && replyTargetMessage && (
          <div
            ref={replyDockRef}
            style={{
              position: "relative",
              zIndex: 2,
              display: "grid",
              gap: 7,
              margin: inlineExpansion ? "0 -10px" : 0,
              borderTop: `1px solid ${ruleColor}`,
              borderRadius: inlineExpansion ? "0 0 10px 10px" : 0,
              background: EDITOR_NEU_ACTIVE_SURFACE,
              padding: "8px 10px 10px",
              boxShadow: "0 -10px 18px rgba(248,250,252,0.92)",
              boxSizing: "border-box",
            }}
          >
            <OutboundEmailUndoBanner />
            {!inlineExpansion && (
              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 10.5, fontWeight: 800 }}>
                {replyAllMode ? "Replying all" : "Replying"} to {formatAddressList(replyTargetMessage.from) || "Unknown sender"} - {formatTimestamp(replyTargetMessage.date)}{formatEmailRelativeTime(replyTargetMessage.date) ? ` (${formatEmailRelativeTime(replyTargetMessage.date)})` : ""}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr)", gap: 6, alignItems: "center", color: surfaceText, fontSize: 10.5, fontWeight: 850 }}>
              <span>From:</span>
              <input value={senderAccountDraft} disabled={!replyEditingEnabled} onChange={(event) => setSenderAccountDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
              <span>To:</span>
              <input value={toDraft} disabled={!replyEditingEnabled} onChange={(event) => setToDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
              <span>Cc:</span>
              <input value={ccDraft} disabled={!replyEditingEnabled} onChange={(event) => setCcDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
              <span>Bcc:</span>
              <input value={bccDraft} disabled={!replyEditingEnabled} onChange={(event) => setBccDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
              <span>Subject:</span>
              <input value={subjectDraft} disabled={!replyEditingEnabled} onChange={(event) => setSubjectDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
            </div>
            {draftAttachments.length > 0 && (
              <DraftAttachmentList
                attachments={draftAttachments}
                apiBase={apiBase}
                companyID={companyID}
                surfaceText={surfaceText}
                strokeColor={strokeColor}
                onRemove={removeEmailDraftAttachment}
                onPreviewImage={setPreviewAttachment}
              />
            )}
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) 32px", alignItems: "end", gap: 6 }}>
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment"
              disabled={!replyEditingEnabled}
              onClick={() => fileInputRef.current?.click()}
              style={{ width: 32, height: 32, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: replyEditingEnabled ? "pointer" : "default", opacity: replyEditingEnabled ? 1 : 0.46, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <PlusIcon color={accent} />
            </button>
            <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <EditorTabBar
                  activeTab={replyToolbarTab}
                  outlineStyle={replyOutlineStyle}
                  accent={accent}
                  strokeColor={strokeColor}
                  surfaceText={surfaceText}
                  tabBackground={EDITOR_NEU_SURFACE}
                  tabSelectedBackground={EDITOR_NEU_ACTIVE_SURFACE}
                  outlineMenuAccent={accent}
                  onSelectTab={setReplyToolbarTab}
                  onAdjustSelectionFontSize={adjustReplyFontSize}
                  documentFontSize={replySelectionFontSize}
                  onSetSelectionFontSize={setReplyFontSize}
                  boldActive={replySelectionInlineFormat.bold}
                  underlineActive={replySelectionInlineFormat.underline}
                  italicActive={replySelectionInlineFormat.italic}
                  strikethroughActive={replySelectionInlineFormat.strikethrough}
                  highlightColor={replyHighlightColor}
                  textAlignment={replyTextAlignment}
                  onToggleBold={() => toggleReplyInlineFormat("bold")}
                  onToggleUnderline={() => toggleReplyInlineFormat("underline")}
                  onToggleItalic={() => toggleReplyInlineFormat("italic")}
                  onToggleStrikethrough={() => toggleReplyInlineFormat("strikethrough")}
                  onSetSelectionHighlightColor={setReplySelectionHighlightColor}
                  onSetTextAlignment={setReplySelectionTextAlignment}
                  onInsertTable={() => replyEditorControllerRef.current?.insertTable()}
                  onOutlineStyleFocus={() => setReplyToolbarTab("outline-styles")}
                  onOutlineStyleChange={changeReplyOutlineStyle}
                  reserveHeaderOffset={false}
                  visibleTabIDs={UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS}
                  disabled={!replyEditingEnabled}
                />
              </div>
              <UnifiedRichEditorSurface
                key={`attached-email-reply:${replyAttachmentResourceID}:${replyTargetMessageID}`}
                value={bodyDraft}
                editable={replyEditingEnabled}
                outlineStyle={replyOutlineStyle}
                surfaceID="attached-email-reply"
                ariaLabel="Reply body"
                placeholder="Write a reply"
                surfaceText={surfaceText}
                accent={accent}
                indentGuideColor={strokeColor}
                mentionUsers={companyUsers}
                formattingControllerRef={replyEditorControllerRef}
                style={{ width: "100%", height: replyEditorHeight, minHeight: replyEditorMinHeight, maxHeight: replyEditorMaxHeight, resize: replyEditingEnabled ? "vertical" : "none", overflowY: "auto", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, outline: "none", padding: "7px 8px 24px", scrollPaddingBottom: 24, color: surfaceText, background: EDITOR_NEU_ACTIVE_SURFACE, fontSize: 12, lineHeight: 1.35, letterSpacing: 0, caretColor: replyEditingEnabled ? surfaceText : "transparent", cursor: replyEditingEnabled ? "text" : "default", boxSizing: "border-box", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.18), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
                onSelectionFontSizeChange={setReplySelectionFontSize}
                onSelectionInlineFormatChange={setReplySelectionInlineFormat}
                onSelectionHighlightColorChange={setReplyHighlightColor}
                onSelectionTextAlignmentChange={setReplyTextAlignment}
                entityLinkContext={attachmentRequestJSON ? { companyID, requestJSON: attachmentRequestJSON } : undefined}
                editorImageAttachmentContext={replyEditorImageAttachmentContext}
                onEditorImageAttachmentError={(message) => {
                  setError(message);
                  onError(message);
                }}
                onFocus={onReplyEditorFocus}
                onChange={setBodyDraft}
              />
            </div>
            <button
              type="button"
              aria-label={sending ? "Sending" : "Send reply"}
              title={sending ? "Sending" : "Send reply"}
              disabled={!canSend}
              onClick={submitReply}
              style={{ width: 32, height: 32, border: canSend ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: canSend ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, borderRadius: 9, display: "grid", placeItems: "center", cursor: canSend ? "pointer" : "default", opacity: canSend ? 1 : 0.44, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <ArrowRightIcon color={accent} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              disabled={!replyEditingEnabled}
              style={{ display: "none" }}
              onChange={(event) => {
                if (event.currentTarget.files) addEmailDraftAttachments(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      )}
    </div>
    {previewAttachment && (
      <ImageAttachmentPreviewModal
        attachment={previewAttachment}
        apiBase={apiBase}
        companyID={companyID}
        onClose={() => setPreviewAttachment(null)}
      />
    )}
    </>
  );
};

function messageDocument(body: string, compact = false): string {
  return editorEmailDisplayDocument(body, { compact });
}

