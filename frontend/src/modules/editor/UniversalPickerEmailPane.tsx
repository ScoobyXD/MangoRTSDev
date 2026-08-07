import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  fetchCommunicationsStatus,
  createMessageQuery,
  listEmailFolders,
  listEmailMessages,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
  type MessagePage,
} from "../communications/communicationsApi.js";
import type { EditorEntityLinkRequest } from "./editorEntityLinks.js";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  MailIcon,
} from "./NodeWorkspaceSurfaceShared.js";

const EMAIL_PAGE_SIZE = 12;
const EMAIL_ROW_HEIGHT = 66;

export type UniversalPickerEmailSelection = {
  message: EmailMessage;
  mailbox: EmailMailbox;
  accountEmail: string;
};

export type UniversalPickerEmailPaneHandle = {
  moveSelection: (delta: number) => boolean;
  chooseSelection: () => boolean;
};

type UniversalPickerEmailPaneProps = {
  active: boolean;
  busy: boolean;
  companyID: string;
  query: string;
  requestJSON: EditorEntityLinkRequest;
  onChoose: (selection: UniversalPickerEmailSelection) => void;
};

const MAILBOX_BUTTONS: ReadonlyArray<{ mailbox: Extract<EmailMailbox, "primary" | "starred" | "sent">; label: string }> = [
  { mailbox: "primary", label: "Inbox" },
  { mailbox: "starred", label: "Starred" },
  { mailbox: "sent", label: "Sent" },
];

function normalizeFolderKeys(folder: EmailFolder): string[] {
  return [folder.system_folder, folder.name, folder.display_name, ...(folder.attributes ?? [])]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

function folderCount(folders: EmailFolder[], keys: readonly string[]): number | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const match = folders.find((folder) => normalizeFolderKeys(folder).some((key) => wanted.has(key)));
  const value = match?.total_count;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function formatAddress(message: EmailMessage): string {
  const addresses = message.from ?? [];
  return addresses.map((address) => address.name?.trim() || address.email.trim()).filter(Boolean).join(", ") || "Unknown sender";
}

function formatDate(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function appendUniqueMessages(current: EmailMessage[], incoming: EmailMessage[]): EmailMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const next = [...current];
  for (const message of incoming) {
    if (!message.id.trim() || seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(message);
  }
  return next;
}

export const UniversalPickerEmailPane = forwardRef<UniversalPickerEmailPaneHandle, UniversalPickerEmailPaneProps>(function UniversalPickerEmailPane({
  active,
  busy,
  companyID,
  query,
  requestJSON,
  onChoose,
}, ref) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountResolved, setAccountResolved] = useState(false);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [allMenuOpen, setAllMenuOpen] = useState(false);
  const activeMailboxLabel = mailbox === "spam" ? "Spam" : "All";
  const inboxCount = folderCount(folders, ["inbox"]);
  const starredCount = folderCount(folders, ["starred", "flagged"]);

  useImperativeHandle(ref, () => ({
    moveSelection(delta: number) {
      if (!active || messages.length === 0) return false;
      setSelectedIndex((current) => (current + delta + messages.length) % messages.length);
      return true;
    },
    chooseSelection() {
      const message = messages[selectedIndex];
      if (!active || busy || !message || !accountEmail) return false;
      onChoose({ message, mailbox, accountEmail });
      return true;
    },
  }), [accountEmail, active, busy, mailbox, messages, onChoose, selectedIndex]);

  useEffect(() => {
    if (!active || accountResolved) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchCommunicationsStatus()
      .then((status) => {
        if (cancelled) return;
        const resolved = status.connected && status.status === "connected"
          ? status.connection?.account_email?.trim().toLowerCase() ?? ""
          : "";
        setAccountEmail(resolved);
        if (!resolved) setError("Connect a personal email account to search mail.");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load the email account.");
      })
      .finally(() => {
        if (!cancelled) {
          setAccountResolved(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [accountResolved, active]);

  useEffect(() => {
    if (!active || !accountEmail) return undefined;
    let cancelled = false;
    void listEmailFolders({ companyID, accountEmail })
      .then((items) => { if (!cancelled) setFolders(items); })
      .catch(() => { if (!cancelled) setFolders([]); });
    return () => { cancelled = true; };
  }, [accountEmail, active, companyID]);

  useEffect(() => {
    if (!active || !accountResolved || !accountEmail) return undefined;
    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    let cancelled = false;
    setSelectedIndex(0);
    setLoading(true);
    setLoadingMore(false);
    setMessages([]);
    setNextPageToken("");
    setError("");
    const timer = window.setTimeout(() => {
      const path = `/v1/communications/messages${createMessageQuery({
        companyID,
        accountEmail,
        mailbox,
        limit: EMAIL_PAGE_SIZE,
        q: query.trim() || undefined,
      })}`;
      void requestJSON<MessagePage>(path, { signal: controller.signal })
        .then((page) => {
          if (cancelled || requestSequenceRef.current !== sequence) return;
          setMessages(page.messages ?? []);
          setNextPageToken(page.next_page_token ?? "");
        })
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          if (!cancelled && requestSequenceRef.current === sequence) setError(cause instanceof Error ? cause.message : "Unable to search email.");
        })
        .finally(() => {
          if (!cancelled && requestSequenceRef.current === sequence) setLoading(false);
        });
    }, query.trim() ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accountEmail, accountResolved, active, companyID, mailbox, query, requestJSON]);

  useEffect(() => {
    if (selectedIndex < messages.length) return;
    setSelectedIndex(Math.max(0, messages.length - 1));
  }, [messages.length, selectedIndex]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-universal-picker-email-index="${selectedIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const loadMore = useCallback(async () => {
    const pageToken = nextPageToken.trim();
    if (!active || !accountEmail || !pageToken || loading || loadingMore) return;
    const sequence = requestSequenceRef.current;
    setLoadingMore(true);
    setError("");
    try {
      const page = await listEmailMessages({
        companyID,
        accountEmail,
        mailbox,
        limit: EMAIL_PAGE_SIZE,
        pageToken,
        q: query.trim() || undefined,
      });
      if (requestSequenceRef.current !== sequence) return;
      setMessages((current) => appendUniqueMessages(current, page.messages ?? []));
      setNextPageToken(page.next_page_token ?? "");
    } catch (cause) {
      if (requestSequenceRef.current === sequence) setError(cause instanceof Error ? cause.message : "Unable to load more email.");
    } finally {
      if (requestSequenceRef.current === sequence) setLoadingMore(false);
    }
  }, [accountEmail, active, companyID, loading, loadingMore, mailbox, nextPageToken, query]);

  const mailboxButtonStyle = useCallback((selected: boolean): React.CSSProperties => ({
    minWidth: 0,
    minHeight: 38,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    border: selected ? "1px solid rgba(14,165,233,.56)" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
    borderRadius: 12,
    background: selected ? "linear-gradient(145deg,#48c7f5,#50b8ed)" : EDITOR_NEU_SURFACE,
    boxShadow: selected ? "inset 1px 1px 0 rgba(255,255,255,.62), 0 6px 13px rgba(14,165,233,.18)" : EDITOR_NEU_SHADOW,
    color: selected ? "#082f49" : "#172033",
    padding: "0 14px",
    cursor: busy ? "wait" : "pointer",
    fontSize: 11,
    fontWeight: 850,
  }), [busy]);

  const setActiveMailbox = (next: EmailMailbox) => {
    if (busy) return;
    setAllMenuOpen(false);
    setMailbox(next);
  };

  const statusText = useMemo(() => {
    if (loading) return "Loading email…";
    if (!error && messages.length === 0) return query.trim() ? "No matching email." : "No email in this folder.";
    return "";
  }, [error, loading, messages.length, query]);

  return (
    <div data-mango-universal-picker-email-pane="true" style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr)", gap: 8, padding: "0 12px 10px" }}>
      <div role="tablist" aria-label="Email folders" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 7 }}>
        {MAILBOX_BUTTONS.map((item) => {
          const selected = mailbox === item.mailbox;
          const count = item.mailbox === "primary" ? inboxCount : item.mailbox === "starred" ? starredCount : undefined;
          return (
            <button key={item.mailbox} type="button" role="tab" aria-selected={selected} disabled={busy} style={mailboxButtonStyle(selected)} onClick={() => setActiveMailbox(item.mailbox)}>
              <span>{item.label}</span>
              {count !== undefined && <span style={{ minWidth: 19, height: 18, display: "inline-grid", placeItems: "center", borderRadius: 9, background: "rgba(255,255,255,.78)", padding: "0 5px", fontSize: 9.5 }}>{count}</span>}
              {item.mailbox === "sent" && <span aria-hidden="true" style={{ fontSize: 13 }}>➤</span>}
            </button>
          );
        })}
        <div style={{ position: "relative", minWidth: 0 }}>
          <button type="button" role="tab" aria-selected={mailbox === "all" || mailbox === "spam"} aria-haspopup="menu" aria-expanded={allMenuOpen} disabled={busy} style={{ ...mailboxButtonStyle(mailbox === "all" || mailbox === "spam"), width: "100%" }} onClick={() => setAllMenuOpen((current) => !current)}>
            <span>{activeMailboxLabel}</span><span aria-hidden="true">⌄</span>
          </button>
          {allMenuOpen && (
            <div role="menu" style={{ position: "absolute", zIndex: 4, top: "calc(100% + 5px)", right: 0, width: 150, display: "grid", gap: 4, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: "rgba(255,255,255,.98)", padding: 5, boxShadow: "0 12px 26px rgba(15,23,42,.18)" }}>
              {([["all", "All email"], ["spam", "Spam folder"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="menuitem" onClick={() => setActiveMailbox(value)} style={{ border: 0, borderRadius: 7, background: mailbox === value ? EDITOR_NEU_ACTIVE_SURFACE : "transparent", padding: "8px 9px", color: "#172033", textAlign: "left", cursor: "pointer", fontSize: 11, fontWeight: 800 }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Email search results"
        data-mango-universal-picker-email-mailbox={mailbox}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (target.scrollHeight - target.scrollTop - target.clientHeight < EMAIL_ROW_HEIGHT * 2) void loadMore();
        }}
        style={{ minHeight: 360, maxHeight: 445, overflowY: "auto", display: "grid", alignContent: "start", gap: 6, padding: "2px 2px 8px" }}
      >
        {error && <div role="alert" style={{ margin: 4, padding: 10, border: "1px solid rgba(185,28,28,.24)", borderRadius: 10, background: "rgba(254,242,242,.94)", color: "#991b1b", fontSize: 11, fontWeight: 800 }}>{error}</div>}
        {statusText && <div style={{ padding: "30px 12px", color: "#64748b", textAlign: "center", fontSize: 12 }}>{statusText}</div>}
        {messages.map((message, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={message.id}
              type="button"
              role="option"
              aria-selected={selected}
              data-universal-picker-email-index={index}
              disabled={busy}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => onChoose({ message, mailbox, accountEmail })}
              style={{
                width: "100%",
                minWidth: 0,
                minHeight: EMAIL_ROW_HEIGHT,
                display: "grid",
                gridTemplateColumns: "12px minmax(0,1fr) auto",
                alignItems: "center",
                gap: 9,
                border: selected ? "1px solid rgba(8,145,178,.30)" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                borderRadius: 11,
                background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "rgba(255,255,255,.88)",
                boxShadow: selected ? "0 7px 18px rgba(15,23,42,.09)" : "0 2px 8px rgba(15,23,42,.05)",
                color: "#172033",
                padding: "8px 10px",
                cursor: busy ? "wait" : "pointer",
                textAlign: "left",
              }}
            >
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: message.unread ? "#22c7dd" : "#cbd5e1", boxShadow: message.unread ? "0 0 0 4px rgba(34,199,221,.10)" : undefined }} />
              <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
                  <MailIcon color={message.unread ? "#0891b2" : "#64748b"} />
                  <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5 }}>{formatAddress(message)}</strong>
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800 }}>{message.subject || "(no subject)"}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 10 }}>{message.snippet || ""}</span>
              </span>
              <span style={{ alignSelf: "start", paddingTop: 2, color: "#64748b", fontSize: 9.5, fontWeight: 750, whiteSpace: "nowrap" }}>{formatDate(message.date)}</span>
            </button>
          );
        })}
        {loadingMore && <div style={{ padding: 9, color: "#64748b", textAlign: "center", fontSize: 10.5, fontWeight: 800 }}>Loading more…</div>}
      </div>
    </div>
  );
});
