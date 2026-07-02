import React, { useEffect } from "react";
import type { EmailAddress, EmailMessage } from "../communications/communicationsApi";
import type { NodeProjectionItem } from "../node-map/NodeRecordStore";
import type { MentionableCompanyUser } from "./editorMentions";
import type { EditorChatAttachment, EditorTextBlockChatMessage } from "./editorProjection";
import { generateStableInformationID } from "./editorTypes";
import type { NodeContentChange } from "./nodeContentChanges";
import type { EditorOutlineStyleID } from "./plainTextEditing";
export type { MentionableCompanyUser } from "./editorMentions";
export type RequestJSON = <T,>(path: string, init?: RequestInit) => Promise<T>;

export type NodeWorkspaceSurfaceProps = {
  apiBase: string;
  companyID: string;
  scope: string;
  nodeID: string;
  canEdit: boolean;
  nodePriorityDraft: string;
  assignedLogicGateIDs: string[];
  projections: NodeProjectionItem[];
  unseenChanges: NodeContentChange[];
  companyUsers: MentionableCompanyUser[];
  projectionsLoaded: boolean;
  focusInformationID?: string;
  focusRequestID?: number;
  focusInformationMode?: "focus" | "scroll";
  topPx: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  outlineStyle: EditorOutlineStyleID;
  requestJSON: RequestJSON;
  onProjectionMutation: () => void;
  onMarkChangeSeen: (changeID: string) => void;
  onMarkAllChangesSeen: () => void;
  onCreateNodeFromImage: (request: NodeImageNodeRequest) => Promise<void>;
  onAssignToLogicGate: (logicGateID: string) => Promise<void>;
  onRequireNodePriorityForLogicGateAssignment: () => void;
  onError: (message: string) => void;
};

export type NodeImageNodeRequest = {
  title: string;
  document: string;
  blockTitle?: string;
};

export type TextBlockState = {
  id: string;
  title: string;
  document: string;
  attachments: EditorChatAttachment[];
  createdTimestamp: string;
  updatedTimestamp: string;
  pending: boolean;
};

export type TextBlockSelectionAnchor = {
  blockID: string;
  source?: "text" | "email";
  messageID?: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

export type TextBlockSelectionDraft = TextBlockSelectionAnchor & {
  x: number;
  y: number;
};

export type TextBlockImageDraft = {
  blockID: string;
  dataURL: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  x: number;
  y: number;
};

export type TimelineGranularity = "day" | "week" | "month" | "year";
export type ChatThreadNode = {
  message: EditorTextBlockChatMessage;
  children: ChatThreadNode[];
};

export const EMAIL_DRAG_MIME = "application/x-mango-email-message";
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const CHAT_PANE_MIN_HEIGHT = 440;
export const CHAT_PANE_MAX_HEIGHT = 900;
export const TEXT_BLOCK_MIN_HEIGHT = 660;
export const TEXT_BLOCK_MAX_HEIGHT = 1200;
export const TEXT_BLOCK_FONT_SIZE = 14;
export const TEXT_BLOCK_LINE_HEIGHT = 1.45;
export const TEXT_BLOCK_PADDING_TOP = 12;
export const TEXT_BLOCK_PADDING_RIGHT = 13;
export const TEXT_BLOCK_PADDING_BOTTOM = 12;
export const TEXT_BLOCK_PADDING_LEFT = 13;
export const TEXT_BLOCK_BOTTOM_BUFFER_ROWS = 10;
export const TEXT_BLOCK_HEADER_CHROME_HEIGHT = 38;
export const TEXT_BLOCK_DEFAULT_CARD_HEIGHT = TEXT_BLOCK_MIN_HEIGHT + TEXT_BLOCK_HEADER_CHROME_HEIGHT;
export const CHAT_PANE_DEFAULT_HEIGHT = TEXT_BLOCK_DEFAULT_CARD_HEIGHT;
export const DEFAULT_TEXT_BLOCK_TITLE = "Hello I am a title";
export const EDITOR_NEU_PANEL_BACKGROUND = "linear-gradient(180deg, #fbfbfd 0%, #eef4f8 54%, #f5f0fb 100%)";
export const EDITOR_NEU_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)";
export const EDITOR_NEU_ACTIVE_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f5f6fa 100%)";
export const EDITOR_NEU_EDGE_FRAME = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
export const EDITOR_NEU_SOFT_BORDER = "rgba(255, 255, 255, 0.76)";
export const EDITOR_NEU_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.26), -7px -7px 16px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";
export const EDITOR_NEU_PANEL_SHADOW = "inset 0 0 0 1px rgba(255, 255, 255, 0.72), inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255, 255, 255, 0.86), 0 12px 28px rgba(15, 23, 42, 0.14)";
const USER_ACCENT_COLORS = ["#db2777", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#dc2626"];

export function projectionsKey(items: NodeProjectionItem[]): string {
  return items.map((item) => `${item.information_id}:${item.type}:${item.updated_timestamp}`).join("|");
}

export function formatAddressList(addresses?: EmailAddress[]): string {
  if (!addresses?.length) return "";
  return addresses
    .map((address) => {
      const name = (address.name ?? "").trim();
      return name ? `${name} <${address.email}>` : address.email;
    })
    .join(", ");
}

export function formatTimestamp(value: string | number | undefined, granularity: TimelineGranularity = "day"): string {
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

export function messageAttachmentPayload(message: EmailMessage): {
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

export function parseDraggedEmail(dataTransfer: DataTransfer): ReturnType<typeof messageAttachmentPayload> | null {
  const raw = dataTransfer.getData(EMAIL_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReturnType<typeof messageAttachmentPayload>;
    return parsed.messageID ? parsed : null;
  } catch {
    return null;
  }
}

export function useCloseFloatingMenu(open: boolean, ref: React.RefObject<HTMLElement>, onClose: () => void): void {
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

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function readChatAttachment(file: File): Promise<EditorChatAttachment> {
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

export function imageFilesFromTransfer(dataTransfer: DataTransfer): File[] {
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

export function isImageAttachment(attachment: EditorChatAttachment): boolean {
  return attachment.type.startsWith("image/") && Boolean(attachment.dataURL?.startsWith("data:image/"));
}

export function clampChatPaneHeight(value: number): number {
  if (!Number.isFinite(value)) return CHAT_PANE_DEFAULT_HEIGHT;
  return Math.max(CHAT_PANE_MIN_HEIGHT, Math.min(Math.round(value), CHAT_PANE_MAX_HEIGHT));
}

export function readStoredChatPaneHeight(storageKey: string): number {
  if (typeof localStorage === "undefined") return CHAT_PANE_DEFAULT_HEIGHT;
  return clampChatPaneHeight(Number.parseInt(localStorage.getItem(storageKey) ?? "", 10));
}

export function storeChatPaneHeight(storageKey: string, height: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey, String(clampChatPaneHeight(height)));
}

export function chatParentCreatesCycle(nodes: Map<string, ChatThreadNode>, childID: string, parentID: string): boolean {
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

export function buildChatThreads(messages: EditorTextBlockChatMessage[]): ChatThreadNode[] {
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

export function countChatThreadDescendants(node: ChatThreadNode): number {
  let total = 0;
  const stack = [...node.children];
  while (stack.length > 0) {
    const child = stack.pop();
    if (!child) continue;
    total += 1;
    stack.push(...child.children);
  }
  return total;
}

export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

export function avatarBackgroundForName(name: string): string {
  const color = userAccentForName(name);
  return `linear-gradient(135deg, ${color}, rgba(92, 238, 255, 0.72) 52%, rgba(183, 124, 255, 0.78))`;
}

export function userAccentForName(name: string): string {
  const value = name.trim() || "Unknown user";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return USER_ACCENT_COLORS[Math.abs(hash) % USER_ACCENT_COLORS.length] ?? USER_ACCENT_COLORS[0];
}

export const ChatIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M4.2 4h9.6a1.8 1.8 0 0 1 1.8 1.8v4.9a1.8 1.8 0 0 1-1.8 1.8H8.2L4 15v-2.5A1.8 1.8 0 0 1 2.2 10.7V5.8A1.8 1.8 0 0 1 4.2 4Z" fill="none" stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
  </svg>
);

export const PlusIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const ArrowRightIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M3 8h9M8.7 4.2 12.5 8l-3.8 3.8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const MailIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.8 5.1h12.4v8H2.8z" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="m3.4 5.7 5.6 4.1 5.6-4.1" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PaperclipIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="m7.1 9.7 4.5-4.5a2.2 2.2 0 1 1 3.1 3.1l-6 6a3.8 3.8 0 0 1-5.4-5.4l6-6a3 3 0 0 1 4.2 0" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const TableIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <rect x="3" y="4" width="12" height="10" rx="1.4" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="M3 7.4h12M7 4v10M11 4v10" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
  </svg>
);

