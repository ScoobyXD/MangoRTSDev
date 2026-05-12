import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { listEmailMessages, type EmailAddress, type EmailMessage } from "../../pages/communications/communicationsApi";
import type { NodeProjectionItem } from "../node-map/NodeRecordStore";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockChatPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockChats,
  type EditorAttachedEmail,
  type EditorTextBlockChatMessage,
} from "./editorProjection";
import { EDITOR_AUTOSAVE_DELAY_MS, generateStableInformationID } from "./editorTypes";
import { deserializeEditorDocumentHTML, EDITOR_RICH_TEXT_PREFIX } from "./richTextEditing";

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
  text: string;
  createdTimestamp: string;
  updatedTimestamp: string;
  pending: boolean;
};

type TimelineGranularity = "day" | "week" | "month" | "year";

const EMAIL_DRAG_MIME = "application/x-mango-email-message";
const TIMELINE_OPTIONS: TimelineGranularity[] = ["day", "week", "month", "year"];

function projectionsKey(items: NodeProjectionItem[]): string {
  return items.map((item) => `${item.information_id}:${item.type}:${item.updated_timestamp}`).join("|");
}

function plainTextFromStoredInformation(value: string): string {
  if (!value.startsWith(EDITOR_RICH_TEXT_PREFIX)) return value;
  if (typeof document === "undefined") return value.replace(EDITOR_RICH_TEXT_PREFIX, "");
  const container = document.createElement("div");
  container.innerHTML = deserializeEditorDocumentHTML(value);
  return container.innerText.trim();
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

const MailIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.8 5.1h12.4v8H2.8z" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="m3.4 5.7 5.6 4.1 5.6-4.1" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
  const textByBlockRef = useRef(new Map<string, string>());
  const focusBlockIDRef = useRef("");
  const [width, setWidth] = useState(0);
  const [blocks, setBlocks] = useState<TextBlockState[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [activeChatBlockID, setActiveChatBlockID] = useState("");
  const [timelineGranularity, setTimelineGranularity] = useState<TimelineGranularity>("day");
  const [emailPickerOpen, setEmailPickerOpen] = useState(false);
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
    const textBlocks = listEditorTextBlockProjections(projections).map((item) => ({
      id: item.information_id,
      text: plainTextFromStoredInformation(item.information),
      createdTimestamp: item.created_timestamp,
      updatedTimestamp: item.updated_timestamp,
      pending: false,
    }));
    setBlocks(textBlocks);
    textByBlockRef.current = new Map(textBlocks.map((block) => [block.id, block.text]));
    setChatMessages(parseEditorTextBlockChats(projections));
    setAttachedEmails(parseEditorAttachedEmails(projections));
    setChatDrafts({});
    setActiveChatBlockID("");
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
      const textarea = rootRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-node-text-block-id="${blockID}"]`);
      textarea?.focus({ preventScroll: true });
    });
  }, [blocks.length]);

  const persistTextBlock = useCallback(async (blockID: string, text: string) => {
    if (!nodeID || !companyID) return;
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, pending: true } : block));
    try {
      if (text.trim()) {
        await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
          method: "POST",
          body: JSON.stringify({
            company_id: companyID,
            type: EDITOR_TEXT_BLOCK_TYPE,
            information: text,
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
    void persistTextBlock(blockID, textByBlockRef.current.get(blockID) ?? "");
  }, [persistTextBlock]);

  const scheduleTextBlockSave = useCallback((blockID: string, text: string) => {
    textByBlockRef.current.set(blockID, text);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      void persistTextBlock(blockID, textByBlockRef.current.get(blockID) ?? "");
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [persistTextBlock]);

  const createTextBlock = useCallback(() => {
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    focusBlockIDRef.current = blockID;
    setBlocks((current) => [
      ...current,
      {
        id: blockID,
        text: "",
        createdTimestamp: now,
        updatedTimestamp: now,
        pending: false,
      },
    ]);
    setActiveChatBlockID(blockID);
  }, []);

  const updateTextBlock = useCallback((blockID: string, text: string) => {
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, text, updatedTimestamp: new Date().toISOString() } : block));
    scheduleTextBlockSave(blockID, text);
  }, [scheduleTextBlockSave]);

  const submitChat = useCallback(async (blockID: string) => {
    const message = (chatDrafts[blockID] ?? "").trim();
    if (!message) return;
    const now = new Date().toISOString();
    const id = generateStableInformationID();
    const nextMessage: EditorTextBlockChatMessage = {
      id,
      blockID,
      authorID: author.userID,
      authorName: author.name,
      message,
      createdTimestamp: now,
    };
    setChatDrafts((current) => ({ ...current, [blockID]: "" }));
    setChatMessages((current) => [...current, nextMessage]);
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          information: buildEditorTextBlockChatPayload({
            blockID,
            authorID: author.userID,
            authorName: author.name,
            message,
            createdTimestamp: now,
          }),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_chat_message");
    }
  }, [author.name, author.userID, chatDrafts, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 }}>
            {TIMELINE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTimelineGranularity(option)}
                style={{
                  border: `1px solid ${timelineGranularity === option ? accent : strokeColor}`,
                  background: timelineGranularity === option ? accent : panelBackground,
                  color: timelineGranularity === option ? "#ffffff" : surfaceText,
                  borderRadius: 5,
                  padding: "4px 2px",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {option}
              </button>
            ))}
          </div>
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
          return (
            <React.Fragment key={block.id}>
              <TimelineCell label={timelineRows[index]?.label ?? ""} count={timelineRows[index]?.count ?? 0} accent={accent} muted={false} />
              <div style={{ minWidth: 0 }}>
                <div style={{ border: `1px solid ${strokeColor}`, borderRadius: 8, background: "rgba(255,255,255,0.72)", overflow: "hidden", boxShadow: "0 6px 18px rgba(0,0,0,0.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 32, borderBottom: `1px solid ${ruleColor}`, padding: "6px 8px", background: panelBackground }}>
                    <span style={{ color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {formatTimestamp(block.createdTimestamp) || `Text box ${index + 1}`}
                    </span>
                    <button
                      type="button"
                      title="Open chat"
                      onClick={() => setActiveChatBlockID(block.id)}
                      style={{ width: 26, height: 24, borderRadius: 5, border: `1px solid ${chatIsActive ? accent : strokeColor}`, background: chatIsActive ? accent : "#ffffff", color: chatIsActive ? "#ffffff" : accent, display: "grid", placeItems: "center", cursor: "pointer", flex: "0 0 auto" }}
                    >
                      <ChatIcon color={chatIsActive ? "#ffffff" : accent} />
                    </button>
                  </div>
                  <textarea
                    data-node-text-block-id={block.id}
                    value={block.text}
                    placeholder=""
                    spellCheck
                    onChange={(event) => updateTextBlock(block.id, event.currentTarget.value)}
                    onBlur={() => flushTextBlockSave(block.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      minHeight: 120,
                      resize: "vertical",
                      border: 0,
                      outline: "none",
                      padding: "12px 13px",
                      color: surfaceText,
                      background: "#ffffff",
                      fontSize: 14,
                      lineHeight: 1.45,
                      letterSpacing: 0,
                      overflowWrap: "anywhere",
                    }}
                  />
                </div>
                {compact && (
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
                    onFocus={() => setActiveChatBlockID(block.id)}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                    onSubmit={() => { void submitChat(block.id); }}
                  />
                )}
              </div>
              {!compact && (
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
                  onFocus={() => setActiveChatBlockID(block.id)}
                  onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                  onSubmit={() => { void submitChat(block.id); }}
                />
              )}
            </React.Fragment>
          );
        })}

        <div />
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
        {!compact && <AttachedEmailsPanel emails={attachedEmails} accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} />}
        {compact && (
          <>
            <div />
            <AttachedEmailsPanel emails={attachedEmails} accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} />
          </>
        )}
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

type ChatPaneProps = {
  blockID: string;
  messages: EditorTextBlockChatMessage[];
  draft: string;
  active: boolean;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  onFocus: () => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
};

const ChatPane: React.FC<ChatPaneProps> = ({
  blockID,
  messages,
  draft,
  active,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  onFocus,
  onDraftChange,
  onSubmit,
}) => (
  <div
    data-node-chat-block-id={blockID}
    onMouseDown={(event) => {
      event.stopPropagation();
      onFocus();
    }}
    style={{
      minWidth: 0,
      marginTop: 0,
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
    <div style={{ display: "grid", gap: 6, maxHeight: 158, overflowY: "auto", padding: "8px" }}>
      {messages.map((message) => (
        <div key={message.id} style={{ display: "grid", gap: 3, borderBottom: `1px solid ${ruleColor}`, paddingBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, minWidth: 0, color: surfaceText, fontSize: 10, fontWeight: 800 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.authorName}</span>
            <span style={{ opacity: 0.58, flex: "0 0 auto" }}>{formatTimestamp(message.createdTimestamp)}</span>
          </div>
          <div style={{ color: surfaceText, fontSize: 12, lineHeight: 1.35, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{message.message}</div>
        </div>
      ))}
    </div>
    <div style={{ display: "grid", gap: 6, padding: 8, borderTop: `1px solid ${ruleColor}` }}>
      <textarea
        value={draft}
        onFocus={onFocus}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        style={{ width: "100%", minHeight: 58, resize: "vertical", border: `1px solid ${strokeColor}`, borderRadius: 6, outline: "none", padding: "7px", color: surfaceText, background: "#ffffff", fontSize: 12, lineHeight: 1.35, letterSpacing: 0 }}
      />
      <button type="button" onClick={onSubmit} style={{ justifySelf: "end", border: `1px solid ${accent}`, background: active ? accent : "#ffffff", color: active ? "#ffffff" : accent, borderRadius: 6, padding: "5px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
        Send
      </button>
    </div>
  </div>
);

type AttachedEmailsPanelProps = {
  emails: EditorAttachedEmail[];
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
};

const AttachedEmailsPanel: React.FC<AttachedEmailsPanelProps> = ({ emails, accent, surfaceText, panelBackground, strokeColor }) => (
  <div style={{ minWidth: 0, display: "grid", gap: 7, border: `1px solid ${strokeColor}`, borderRadius: 8, background: panelBackground, padding: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: surfaceText, fontSize: 11, fontWeight: 800 }}>
      <MailIcon color={accent} />
      <span>{emails.length}</span>
    </div>
    {emails.slice(0, 5).map((email) => (
      <div key={email.id} title={email.subject} style={{ display: "grid", gap: 2, minWidth: 0, borderTop: `1px solid ${strokeColor}`, paddingTop: 7 }}>
        <div style={{ color: surfaceText, fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.subject}</div>
        <div style={{ color: surfaceText, opacity: 0.62, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.from || formatTimestamp(email.date)}</div>
      </div>
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
      void listEmailMessages({ mailbox: "all", limit: 30, q: query.trim() || undefined })
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
