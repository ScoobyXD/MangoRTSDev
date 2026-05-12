import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { getEmailMessage, listEmailMessages, type EmailAddress, type EmailMessage } from "../../pages/communications/communicationsApi";
import type { NodeProjectionItem } from "../node-map/NodeRecordStore";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockContentPayload,
  buildEditorTextBlockChatPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockContent,
  parseEditorTextBlockChats,
  type EditorAttachedEmail,
  type EditorChatAttachment,
  type EditorTextBlockContent,
  type EditorTextBlockChatMessage,
} from "./editorProjection";
import { EDITOR_AUTOSAVE_DELAY_MS, generateStableInformationID } from "./editorTypes";
import { createEditorScrollMemory } from "./editorScroll";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { DEFAULT_EDITOR_OUTLINE_STYLE } from "./plainTextEditing";
import { deserializeEditorDocumentHTML, serializeEditorDocumentHTML } from "./richTextEditing";
import { useEditorDocumentSurfaceHandlers } from "./useEditorDocumentSurfaceHandlers";

type RequestJSON = <T,>(path: string, init?: RequestInit) => Promise<T>;

type NodeWorkspaceSurfaceProps = {
  companyID: string;
  nodeID: string;
  projections: NodeProjectionItem[];
  topPx: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  requestJSON: RequestJSON;
  onProjectionMutation: () => void;
  onError: (message: string) => void;
};

type TextBlockState = {
  id: string;
  title: string;
  document: string;
  createdTimestamp: string;
  updatedTimestamp: string;
  pending: boolean;
};

type TimelineGranularity = "day" | "week" | "month" | "year";
type ChatThreadNode = {
  message: EditorTextBlockChatMessage;
  children: ChatThreadNode[];
};

const EMAIL_DRAG_MIME = "application/x-mango-email-message";
const TIMELINE_OPTIONS: TimelineGranularity[] = ["day", "week", "month", "year"];
const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const CHAT_PANE_DEFAULT_HEIGHT = 320;
const CHAT_PANE_MIN_HEIGHT = 220;
const CHAT_PANE_MAX_HEIGHT = 760;

function projectionsKey(items: NodeProjectionItem[]): string {
  return items.map((item) => `${item.information_id}:${item.type}:${item.updated_timestamp}`).join("|");
}

function formatAddressList(addresses?: EmailAddress[]): string {
  if (!addresses?.length) return "";
  return addresses
    .map((address) => {
      const name = (address.name ?? "").trim();
      return name ? `${name} <${address.email}>` : address.email;
    })
    .join(", ");
}

function formatTimestamp(value: string | number | undefined, granularity: TimelineGranularity = "day"): string {
  if (value === undefined || value === "") return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = granularity === "year"
    ? { year: "numeric" }
    : granularity === "month"
      ? { month: "short", year: "numeric" }
      : granularity === "week"
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function messageAttachmentPayload(message: EmailMessage): {
  messageID: string;
  threadID?: string;
  subject: string;
  snippet?: string;
  from?: string;
  date?: number;
  attachedTimestamp: string;
} {
  return {
    messageID: message.id,
    threadID: message.thread_id,
    subject: message.subject || "(no subject)",
    snippet: message.snippet,
    from: formatAddressList(message.from),
    date: message.date,
    attachedTimestamp: new Date().toISOString(),
  };
}

function parseDraggedEmail(dataTransfer: DataTransfer): ReturnType<typeof messageAttachmentPayload> | null {
  const raw = dataTransfer.getData(EMAIL_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReturnType<typeof messageAttachmentPayload>;
    return parsed.messageID ? parsed : null;
  } catch {
    return null;
  }
}

function useCloseFloatingMenu(open: boolean, ref: React.RefObject<HTMLElement>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => window.addEventListener("mousedown", onMouseDown, true), 0);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, ref]);
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function readChatAttachment(file: File): Promise<EditorChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("failed_to_read_attachment"));
    reader.onload = () => {
      resolve({
        id: generateStableInformationID(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataURL: typeof reader.result === "string" ? reader.result : undefined,
      });
    };
    reader.readAsDataURL(file);
  });
}

function imageFilesFromTransfer(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    if (file.type.startsWith("image/")) files.push(file);
  }
  if (files.length > 0 || !dataTransfer.items) return files;
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function isImageAttachment(attachment: EditorChatAttachment): boolean {
  return attachment.type.startsWith("image/") && Boolean(attachment.dataURL?.startsWith("data:image/"));
}

function clampChatPaneHeight(value: number): number {
  if (!Number.isFinite(value)) return CHAT_PANE_DEFAULT_HEIGHT;
  return Math.max(CHAT_PANE_MIN_HEIGHT, Math.min(Math.round(value), CHAT_PANE_MAX_HEIGHT));
}

function readStoredChatPaneHeight(storageKey: string): number {
  if (typeof localStorage === "undefined") return CHAT_PANE_DEFAULT_HEIGHT;
  return clampChatPaneHeight(Number.parseInt(localStorage.getItem(storageKey) ?? "", 10));
}

function storeChatPaneHeight(storageKey: string, height: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey, String(clampChatPaneHeight(height)));
}

function chatParentCreatesCycle(nodes: Map<string, ChatThreadNode>, childID: string, parentID: string): boolean {
  const seen = new Set<string>();
  let cursor = parentID;
  while (cursor) {
    if (cursor === childID) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = nodes.get(cursor)?.message.parentID ?? "";
  }
  return false;
}

function buildChatThreads(messages: EditorTextBlockChatMessage[]): ChatThreadNode[] {
  const nodes = new Map<string, ChatThreadNode>();
  for (const message of messages) nodes.set(message.id, { message, children: [] });
  const roots: ChatThreadNode[] = [];
  for (const message of messages) {
    const node = nodes.get(message.id);
    if (!node) continue;
    const parentID = message.parentID ?? "";
    const parent = parentID ? nodes.get(parentID) : null;
    if (!parent || chatParentCreatesCycle(nodes, message.id, parentID)) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

function avatarBackgroundForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 360;
  return `hsl(${hash}, 68%, 86%)`;
}

const ChatIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M4.2 4h9.6a1.8 1.8 0 0 1 1.8 1.8v4.9a1.8 1.8 0 0 1-1.8 1.8H8.2L4 15v-2.5A1.8 1.8 0 0 1 2.2 10.7V5.8A1.8 1.8 0 0 1 4.2 4Z" fill="none" stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
  </svg>
);

const PlusIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ArrowRightIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M3 8h9M8.7 4.2 12.5 8l-3.8 3.8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DisclosureIcon: React.FC<{ open: boolean; color: string }> = ({ open, color }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
    <path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M3.2 8.2 6.4 11.4 12.9 4.6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MailIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.8 5.1h12.4v8H2.8z" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="m3.4 5.7 5.6 4.1 5.6-4.1" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type TimelineGranularitySelectProps = {
  value: TimelineGranularity;
  onChange: (value: TimelineGranularity) => void;
  accent: string;
  surfaceText: string;
  panelBackground: string;
};

const TimelineGranularitySelect: React.FC<TimelineGranularitySelectProps> = ({
  value,
  onChange,
  accent,
  surfaceText,
  panelBackground,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseFloatingMenu(open, rootRef, close);
  return (
    <div ref={rootRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        type="button"
        aria-label="Timeline granularity"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{
          width: "100%",
          minHeight: 30,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 16px",
          alignItems: "center",
          gap: 5,
          border: `1px solid ${open ? accent : "rgba(255, 136, 32, 0.44)"}`,
          borderRadius: 6,
          background: panelBackground,
          color: surfaceText,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0,
          padding: "0 8px",
          textAlign: "left",
          textTransform: "capitalize",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: accent }}>
          <DisclosureIcon open={open} color={accent} />
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Timeline granularity"
          className="company-explorer-scroll"
          style={{
            position: "absolute",
            zIndex: 40,
            top: "calc(100% + 6px)",
            left: 0,
            width: "min(148px, 64vw)",
            maxHeight: 220,
            overflowY: "auto",
            overflowX: "hidden",
            padding: 5,
            border: "1px solid rgba(255, 136, 32, 0.58)",
            borderRadius: 8,
            background: "#ffffff",
            color: "#000000",
            boxShadow: "0 12px 28px rgba(0,0,0,0.14), 0 0 0 1px rgba(255,136,32,0.12) inset",
          }}
        >
          {TIMELINE_OPTIONS.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  minHeight: 32,
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 18px",
                  alignItems: "center",
                  gap: 8,
                  border: "none",
                  borderRadius: 6,
                  background: selected ? "rgba(255, 136, 32, 0.18)" : "#ffffff",
                  color: "#000000",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0,
                  padding: "7px 8px",
                  textAlign: "left",
                  textTransform: "capitalize",
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option}</span>
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center" }}>{selected ? <CheckIcon color={accent} /> : null}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const NodeWorkspaceSurface: React.FC<NodeWorkspaceSurfaceProps> = ({
  companyID,
  nodeID,
  projections,
  topPx,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  scrollbarAccent,
  scrollbarTrack,
  requestJSON,
  onProjectionMutation,
  onError,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saveTimersRef = useRef(new Map<string, number>());
  const contentByBlockRef = useRef(new Map<string, EditorTextBlockContent>());
  const focusBlockIDRef = useRef("");
  const previousNodeIDRef = useRef(nodeID);
  const [width, setWidth] = useState(0);
  const [blocks, setBlocks] = useState<TextBlockState[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [activeChatBlockID, setActiveChatBlockID] = useState("");
  const [closedChatBlockIDs, setClosedChatBlockIDs] = useState<Set<string>>(() => new Set());
  const [focusedTextBlockID, setFocusedTextBlockID] = useState("");
  const [timelineGranularity, setTimelineGranularity] = useState<TimelineGranularity>("day");
  const [emailPickerOpen, setEmailPickerOpen] = useState(false);
  const [selectedEmailID, setSelectedEmailID] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [author, setAuthor] = useState({ userID: "", name: "You" });

  const projectionIdentity = useMemo(() => projectionsKey(projections), [projections]);
  const compact = width > 0 && width < 720;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateWidth = () => setWidth(root.getBoundingClientRect().width);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const textBlocks = listEditorTextBlockProjections(projections).map((item) => {
      const content = parseEditorTextBlockContent(item.information);
      return {
        id: item.information_id,
        title: content.title,
        document: content.document,
        createdTimestamp: item.created_timestamp,
        updatedTimestamp: item.updated_timestamp,
        pending: false,
      };
    });
    const parsedChatMessages = parseEditorTextBlockChats(projections);
    setBlocks(textBlocks);
    contentByBlockRef.current = new Map(textBlocks.map((block) => [block.id, { title: block.title, document: block.document }]));
    setChatMessages(parsedChatMessages);
    setAttachedEmails(parseEditorAttachedEmails(projections));
    const nodeChanged = previousNodeIDRef.current !== nodeID;
    previousNodeIDRef.current = nodeID;
    const blockIDs = new Set(textBlocks.map((block) => block.id));
    const messageIDsByBlock = new Map<string, Set<string>>();
    for (const message of parsedChatMessages) {
      const messageIDs = messageIDsByBlock.get(message.blockID) ?? new Set<string>();
      messageIDs.add(message.id);
      messageIDsByBlock.set(message.blockID, messageIDs);
    }
    setChatDrafts((current) => nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id))));
    setChatDraftAttachments((current) => nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id))));
    setChatReplyTargets((current) => {
      if (nodeChanged) return {};
      return Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => Boolean(messageIDsByBlock.get(blockID)?.has(messageID))));
    });
    setActiveChatBlockID((current) => (nodeChanged || !blockIDs.has(current) ? "" : current));
    setClosedChatBlockIDs((current) => {
      if (nodeChanged) return new Set();
      return new Set(Array.from(current).filter((id) => blockIDs.has(id)));
    });
    setFocusedTextBlockID((current) => (nodeChanged || !blockIDs.has(current) ? "" : current));
  }, [nodeID, projectionIdentity, projections]);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((payload) => {
        if (cancelled) return;
        const name = payload.user.display_name?.trim() || payload.user.email?.trim() || "You";
        setAuthor({ userID: payload.user.user_id, name });
      })
      .catch(() => {
        if (!cancelled) setAuthor({ userID: "", name: "You" });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
    saveTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!focusBlockIDRef.current) return;
    const blockID = focusBlockIDRef.current;
    focusBlockIDRef.current = "";
    window.requestAnimationFrame(() => {
      const editor = rootRef.current?.querySelector<HTMLElement>(`[data-node-text-block-id="${blockID}"]`);
      editor?.focus({ preventScroll: true });
    });
  }, [blocks.length]);

  const persistTextBlock = useCallback(async (blockID: string, content: EditorTextBlockContent) => {
    if (!nodeID || !companyID) return;
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, pending: true } : block));
    try {
      const information = buildEditorTextBlockContentPayload(content);
      if (information.trim()) {
        await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
          method: "POST",
          body: JSON.stringify({
            company_id: companyID,
            type: EDITOR_TEXT_BLOCK_TYPE,
            information,
            information_id: blockID,
          }),
        });
      } else {
        await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${blockID}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      }
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_text_block");
    } finally {
      setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, pending: false } : block));
    }
  }, [companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const flushTextBlockSave = useCallback((blockID: string) => {
    const timer = saveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(blockID);
    }
    void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "" });
  }, [persistTextBlock]);

  const scheduleTextBlockSave = useCallback((blockID: string, content: EditorTextBlockContent) => {
    contentByBlockRef.current.set(blockID, content);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "" });
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [persistTextBlock]);

  const createTextBlock = useCallback(() => {
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    focusBlockIDRef.current = blockID;
    contentByBlockRef.current.set(blockID, { title: "", document: "" });
    setBlocks((current) => [
      {
        id: blockID,
        title: "",
        document: "",
        createdTimestamp: now,
        updatedTimestamp: now,
        pending: false,
      },
      ...current,
    ]);
  }, []);

  const updateTextBlockContent = useCallback((blockID: string, patch: Partial<EditorTextBlockContent>) => {
    const existing = contentByBlockRef.current.get(blockID) ?? { title: "", document: "" };
    const nextContent: EditorTextBlockContent = {
      title: patch.title ?? existing.title,
      document: patch.document ?? existing.document,
    };
    setBlocks((current) => current.map((block) => {
      if (block.id !== blockID) return block;
      return { ...block, ...nextContent, updatedTimestamp: new Date().toISOString() };
    }));
    scheduleTextBlockSave(blockID, nextContent);
  }, [scheduleTextBlockSave]);

  const submitChat = useCallback(async (blockID: string) => {
    const message = (chatDrafts[blockID] ?? "").trim();
    const attachments = chatDraftAttachments[blockID] ?? [];
    if (!message && attachments.length === 0) return;
    const now = new Date().toISOString();
    const id = generateStableInformationID();
    const parentID = chatReplyTargets[blockID] ?? "";
    const nextMessage: EditorTextBlockChatMessage = {
      id,
      blockID,
      parentID: parentID || undefined,
      authorID: author.userID,
      authorName: author.name,
      message,
      createdTimestamp: now,
      attachments,
    };
    setChatDrafts((current) => ({ ...current, [blockID]: "" }));
    setChatDraftAttachments((current) => {
      if (!current[blockID]?.length) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatReplyTargets((current) => {
      if (!current[blockID]) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatMessages((current) => [...current, nextMessage]);
    setClosedChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          information: buildEditorTextBlockChatPayload({
            blockID,
            parentID,
            authorID: author.userID,
            authorName: author.name,
            message,
            createdTimestamp: now,
            attachments,
          }),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_chat_message");
    }
  }, [author.name, author.userID, chatDraftAttachments, chatDrafts, chatReplyTargets, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const addChatDraftAttachments = useCallback(async (blockID: string, files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    const existingBytes = (chatDraftAttachments[blockID] ?? []).reduce((total, attachment) => total + attachment.size, 0);
    let nextBytes = existingBytes;
    const accepted: File[] = [];
    for (const file of candidates) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        onError(`${file.name} is larger than ${formatFileSize(CHAT_ATTACHMENT_MAX_BYTES)}.`);
        continue;
      }
      if (nextBytes + file.size > CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES) {
        onError(`Chat attachments are limited to ${formatFileSize(CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES)} per message.`);
        break;
      }
      accepted.push(file);
      nextBytes += file.size;
    }
    if (accepted.length === 0) return;
    try {
      const attachments = await Promise.all(accepted.map(readChatAttachment));
      setChatDraftAttachments((current) => ({
        ...current,
        [blockID]: [...(current[blockID] ?? []), ...attachments],
      }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_read_attachment");
    }
  }, [chatDraftAttachments, onError]);

  const removeChatDraftAttachment = useCallback((blockID: string, attachmentID: string) => {
    setChatDraftAttachments((current) => {
      const nextAttachments = (current[blockID] ?? []).filter((attachment) => attachment.id !== attachmentID);
      if (nextAttachments.length === 0) {
        const next = { ...current };
        delete next[blockID];
        return next;
      }
      return { ...current, [blockID]: nextAttachments };
    });
  }, []);

  const attachEmail = useCallback(async (email: ReturnType<typeof messageAttachmentPayload>) => {
    if (attachedEmails.some((item) => item.messageID === email.messageID)) {
      setEmailPickerOpen(false);
      return;
    }
    const id = generateStableInformationID();
    const attached: EditorAttachedEmail = {
      id,
      messageID: email.messageID,
      threadID: email.threadID,
      subject: email.subject,
      snippet: email.snippet,
      from: email.from,
      date: email.date,
      attachedTimestamp: email.attachedTimestamp,
    };
    setAttachedEmails((current) => [attached, ...current]);
    setEmailPickerOpen(false);
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_ATTACHED_EMAIL_TYPE,
          information: buildEditorAttachedEmailPayload(email),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_attach_email");
    }
  }, [attachedEmails, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const onDropEmail = useCallback((event: React.DragEvent) => {
    const email = parseDraggedEmail(event.dataTransfer);
    if (!email) return;
    event.preventDefault();
    setDropActive(false);
    void attachEmail({ ...email, attachedTimestamp: new Date().toISOString() });
  }, [attachEmail]);

  const chatMessagesByBlock = useMemo(() => {
    const grouped = new Map<string, EditorTextBlockChatMessage[]>();
    for (const message of chatMessages) {
      const blockMessages = grouped.get(message.blockID) ?? [];
      blockMessages.push(message);
      grouped.set(message.blockID, blockMessages);
    }
    return grouped;
  }, [chatMessages]);

  const timelineRows = useMemo(() => blocks.map((block, index) => ({
    id: block.id,
    label: formatTimestamp(block.createdTimestamp, timelineGranularity) || `Block ${index + 1}`,
    count: (chatMessagesByBlock.get(block.id)?.length ?? 0),
  })), [blocks, chatMessagesByBlock, timelineGranularity]);

  return (
    <div
      ref={rootRef}
      className="editor-document-scroll"
      onWheel={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: topPx,
        right: 0,
        bottom: 0,
        left: 0,
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarGutter: "stable",
        padding: "0 14px 38px 14px",
        cursor: "default",
        ["--editor-document-scroll-accent" as string]: scrollbarAccent,
        ["--editor-document-scroll-track" as string]: scrollbarTrack,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: compact ? "72px minmax(0, 1fr)" : "94px minmax(0, 1fr) minmax(0, 0.42fr)", columnGap: compact ? 10 : 14, rowGap: 12, alignItems: "start", minWidth: 0 }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, padding: "2px 0 10px", background: "inherit" }}>
          <TimelineGranularitySelect
            value={timelineGranularity}
            onChange={setTimelineGranularity}
            accent={accent}
            surfaceText={surfaceText}
            panelBackground={panelBackground}
          />
        </div>

        <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 8, padding: "2px 0 10px", background: "inherit" }}>
          <button
            type="button"
            title="Add text box"
            onClick={createTextBlock}
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              border: `1px solid ${accent}`,
              background: panelBackground,
              color: accent,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            <PlusIcon color={accent} />
          </button>
          <button
            type="button"
            onClick={() => setEmailPickerOpen(true)}
            style={{
              minHeight: 30,
              borderRadius: 6,
              border: `1px solid ${strokeColor}`,
              background: panelBackground,
              color: surfaceText,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "0 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0,
            }}
          >
            <MailIcon color={accent} />
            Attach email
          </button>
        </div>

        {!compact && (
          <div style={{ position: "sticky", top: 0, zIndex: 2, minHeight: 32, borderBottom: `1px solid ${ruleColor}`, background: "inherit" }} />
        )}

        {blocks.length === 0 && (
          <>
            <TimelineCell label="" count={0} accent={accent} muted />
            <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, minHeight: 92, display: "grid", placeItems: "center", color: surfaceText, opacity: 0.7, fontSize: 13, fontWeight: 700 }}>
              No text boxes
            </div>
            {!compact && <div />}
          </>
        )}

        {blocks.map((block, index) => {
          const messages = chatMessagesByBlock.get(block.id) ?? [];
          const chatIsActive = activeChatBlockID === block.id;
          const chatIsVisible = chatIsActive || (messages.length > 0 && !closedChatBlockIDs.has(block.id));
          const textBlockIsFocused = focusedTextBlockID === block.id;
          const toggleChat = () => {
            setFocusedTextBlockID("");
            const nextOpen = !chatIsVisible;
            setClosedChatBlockIDs((closed) => {
              const next = new Set(closed);
              if (nextOpen) next.delete(block.id);
              else next.add(block.id);
              return next;
            });
            setActiveChatBlockID(nextOpen ? block.id : "");
          };
          const focusChat = () => {
            setFocusedTextBlockID("");
            setClosedChatBlockIDs((current) => {
              if (!current.has(block.id)) return current;
              const next = new Set(current);
              next.delete(block.id);
              return next;
            });
            setActiveChatBlockID(block.id);
          };
          const replyToMessage = (messageID: string) => {
            focusChat();
            setChatReplyTargets((current) => ({ ...current, [block.id]: messageID }));
          };
          const clearReplyTarget = () => {
            setChatReplyTargets((current) => {
              if (!current[block.id]) return current;
              const next = { ...current };
              delete next[block.id];
              return next;
            });
          };
          return (
            <React.Fragment key={block.id}>
              <TimelineCell label={timelineRows[index]?.label ?? ""} count={timelineRows[index]?.count ?? 0} accent={accent} muted={false} />
              <div style={{ minWidth: 0 }}>
                <div style={{ border: `1px solid ${textBlockIsFocused ? accent : strokeColor}`, borderRadius: 8, background: "rgba(255,255,255,0.72)", overflow: "hidden", boxShadow: textBlockIsFocused ? "0 0 0 2px rgba(255,136,32,0.14), 0 6px 18px rgba(0,0,0,0.05)" : "0 6px 18px rgba(0,0,0,0.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 32, borderBottom: `1px solid ${ruleColor}`, padding: "6px 8px", background: panelBackground }}>
                    <input
                      value={block.title}
                      onFocus={() => {
                        setFocusedTextBlockID(block.id);
                        setActiveChatBlockID("");
                      }}
                      onChange={(event) => updateTextBlockContent(block.id, { title: event.currentTarget.value })}
                      onBlur={() => flushTextBlockSave(block.id)}
                      placeholder={formatTimestamp(block.createdTimestamp) || `Text box ${index + 1}`}
                      style={{
                        minWidth: 0,
                        width: "100%",
                        border: 0,
                        outline: "none",
                        background: "transparent",
                        color: surfaceText,
                        opacity: block.title ? 0.9 : 0.68,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: 0,
                      }}
                    />
                    <button
                      type="button"
                      title={chatIsVisible ? "Hide chat" : "Open chat"}
                      onClick={toggleChat}
                      style={{ width: 26, height: 24, borderRadius: 5, border: `1px solid ${chatIsActive ? accent : strokeColor}`, background: chatIsActive ? accent : "#ffffff", color: chatIsActive ? "#ffffff" : accent, display: "grid", placeItems: "center", cursor: "pointer", flex: "0 0 auto" }}
                    >
                      <ChatIcon color={chatIsActive ? "#ffffff" : accent} />
                    </button>
                  </div>
                  <NodeTextBlockEditor
                    blockID={block.id}
                    nodeID={nodeID}
                    companyID={companyID}
                    documentValue={block.document}
                    surfaceText={surfaceText}
                    accent={accent}
                    scrollbarTrack={scrollbarTrack}
                    onFocus={() => {
                      setFocusedTextBlockID(block.id);
                      setActiveChatBlockID("");
                    }}
                    onBlur={() => {
                      setFocusedTextBlockID((current) => current === block.id ? "" : current);
                    }}
                    onDocumentChange={(document) => updateTextBlockContent(block.id, { document })}
                    onDocumentFlush={(document) => {
                      updateTextBlockContent(block.id, { document });
                      flushTextBlockSave(block.id);
                    }}
                  />
                </div>
                {compact && chatIsVisible && (
                  <ChatPane
                    blockID={block.id}
                    messages={messages}
                    draft={chatDrafts[block.id] ?? ""}
                    active={chatIsActive}
                    accent={accent}
                    surfaceText={surfaceText}
                    panelBackground={panelBackground}
                    strokeColor={strokeColor}
                    ruleColor={ruleColor}
                    replyTargetID={chatReplyTargets[block.id] ?? ""}
                    draftAttachments={chatDraftAttachments[block.id] ?? []}
                    heightStorageKey={`node-editor-chat-pane-height-v1:${companyID}:${nodeID}:${block.id}`}
                    onFocus={focusChat}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                    onReply={replyToMessage}
                    onClearReply={clearReplyTarget}
                    onAttachFiles={(files) => { void addChatDraftAttachments(block.id, files); }}
                    onRemoveDraftAttachment={(attachmentID) => removeChatDraftAttachment(block.id, attachmentID)}
                    onSubmit={() => { void submitChat(block.id); }}
                  />
                )}
              </div>
              {!compact && (
                chatIsVisible ? (
                  <ChatPane
                    blockID={block.id}
                    messages={messages}
                    draft={chatDrafts[block.id] ?? ""}
                    active={chatIsActive}
                    accent={accent}
                    surfaceText={surfaceText}
                    panelBackground={panelBackground}
                    strokeColor={strokeColor}
                    ruleColor={ruleColor}
                    replyTargetID={chatReplyTargets[block.id] ?? ""}
                    draftAttachments={chatDraftAttachments[block.id] ?? []}
                    heightStorageKey={`node-editor-chat-pane-height-v1:${companyID}:${nodeID}:${block.id}`}
                    onFocus={focusChat}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                    onReply={replyToMessage}
                    onClearReply={clearReplyTarget}
                    onAttachFiles={(files) => { void addChatDraftAttachments(block.id, files); }}
                    onRemoveDraftAttachment={(attachmentID) => removeChatDraftAttachment(block.id, attachmentID)}
                    onSubmit={() => { void submitChat(block.id); }}
                  />
                ) : <div />
              )}
            </React.Fragment>
          );
        })}

        <div />
        <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
          <div
            onDragEnter={() => setDropActive(true)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(EMAIL_DRAG_MIME)) event.preventDefault();
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={onDropEmail}
            style={{
              minHeight: 58,
              border: `1px ${dropActive ? "solid" : "dashed"} ${dropActive ? accent : strokeColor}`,
              borderRadius: 8,
              background: dropActive ? "rgba(255,136,32,0.08)" : panelBackground,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              color: surfaceText,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <MailIcon color={accent} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Attach email</span>
            </span>
            <button
              type="button"
              onClick={() => setEmailPickerOpen(true)}
              style={{ border: `1px solid ${accent}`, background: "#ffffff", color: accent, borderRadius: 6, padding: "5px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer", flex: "0 0 auto" }}
            >
              Add email
            </button>
          </div>
          <AttachedEmailsPanel emails={attachedEmails} accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} onOpenEmail={setSelectedEmailID} />
        </div>
        {!compact && <div />}
      </div>

      {emailPickerOpen && (
        <EmailPickerModal
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          strokeColor={strokeColor}
          onClose={() => setEmailPickerOpen(false)}
          onAttach={(message) => { void attachEmail(messageAttachmentPayload(message)); }}
        />
      )}
      {selectedEmailID && (
        <EmailDetailModal
          messageID={selectedEmailID}
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          strokeColor={strokeColor}
          onClose={() => setSelectedEmailID("")}
        />
      )}
    </div>
  );
};

type TimelineCellProps = {
  label: string;
  count: number;
  accent: string;
  muted: boolean;
};

const TimelineCell: React.FC<TimelineCellProps> = ({ label, count, accent, muted }) => (
  <div style={{ position: "relative", minHeight: 108, paddingTop: 9, color: "inherit" }}>
    <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: -16, left: 15, width: 1, background: muted ? "rgba(100,116,139,0.18)" : "rgba(255,136,32,0.35)" }} />
    <div aria-hidden="true" style={{ position: "relative", width: 31, height: 31, borderRadius: 999, border: `2px solid ${muted ? "rgba(100,116,139,0.28)" : accent}`, background: "#ffffff", boxShadow: "0 0 0 4px rgba(255,136,32,0.08)" }} />
    {label && (
      <div style={{ marginTop: 6, fontSize: 10, fontWeight: 800, lineHeight: 1.2, letterSpacing: 0, overflowWrap: "anywhere" }}>
        {label}
        {count > 0 && <div style={{ opacity: 0.58 }}>{count} chat</div>}
      </div>
    )}
  </div>
);

type NodeTextBlockEditorProps = {
  blockID: string;
  nodeID: string;
  companyID: string;
  documentValue: string;
  surfaceText: string;
  accent: string;
  scrollbarTrack: string;
  onFocus: () => void;
  onBlur: () => void;
  onDocumentChange: (document: string) => void;
  onDocumentFlush: (document: string) => void;
};

function readStoredTextBlockHeight(storageKey: string): number {
  if (typeof localStorage === "undefined") return 120;
  const parsed = Number.parseInt(localStorage.getItem(storageKey) ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(120, Math.min(parsed, 900)) : 120;
}

function storeTextBlockHeight(storageKey: string, height: number) {
  if (typeof localStorage === "undefined" || !Number.isFinite(height)) return;
  localStorage.setItem(storageKey, String(Math.max(120, Math.min(Math.round(height), 900))));
}

const NodeTextBlockEditor: React.FC<NodeTextBlockEditorProps> = ({
  blockID,
  nodeID,
  companyID,
  documentValue,
  surfaceText,
  accent,
  scrollbarTrack,
  onFocus,
  onBlur,
  onDocumentChange,
  onDocumentFlush,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const restoringScrollRef = useRef(false);
  const documentTargetKey = `node-text-block:${nodeID}:${blockID}`;
  const targetKeyRef = useRef(documentTargetKey);
  const loadedDocumentTargetKeyRef = useRef(documentTargetKey);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
  const documentUndoHistoryRef = useRef(createEditorDocumentUndoHistory());
  const pendingFontSizeRef = useRef<number | null>(null);
  const lastAppliedDocumentRef = useRef("");
  const lastStoredHeightRef = useRef(0);
  const heightStorageKey = `node-editor-text-block-height-v1:${companyID}:${nodeID}:${blockID}`;
  const [height, setHeight] = useState(() => readStoredTextBlockHeight(heightStorageKey));
  const [, setDocumentScrollTop] = useState(0);

  useEffect(() => {
    targetKeyRef.current = documentTargetKey;
  }, [documentTargetKey]);

  useEffect(() => {
    const nextHeight = readStoredTextBlockHeight(heightStorageKey);
    lastStoredHeightRef.current = nextHeight;
    setHeight(nextHeight);
  }, [heightStorageKey]);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    const nextHTML = deserializeEditorDocumentHTML(documentValue);
    const targetChanged = loadedDocumentTargetKeyRef.current !== documentTargetKey;
    if (!targetChanged && documentValue === lastAppliedDocumentRef.current && element.innerHTML === nextHTML) return;
    element.innerHTML = nextHTML;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    lastAppliedDocumentRef.current = documentValue;
    loadedDocumentTargetKeyRef.current = documentTargetKey;
  }, [documentTargetKey, documentValue]);

  useEffect(() => {
    const element = editorRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const nextHeight = Math.round(element.getBoundingClientRect().height);
      if (!Number.isFinite(nextHeight) || Math.abs(nextHeight - lastStoredHeightRef.current) < 2) return;
      lastStoredHeightRef.current = nextHeight;
      setHeight(nextHeight);
      storeTextBlockHeight(heightStorageKey, nextHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [heightStorageKey]);

  const handlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef: targetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef: pendingFontSizeRef,
    outlineStyle: DEFAULT_EDITOR_OUTLINE_STYLE,
    setDocumentScrollTop,
    scheduleDocumentSave: (nextDocument, immediate = false) => {
      lastAppliedDocumentRef.current = nextDocument;
      onDocumentChange(nextDocument);
      if (immediate) onDocumentFlush(nextDocument);
    },
    scheduleIndentGuideUpdate: () => undefined,
    rememberCurrentDocumentScroll: () => undefined,
    flushPendingDocumentSave: (fallbackDocument) => {
      const nextDocument = fallbackDocument ?? (editorRef.current ? serializeEditorDocumentHTML(editorRef.current) : lastAppliedDocumentRef.current);
      lastAppliedDocumentRef.current = nextDocument;
      onDocumentFlush(nextDocument);
    },
    onSelectionFontSizeChange: () => undefined,
  });

  const handleBlur: React.FocusEventHandler<HTMLDivElement> = (event) => {
    handlers.onBlur(event);
    onBlur();
  };

  return (
    <div
      ref={editorRef}
      className="editor-document-scroll"
      data-node-text-block-id={blockID}
      role="textbox"
      aria-label="Node text block"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onFocus={onFocus}
      onBeforeInput={handlers.onBeforeInput}
      onPaste={handlers.onPaste}
      onDrop={handlers.onDrop}
      onInput={handlers.onInput}
      onSelect={handlers.onSelect}
      onClick={handlers.onClick}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onKeyUp={handlers.onKeyUp}
      onBlur={handleBlur}
      onScroll={handlers.onScroll}
      onWheel={handlers.onWheel}
      onKeyDown={handlers.onKeyDown}
      style={{
        display: "block",
        width: "100%",
        height,
        minHeight: 120,
        maxHeight: 900,
        resize: "vertical",
        border: 0,
        outline: "none",
        padding: "12px 13px",
        boxSizing: "border-box",
        color: surfaceText,
        background: "#ffffff",
        fontSize: 14,
        lineHeight: 1.45,
        letterSpacing: 0,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        overflowY: "auto",
        overflowX: "hidden",
        cursor: "text",
        ["--editor-document-scroll-accent" as string]: accent,
        ["--editor-document-scroll-track" as string]: scrollbarTrack,
      }}
    />
  );
};

type ChatPaneProps = {
  blockID: string;
  messages: EditorTextBlockChatMessage[];
  draft: string;
  draftAttachments: EditorChatAttachment[];
  replyTargetID: string;
  heightStorageKey: string;
  active: boolean;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  onFocus: () => void;
  onDraftChange: (draft: string) => void;
  onReply: (messageID: string) => void;
  onClearReply: () => void;
  onAttachFiles: (files: FileList | File[]) => void;
  onRemoveDraftAttachment: (attachmentID: string) => void;
  onSubmit: () => void;
};

const ChatPane: React.FC<ChatPaneProps> = ({
  blockID,
  messages,
  draft,
  draftAttachments,
  replyTargetID,
  heightStorageKey,
  active,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  onFocus,
  onDraftChange,
  onReply,
  onClearReply,
  onAttachFiles,
  onRemoveDraftAttachment,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threads = useMemo(() => buildChatThreads(messages), [messages]);
  const replyTarget = replyTargetID ? messages.find((message) => message.id === replyTargetID) : undefined;
  const lineCount = Math.min(5, Math.max(1, draft.split(/\r\n|\r|\n/).length));
  const composerHeight = 34 + ((lineCount - 1) * 17);
  const canSubmit = draft.trim().length > 0 || draftAttachments.length > 0;
  const [height, setHeight] = useState(() => readStoredChatPaneHeight(heightStorageKey));
  const [previewAttachment, setPreviewAttachment] = useState<EditorChatAttachment | null>(null);

  useEffect(() => {
    setHeight(readStoredChatPaneHeight(heightStorageKey));
  }, [heightStorageKey]);

  useEffect(() => {
    if (!replyTargetID) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [replyTargetID]);

  const focusComposer = () => {
    onFocus();
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleReply = (messageID: string) => {
    onReply(messageID);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const attachTransferredImages = (dataTransfer: DataTransfer): boolean => {
    const files = imageFilesFromTransfer(dataTransfer);
    if (files.length === 0) return false;
    onAttachFiles(files);
    return true;
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = height;
    let nextHeight = startHeight;
    const onPointerMove = (pointerEvent: PointerEvent) => {
      nextHeight = clampChatPaneHeight(startHeight + pointerEvent.clientY - startY);
      setHeight(nextHeight);
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
          onFocus();
        }}
        style={{
          minWidth: 0,
          height,
          marginTop: 0,
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto 7px",
          border: `1px solid ${active ? accent : strokeColor}`,
          borderRadius: 8,
          background: active ? "#ffffff" : panelBackground,
          overflow: "hidden",
          opacity: active || messages.length > 0 ? 1 : 0.72,
        }}
      >
        <div style={{ minHeight: 30, display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${ruleColor}`, padding: "6px 8px", color: surfaceText, fontSize: 11, fontWeight: 800 }}>
          <ChatIcon color={active ? accent : "rgba(100,116,139,0.85)"} />
          <span>{messages.length}</span>
        </div>
        <div className="editor-document-scroll" style={{ minHeight: 0, display: "grid", alignContent: "start", gap: 8, overflowY: "auto", overflowX: "hidden", padding: "9px 8px", ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
          {threads.map((thread) => (
            <ChatThreadItem
              key={thread.message.id}
              node={thread}
              depth={0}
              accent={accent}
              surfaceText={surfaceText}
              ruleColor={ruleColor}
              onReply={handleReply}
              onPreviewImage={setPreviewAttachment}
            />
          ))}
        </div>
        <div style={{ display: "grid", gap: 6, padding: 8, borderTop: `1px solid ${ruleColor}` }}>
          {draftAttachments.length > 0 && (
            <DraftAttachmentList
              attachments={draftAttachments}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              onRemove={onRemoveDraftAttachment}
              onPreviewImage={setPreviewAttachment}
            />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) 32px", alignItems: "end", gap: 6 }}>
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment"
              onClick={() => {
                focusComposer();
                fileInputRef.current?.click();
              }}
              style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: accent, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <PlusIcon color={accent} />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              rows={lineCount}
              placeholder={replyTarget ? `↖ Replying to ${replyTarget.authorName}` : ""}
              onFocus={onFocus}
              onPaste={(event) => {
                if (attachTransferredImages(event.clipboardData)) event.preventDefault();
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                if (attachTransferredImages(event.dataTransfer)) event.preventDefault();
              }}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              onKeyDown={(event) => {
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
              style={{ width: "100%", height: composerHeight, minHeight: 34, maxHeight: 102, resize: "none", overflowY: lineCount >= 5 ? "auto" : "hidden", border: `1px solid ${strokeColor}`, borderRadius: 6, outline: "none", padding: "7px 8px", color: surfaceText, background: "#ffffff", fontSize: 12, lineHeight: 1.35, letterSpacing: 0 }}
            />
            <button
              type="button"
              aria-label="Send"
              title="Send"
              disabled={!canSubmit}
              onClick={onSubmit}
              style={{ width: 32, height: 32, border: `1px solid ${accent}`, background: canSubmit && active ? accent : "#ffffff", color: canSubmit && active ? "#ffffff" : accent, borderRadius: 6, display: "grid", placeItems: "center", cursor: canSubmit ? "pointer" : "default", opacity: canSubmit ? 1 : 0.44 }}
            >
              <ArrowRightIcon color={canSubmit && active ? "#ffffff" : accent} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              style={{ display: "none" }}
              onChange={(event) => {
                if (event.currentTarget.files) onAttachFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Resize chat"
          onPointerDown={beginResize}
          style={{ cursor: "ns-resize", borderTop: `1px solid ${ruleColor}`, background: active ? "rgba(255,136,32,0.10)" : "rgba(100,116,139,0.08)" }}
        />
      </div>
      {previewAttachment && (
        <ImageAttachmentPreviewModal
          attachment={previewAttachment}
          surfaceText={surfaceText}
          strokeColor={strokeColor}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
};

type ChatThreadItemProps = {
  node: ChatThreadNode;
  depth: number;
  accent: string;
  surfaceText: string;
  ruleColor: string;
  onReply: (messageID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const ChatThreadItem: React.FC<ChatThreadItemProps> = ({ node, depth, accent, surfaceText, ruleColor, onReply, onPreviewImage }) => {
  const { message, children } = node;
  const guideColor = "rgba(100,116,139,0.24)";
  return (
    <div style={{ minWidth: 0, display: "grid", gap: 7 }}>
      <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: 7, alignItems: "start" }}>
        <div style={{ position: "relative", display: "grid", justifyItems: "center", minHeight: 28 }}>
          {depth > 0 && <div aria-hidden="true" style={{ position: "absolute", top: -10, bottom: -8, left: 13, width: 1, background: guideColor }} />}
          <div style={{ position: "relative", zIndex: 1, width: 26, height: 26, borderRadius: 999, border: `1px solid ${ruleColor}`, background: avatarBackgroundForName(message.authorName || message.authorID), color: surfaceText, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, letterSpacing: 0 }}>
            {initialsForName(message.authorName || message.authorID)}
          </div>
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, minWidth: 0, color: surfaceText, fontSize: 10, fontWeight: 800 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.authorName}</span>
            <span style={{ opacity: 0.58, flex: "0 0 auto" }}>{formatTimestamp(message.createdTimestamp)}</span>
          </div>
          {message.message && <div style={{ color: surfaceText, fontSize: 12, lineHeight: 1.35, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{message.message}</div>}
          {message.attachments.length > 0 && <ChatAttachmentList attachments={message.attachments} surfaceText={surfaceText} strokeColor={ruleColor} onPreviewImage={onPreviewImage} />}
          <button type="button" onClick={() => onReply(message.id)} style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: accent, cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}>
            <ChatIcon color={accent} />
            Reply
          </button>
        </div>
      </div>
      {children.length > 0 && (
        <div style={{ minWidth: 0, marginLeft: 13, paddingLeft: 18, borderLeft: `1px solid ${guideColor}`, display: "grid", gap: 8 }}>
          {children.map((child) => (
            <ChatThreadItem
              key={child.message.id}
              node={child}
              depth={depth + 1}
              accent={accent}
              surfaceText={surfaceText}
              ruleColor={ruleColor}
              onReply={onReply}
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
  surfaceText: string;
  strokeColor: string;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const ChatAttachmentList: React.FC<ChatAttachmentListProps> = ({ attachments, surfaceText, strokeColor, onPreviewImage }) => (
  <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
    {attachments.map((attachment) => {
      const image = isImageAttachment(attachment);
      const content = (
        <>
          <AttachmentThumb attachment={attachment} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
          <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
        </>
      );
      const style: React.CSSProperties = {
        maxWidth: "100%",
        minHeight: 30,
        display: "inline-grid",
        gridTemplateColumns: "24px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${strokeColor}`,
        borderRadius: 6,
        background: "#ffffff",
        color: surfaceText,
        padding: "3px 6px",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0,
        textDecoration: "none",
      };
      if (image) {
        return (
          <button key={attachment.id} type="button" onClick={() => onPreviewImage(attachment)} style={{ ...style, cursor: "pointer" }}>
            {content}
          </button>
        );
      }
      return attachment.dataURL ? (
        <a key={attachment.id} href={attachment.dataURL} download={attachment.name} style={style}>
          {content}
        </a>
      ) : (
        <span key={attachment.id} style={style}>{content}</span>
      );
    })}
  </div>
);

type DraftAttachmentListProps = {
  attachments: EditorChatAttachment[];
  surfaceText: string;
  strokeColor: string;
  onRemove: (attachmentID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const DraftAttachmentList: React.FC<DraftAttachmentListProps> = ({ attachments, surfaceText, strokeColor, onRemove, onPreviewImage }) => (
  <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
    {attachments.map((attachment) => (
      <span key={attachment.id} style={{ maxWidth: "100%", minHeight: 30, display: "inline-grid", gridTemplateColumns: "24px minmax(0, 1fr) auto 18px", alignItems: "center", gap: 5, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, padding: "3px 4px 3px 5px", fontSize: 10, fontWeight: 800, letterSpacing: 0 }}>
        <button type="button" aria-label={isImageAttachment(attachment) ? `Preview ${attachment.name}` : attachment.name} onClick={() => { if (isImageAttachment(attachment)) onPreviewImage(attachment); }} style={{ width: 24, height: 24, border: "none", background: "transparent", padding: 0, cursor: isImageAttachment(attachment) ? "pointer" : "default" }}>
          <AttachmentThumb attachment={attachment} />
        </button>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
        <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)} style={{ width: 18, height: 18, border: "none", borderRadius: 4, background: "transparent", color: surfaceText, cursor: "pointer", fontSize: 12, fontWeight: 800, lineHeight: 1 }}>
          x
        </button>
      </span>
    ))}
  </div>
);

const AttachmentThumb: React.FC<{ attachment: EditorChatAttachment }> = ({ attachment }) => {
  if (isImageAttachment(attachment)) {
    return <img alt="" src={attachment.dataURL} style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", display: "block", border: "1px solid rgba(17,17,17,0.12)" }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid rgba(17,17,17,0.14)", background: "rgba(255,136,32,0.10)", display: "grid", placeItems: "center", color: "rgba(36,18,10,0.78)", fontSize: 8, fontWeight: 900 }}>
      FILE
    </span>
  );
};

type ImageAttachmentPreviewModalProps = {
  attachment: EditorChatAttachment;
  surfaceText: string;
  strokeColor: string;
  onClose: () => void;
};

const ImageAttachmentPreviewModal: React.FC<ImageAttachmentPreviewModalProps> = ({ attachment, surfaceText, strokeColor, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(17,24,39,0.46)", display: "grid", placeItems: "center", padding: 18 }}
    >
      <div style={{ width: "min(920px, 96vw)", maxHeight: "92vh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.26)", overflow: "hidden" }}>
        <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 32px", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: `1px solid ${strokeColor}` }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 800 }}>{attachment.name}</span>
          <button type="button" aria-label="Close image preview" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            x
          </button>
        </div>
        <div style={{ minHeight: 0, overflow: "auto", display: "grid", placeItems: "center", background: "#111827", padding: 10 }}>
          <img alt={attachment.name} src={attachment.dataURL} style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", display: "block" }} />
        </div>
      </div>
    </div>
  );
};

type AttachedEmailsPanelProps = {
  emails: EditorAttachedEmail[];
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onOpenEmail: (messageID: string) => void;
};

const AttachedEmailsPanel: React.FC<AttachedEmailsPanelProps> = ({ emails, accent, surfaceText, panelBackground, strokeColor, onOpenEmail }) => (
  <div style={{ minWidth: 0, display: "grid", gap: 7, border: `1px solid ${strokeColor}`, borderRadius: 8, background: panelBackground, padding: 8, maxHeight: 260, overflowY: "auto" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: surfaceText, fontSize: 11, fontWeight: 800 }}>
      <MailIcon color={accent} />
      <span>{emails.length}</span>
    </div>
    {emails.map((email) => (
      <button key={email.id} type="button" title={email.subject} onClick={() => onOpenEmail(email.messageID)} style={{ display: "grid", gap: 2, minWidth: 0, border: 0, borderTop: `1px solid ${strokeColor}`, padding: "7px 0 0", background: "transparent", textAlign: "left", cursor: "pointer" }}>
        <div style={{ color: surfaceText, fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.subject}</div>
        <div style={{ color: surfaceText, opacity: 0.62, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.from || formatTimestamp(email.date)}</div>
      </button>
    ))}
  </div>
);

type EmailPickerModalProps = {
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onClose: () => void;
  onAttach: (message: EmailMessage) => void;
};

const EmailPickerModal: React.FC<EmailPickerModalProps> = ({ accent, surfaceText, panelBackground, strokeColor, onClose, onAttach }) => {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void listEmailMessages({ mailbox: "primary", limit: 30, q: query.trim() || undefined })
        .then((page) => {
          if (!cancelled) setMessages(page.messages ?? []);
        })
        .catch((cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(17, 24, 39, 0.32)", display: "grid", placeItems: "center", padding: 18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ width: "min(560px, 100%)", maxHeight: "min(680px, 92%)", display: "grid", gridTemplateRows: "auto 1fr", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 12, borderBottom: `1px solid ${strokeColor}`, background: panelBackground }}>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search email"
            style={{ minWidth: 0, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, padding: "0 10px", outline: "none", color: surfaceText, fontSize: 13, letterSpacing: 0 }}
          />
          <button type="button" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            x
          </button>
        </div>
        <div className="editor-document-scroll" style={{ overflowY: "auto", minHeight: 220, padding: 10, display: "grid", alignContent: "start", gap: 8, ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
          {loading && <div style={{ padding: 12, color: surfaceText, opacity: 0.68, fontSize: 12, fontWeight: 700 }}>Loading</div>}
          {error && <div style={{ padding: 12, color: "#b00020", fontSize: 12, fontWeight: 700 }}>{error}</div>}
          {!loading && !error && messages.length === 0 && <div style={{ padding: 12, color: surfaceText, opacity: 0.68, fontSize: 12, fontWeight: 700 }}>No email</div>}
          {messages.map((message) => (
            <button
              key={message.id}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(EMAIL_DRAG_MIME, JSON.stringify(messageAttachmentPayload(message)));
              }}
              onClick={() => onAttach(message)}
              style={{ display: "grid", gap: 4, width: "100%", minWidth: 0, textAlign: "left", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, padding: "9px 10px", cursor: "grab" }}
            >
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 }}>{message.subject || "(no subject)"}</span>
                <span style={{ color: accent, fontSize: 10, fontWeight: 800, flex: "0 0 auto" }}>{formatTimestamp(message.date, "day")}</span>
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, opacity: 0.68 }}>{formatAddressList(message.from)}</span>
              {message.snippet && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, opacity: 0.72 }}>{message.snippet}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

type EmailDetailModalProps = {
  messageID: string;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onClose: () => void;
};

const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ messageID, accent, surfaceText, panelBackground, strokeColor, onClose }) => {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void getEmailMessage(messageID)
      .then((payload) => {
        if (!cancelled) setMessage(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [messageID]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "absolute", inset: 0, zIndex: 32, background: "rgba(17, 24, 39, 0.32)", display: "grid", placeItems: "center", padding: 18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ width: "min(720px, 100%)", maxHeight: "min(760px, 92%)", display: "grid", gridTemplateRows: "auto auto minmax(260px, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start", padding: 12, borderBottom: `1px solid ${strokeColor}`, background: panelBackground }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: surfaceText, fontSize: 15, fontWeight: 800, overflowWrap: "anywhere" }}>{message?.subject || "(no subject)"}</div>
            <div style={{ marginTop: 4, color: surfaceText, opacity: 0.64, fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {message ? `${formatAddressList(message.from) || "Unknown sender"}${message.date ? ` - ${formatTimestamp(message.date)}` : ""}` : "Email"}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            x
          </button>
        </div>
        {(loading || error) && (
          <div style={{ padding: "9px 12px", borderBottom: `1px solid ${strokeColor}`, color: error ? "#b00020" : accent, fontSize: 12, fontWeight: 800 }}>
            {error || "Loading"}
          </div>
        )}
        <iframe title="Attached email body" sandbox="" srcDoc={messageDocument(message?.body || message?.snippet || "")} style={{ width: "100%", height: "100%", minHeight: 320, border: 0, background: "#ffffff" }} />
      </div>
    </div>
  );
};

function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}</style></head><body>${content}</body></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
