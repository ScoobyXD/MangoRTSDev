import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrentUserResponse } from "../../auth/cognitoAuth";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface } from "../../app/preloadDashboardModules";
import {
  deleteEmailMessage,
  disconnectCommunications,
  fetchCommunicationsAuthURL,
  fetchCommunicationsStatus,
  getEmailMessage,
  listEmailFolders,
  listEmailMessages,
  parseEmailAddressList,
  sendEmail,
  updateEmailMessage,
  type EmailAddress,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
  type CommunicationsStatus,
} from "./communicationsApi";
import { subscribeCommunicationsStream } from "./communicationsStream";

type CommunicationsPageProps = {
  me?: CurrentUserResponse;
  onNavigate?: (path: string) => void;
  embedded?: boolean;
};

type ComposeState = {
  open: boolean;
  replyToMessageID: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
};

const emptyCompose: ComposeState = {
  open: false,
  replyToMessageID: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
};

type MailboxOption = {
  value: EmailMailbox;
  label: string;
};

const MAILBOX_OPTIONS: MailboxOption[] = [
  { value: "primary", label: "Primary Inbox" },
  { value: "sent", label: "Sent mail" },
  { value: "all", label: "All mail" },
];

export function CommunicationsPage({ me, onNavigate, embedded = false }: CommunicationsPageProps) {
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [selectedMessageID, setSelectedMessageID] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pageToken, setPageToken] = useState("");
  const [pageStack, setPageStack] = useState<string[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const foldersRequestInFlightRef = useRef(false);
  const messageRequestKeyRef = useRef("");
  const pendingMessageReloadRef = useRef(false);
  const messageRequestSeqRef = useRef(0);
  const selectedMessageIDRef = useRef("");
  const streamReloadTimerRef = useRef<number | null>(null);
  const streamReloadRef = useRef<() => void>(() => {});

  const isNarrow = viewportWidth < 980;

  useEffect(() => {
    selectedMessageIDRef.current = selectedMessageID;
  }, [selectedMessageID]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("nylas");
    const oauthError = params.get("nylas_error");
    if (connected === "connected") setNotice("Email connected.");
    if (oauthError) setError(formatErrorCode(oauthError));
    if (connected || oauthError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<CommunicationsStatus | null> => {
    setLoadingStatus(true);
    setError("");
    try {
      const next = await fetchCommunicationsStatus();
      setStatus(next);
      if (!next.connected) {
        setFolders([]);
        setMessages([]);
        setSelectedMessage(null);
        setSelectedMessageID("");
      }
      return next;
    } catch (statusError) {
      setError(formatError(statusError, "Failed to load email connection"));
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const loadFolders = useCallback(async (): Promise<boolean> => {
    if (foldersRequestInFlightRef.current) return false;
    foldersRequestInFlightRef.current = true;
    try {
      const next = await listEmailFolders();
      setFolders(next);
      return true;
    } catch (folderError) {
      setError(formatError(folderError, "Failed to load folders"));
      return false;
    } finally {
      foldersRequestInFlightRef.current = false;
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (!status?.connected) return;
    const requestKey = JSON.stringify([mailbox, pageToken, searchQuery, unreadOnly]);
    if (messageRequestKeyRef.current === requestKey) {
      pendingMessageReloadRef.current = true;
      return;
    }
    messageRequestKeyRef.current = requestKey;
    const requestSeq = messageRequestSeqRef.current + 1;
    messageRequestSeqRef.current = requestSeq;
    setLoadingMessages(true);
    setError("");
    try {
      const page = await listEmailMessages({
        limit: 25,
        pageToken,
        mailbox,
        q: searchQuery,
        unread: unreadOnly ? true : undefined,
      });
      if (messageRequestSeqRef.current !== requestSeq) return;
      setMessages(page.messages ?? []);
      setNextPageToken(page.next_page_token ?? "");
      const currentSelectedMessageID = selectedMessageIDRef.current;
      if (currentSelectedMessageID && !(page.messages ?? []).some((message) => message.id === currentSelectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
    } catch (messageError) {
      if (messageRequestSeqRef.current === requestSeq) {
        setError(formatError(messageError, "Failed to load messages"));
      }
    } finally {
      if (messageRequestSeqRef.current === requestSeq) {
        setLoadingMessages(false);
        messageRequestKeyRef.current = "";
        if (pendingMessageReloadRef.current) {
          pendingMessageReloadRef.current = false;
          window.setTimeout(() => { void loadMessages(); }, 0);
        }
      }
    }
  }, [mailbox, pageToken, searchQuery, status?.connected, unreadOnly]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected) void loadFolders(); }, [loadFolders, status?.connected]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);

  useEffect(() => {
    streamReloadRef.current = () => {
      void loadFolders();
      void loadMessages();
    };
  }, [loadFolders, loadMessages]);

  useEffect(() => {
    if (!status?.connected) return undefined;
    const unsubscribe = subscribeCommunicationsStream({
      onEvent(event) {
        if (event.event !== "communications") return;
        if (streamReloadTimerRef.current !== null) window.clearTimeout(streamReloadTimerRef.current);
        streamReloadTimerRef.current = window.setTimeout(() => {
          streamReloadTimerRef.current = null;
          streamReloadRef.current();
        }, 200);
      },
      onError() {
        // SSE reconnects automatically; keep the UI quiet unless an API reload fails.
      },
    });
    return () => {
      unsubscribe();
      if (streamReloadTimerRef.current !== null) {
        window.clearTimeout(streamReloadTimerRef.current);
        streamReloadTimerRef.current = null;
      }
    };
  }, [status?.connected]);

  useEffect(() => {
    if (!selectedMessageID) return;
    let cancelled = false;
    setLoadingDetail(true);
    setError("");
    getEmailMessage(selectedMessageID)
      .then((message) => {
        if (!cancelled) setSelectedMessage(message);
      })
      .catch((detailError) => {
        if (!cancelled) setError(formatError(detailError, "Failed to load message"));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => { cancelled = true; };
  }, [selectedMessageID]);

  const archiveFolder = useMemo(() => findSystemFolder(folders, "archive"), [folders]);
  const connection = status?.connection;

  const startConnection = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    setError("");
    try {
      const authURL = await fetchCommunicationsAuthURL(provider);
      window.location.assign(authURL);
    } catch (connectError) {
      setError(formatError(connectError, "Failed to start email connection"));
      setBusy("");
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError("");
    try {
      await disconnectCommunications();
      setNotice("Email disconnected.");
      await loadStatus();
    } catch (disconnectError) {
      setError(formatError(disconnectError, "Failed to disconnect email"));
    } finally {
      setBusy("");
    }
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearchQuery(searchDraft.trim());
    setPageToken("");
    setPageStack([]);
  };

  const selectMailbox = (nextMailbox: EmailMailbox) => {
    setMailbox(nextMailbox);
    setPageToken("");
    setPageStack([]);
    setSelectedMessageID("");
    setSelectedMessage(null);
  };

  const patchSelectedMessage = async (update: { unread?: boolean; starred?: boolean; folders?: string[] }) => {
    if (!selectedMessage) return;
    setBusy("message");
    setError("");
    try {
      const updated = await updateEmailMessage(selectedMessage.id, update);
      setSelectedMessage(updated);
      setMessages((previous) => previous.map((message) => (message.id === updated.id ? { ...message, ...updated } : message)));
      if (update.folders) await loadMessages();
    } catch (updateError) {
      setError(formatError(updateError, "Failed to update message"));
    } finally {
      setBusy("");
    }
  };

  const archiveSelected = async () => {
    if (!selectedMessage || !archiveFolder) return;
    await patchSelectedMessage({ folders: [archiveFolder.id] });
  };

  const deleteSelected = async () => {
    if (!selectedMessage) return;
    setBusy("delete");
    setError("");
    try {
      await deleteEmailMessage(selectedMessage.id);
      setSelectedMessage(null);
      setSelectedMessageID("");
      setNotice("Message deleted.");
      await loadMessages();
    } catch (deleteError) {
      setError(formatError(deleteError, "Failed to delete message"));
    } finally {
      setBusy("");
    }
  };

  const openNewCompose = () => {
    setCompose({ ...emptyCompose, open: true });
  };

  const openReply = () => {
    if (!selectedMessage) return;
    setCompose({
      open: true,
      replyToMessageID: selectedMessage.id,
      to: formatAddressList(selectedMessage.from),
      cc: "",
      bcc: "",
      subject: selectedMessage.subject?.toLowerCase().startsWith("re:") ? selectedMessage.subject : `Re: ${selectedMessage.subject || ""}`.trim(),
      body: "",
    });
  };

  const submitCompose = async (event: React.FormEvent) => {
    event.preventDefault();
    const to = parseEmailAddressList(compose.to);
    const cc = parseEmailAddressList(compose.cc);
    const bcc = parseEmailAddressList(compose.bcc);
    if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    if (!compose.subject.trim() && !compose.body.trim()) {
      setError("Add a subject or message body.");
      return;
    }
    setBusy("send");
    setError("");
    try {
      await sendEmail({
        to,
        cc,
        bcc,
        subject: compose.subject.trim(),
        body: compose.body.trim(),
        reply_to_message_id: compose.replyToMessageID || undefined,
      });
      setCompose(emptyCompose);
      setNotice("Message sent.");
      await loadMessages();
    } catch (sendError) {
      setError(formatError(sendError, "Failed to send message"));
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={embedded ? { ...pageStyle, height: "100%" } : pageStyle}>
      {!embedded && (
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h1 style={brandStyle}>
            <MangoWordmark size={22} weight={500} />
          </h1>
          <span style={headerDividerStyle} />
          <span style={titleStyle}>Communications</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {me && <span style={userPillStyle}>{me.user.display_name?.trim() || me.user.email}</span>}
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/")}>MangoRTS</button>
          <button style={headerButtonStyle} onPointerEnter={preloadLogicGateArenaSurface} onFocus={preloadLogicGateArenaSurface} onPointerDown={preloadLogicGateArenaSurface} onClick={() => onNavigate?.("/logic-gate-arena")}>Logic Gate Arena</button>
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/settings")}>Settings</button>
        </div>
      </header>
      )}

      {error && <div style={errorStyle}>{error}</div>}
      {notice && <div style={noticeStyle}>{notice}</div>}

      {loadingStatus ? (
        <main style={centerStyle}>Loading email connection</main>
      ) : !status?.configured ? (
        <main style={centerStyle}>
          <section style={connectPanelStyle}>
            <h2 style={panelTitleStyle}>Email is not configured</h2>
            <p style={mutedTextStyle}>Set the Nylas environment variables on the backend, then restart the API.</p>
          </section>
        </main>
      ) : !status.connected ? (
        <main style={centerStyle}>
          <section style={connectPanelStyle}>
            <h2 style={panelTitleStyle}>Connect your company email</h2>
            <p style={mutedTextStyle}>Mango will ask Nylas for access to your existing mailbox. Email stays in your provider.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button style={primaryButtonStyle} disabled={!!busy} onClick={() => startConnection("google")}>
                {busy === "google" ? "Opening" : "Connect Google"}
              </button>
              <button style={primaryButtonStyle} disabled={!!busy} onClick={() => startConnection("microsoft")}>
                {busy === "microsoft" ? "Opening" : "Connect Microsoft"}
              </button>
            </div>
          </section>
        </main>
      ) : (
        <main style={{ ...workspaceStyle, gridTemplateColumns: isNarrow ? "1fr" : "minmax(320px, 430px) minmax(0, 1fr)" }}>
          <section style={panelStyle}>
            <div style={mailListToolbarStyle}>
              <MailboxSelect value={mailbox} options={MAILBOX_OPTIONS} onChange={selectMailbox} />
              <button style={primaryButtonStyle} onClick={openNewCompose}>Compose</button>
            </div>
            <div style={accountRowStyle}>
              <span style={mutedSmallStyle}>{connection?.account_email}</span>
              <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={disconnect}>Disconnect</button>
            </div>
            <form style={searchRowStyle} onSubmit={submitSearch}>
              <input
                style={inputStyle}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search mail"
              />
              <button style={smallButtonStyle}>Search</button>
            </form>
            <label style={checkboxStyle}>
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => {
                  setUnreadOnly(event.target.checked);
                  setPageToken("");
                  setPageStack([]);
                }}
              />
              <span>Unread only</span>
            </label>
            <div style={listHeaderStyle}>
              <span>{mailboxLabel(mailbox)}</span>
              {loadingMessages && <span>Loading</span>}
            </div>
            <div style={messageListStyle}>
              {messages.length === 0 && !loadingMessages ? (
                <div style={emptyStateStyle}>No messages</div>
              ) : messages.map((message) => (
                <button
                  key={message.id}
                  style={messageRowStyle(selectedMessageID === message.id, message.unread)}
                  onClick={() => setSelectedMessageID(message.id)}
                >
                  <span style={messageRowTopStyle}>
                    <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                    <span>{formatMessageDate(message.date)}</span>
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(no subject)"}</span>
                  <span style={snippetStyle}>{message.snippet || ""}</span>
                </button>
              ))}
            </div>
            <div style={paginationStyle}>
              <button
                style={smallButtonStyle}
                disabled={pageStack.length === 0 || loadingMessages}
                onClick={() => {
                  const previous = [...pageStack];
                  const next = previous.pop() ?? "";
                  setPageStack(previous);
                  setPageToken(next);
                }}
              >
                Previous
              </button>
              <button
                style={smallButtonStyle}
                disabled={!nextPageToken || loadingMessages}
                onClick={() => {
                  setPageStack((previous) => [...previous, pageToken]);
                  setPageToken(nextPageToken);
                }}
              >
                Next
              </button>
            </div>
          </section>

          <section style={panelStyle}>
            {compose.open ? (
              <ComposePanel
                compose={compose}
                busy={busy === "send"}
                onChange={setCompose}
                onCancel={() => setCompose(emptyCompose)}
                onSubmit={submitCompose}
              />
            ) : selectedMessage ? (
              <MessageDetail
                message={selectedMessage}
                loading={loadingDetail}
                archiveAvailable={!!archiveFolder}
                busy={!!busy}
                onReply={openReply}
                onArchive={archiveSelected}
                onDelete={deleteSelected}
                onToggleRead={() => patchSelectedMessage({ unread: !selectedMessage.unread })}
                onToggleStar={() => patchSelectedMessage({ starred: !selectedMessage.starred })}
              />
            ) : (
              <div style={emptyStateStyle}>Select a message or compose a new one</div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

export const CommunicationsFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "mango" | "teal" | "light" | "dark" }> = () => (
  <CommunicationsPage embedded />
);

function MailboxSelect({ value, options, onChange }: {
  value: EmailMailbox;
  options: MailboxOption[];
  onChange: (value: EmailMailbox) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClosePopover(open, rootRef, close);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <span ref={rootRef} style={{ position: "relative", display: "block", minWidth: 0 }}>
      <button
        type="button"
        aria-label="Mailbox"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{ ...selectButtonStyle, borderColor: open ? "rgba(255, 136, 32, 0.92)" : selectButtonStyle.borderColor }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected?.label ?? "Mailbox"}</span>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: "rgb(255, 136, 32)" }}>
          <DisclosureIcon open={open} />
        </span>
      </button>
      {open && (
        <div role="listbox" aria-label="Mailbox" className="company-explorer-scroll" style={selectMenuStyle}>
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{ ...selectOptionButtonStyle, background: selectedOption ? "rgba(255, 136, 32, 0.18)" : "#ffffff" }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center" }}>
                  {selectedOption ? <CheckIcon /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function useClosePopover(open: boolean, ref: React.RefObject<HTMLElement>, onClose: () => void): void {
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

function DisclosureIcon({ open, color = "currentColor" }: { open: boolean; color?: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
      <path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ color = "rgb(255, 136, 32)" }: { color?: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
      <path d="M3.2 8.2 6.4 11.4 12.9 4.6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ComposePanel({ compose, busy, onChange, onCancel, onSubmit }: {
  compose: ComposeState;
  busy: boolean;
  onChange: (next: ComposeState) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const update = (patch: Partial<ComposeState>) => onChange({ ...compose, ...patch });
  return (
    <form style={composeStyle} onSubmit={onSubmit}>
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{compose.replyToMessageID ? "Reply" : "New Message"}</h2>
        <button type="button" style={smallButtonStyle} onClick={onCancel}>Close</button>
      </div>
      <input style={inputStyle} value={compose.to} onChange={(event) => update({ to: event.target.value })} placeholder="To" />
      <input style={inputStyle} value={compose.cc} onChange={(event) => update({ cc: event.target.value })} placeholder="Cc" />
      <input style={inputStyle} value={compose.bcc} onChange={(event) => update({ bcc: event.target.value })} placeholder="Bcc" />
      <input style={inputStyle} value={compose.subject} onChange={(event) => update({ subject: event.target.value })} placeholder="Subject" />
      <textarea style={textareaStyle} value={compose.body} onChange={(event) => update({ body: event.target.value })} placeholder="Message" />
      <button style={primaryButtonStyle} disabled={busy}>{busy ? "Sending" : "Send"}</button>
    </form>
  );
}

function MessageDetail({ message, loading, archiveAvailable, busy, onReply, onArchive, onDelete, onToggleRead, onToggleStar }: {
  message: EmailMessage;
  loading: boolean;
  archiveAvailable: boolean;
  busy: boolean;
  onReply: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div style={detailStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={detailSubjectStyle}>{message.subject || "(no subject)"}</h2>
          <div style={mutedSmallStyle}>From {formatAddressList(message.from) || "Unknown sender"} to {formatAddressList(message.to) || "me"}</div>
        </div>
        {loading && <span style={mutedSmallStyle}>Loading</span>}
      </div>
      <div style={toolbarStyle}>
        <button style={smallButtonStyle} disabled={busy} onClick={onReply}>Reply</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleRead}>{message.unread ? "Mark read" : "Mark unread"}</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleStar}>{message.starred ? "Unstar" : "Star"}</button>
        <button style={smallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>Archive</button>
        <button style={{ ...smallButtonStyle, ...dangerButtonStyle }} disabled={busy} onClick={onDelete}>Delete</button>
      </div>
      <iframe title="Email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={iframeStyle} />
    </div>
  );
}

function findSystemFolder(folders: EmailFolder[], system: string): EmailFolder | null {
  const normalized = system.toLowerCase();
  return folders.find((folder) => {
    const systemFolder = (folder.system_folder || "").toLowerCase();
    const name = (folder.name || folder.display_name || "").toLowerCase();
    const attributes = (folder.attributes ?? []).map((item) => item.toLowerCase());
    return systemFolder === normalized || name === normalized || attributes.includes(`\\${normalized}`);
  }) ?? null;
}

function mailboxLabel(mailbox: EmailMailbox): string {
  return MAILBOX_OPTIONS.find((option) => option.value === mailbox)?.label ?? "Mail";
}

function formatAddressList(addresses?: EmailAddress[]): string {
  if (!addresses?.length) return "";
  return addresses.map((address) => address.name ? `${address.name} <${address.email}>` : address.email).join(", ");
}

function formatMessageDate(epochSeconds?: number): string {
  if (!epochSeconds) return "";
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}</style></head><body>${content}</body></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function formatErrorCode(code: string): string {
  switch (code) {
    case "nylas_email_mismatch":
      return "Connect the same email address you use for Mango.";
    case "nylas_state_expired":
      return "Email connection expired. Start the connection again.";
    case "nylas_not_configured":
      return "Nylas is not configured on the backend.";
    default:
      return code.replace(/_/g, " ");
  }
}

const pageStyle: React.CSSProperties = {
  height: "100vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  color: "#24120a",
  fontFamily: "var(--mango-font-family)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  padding: "0 18px",
  borderBottom: "1px solid rgba(255, 136, 32, 0.25)",
  background: "#ffffff",
};

const brandStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  lineHeight: 1,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
};

const headerDividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: "rgba(255, 136, 32, 0.25)",
};

const userPillStyle: React.CSSProperties = {
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
};

const workspaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  gap: 10,
  padding: 10,
  overflow: "auto",
};

const panelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto",
  gap: 10,
  padding: 10,
  border: "1px solid rgba(255, 136, 32, 0.22)",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

const connectPanelStyle: React.CSSProperties = {
  width: "min(460px, calc(100vw - 28px))",
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid rgba(255, 136, 32, 0.24)",
  background: "#ffffff",
  borderRadius: 8,
};

const centerStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
};

const mutedTextStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 12,
  lineHeight: 1.45,
};

const mutedSmallStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  overflowWrap: "anywhere",
};

const smallButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(255, 136, 32, 0.32)",
  borderRadius: 6,
  background: "#fff",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  padding: "0 9px",
};

const headerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid rgba(255, 136, 32, 0.62)",
  background: "linear-gradient(180deg, rgba(9, 31, 38, 0.84), rgba(5, 18, 23, 0.72))",
  color: "#e8fbff",
  fontWeight: 500,
  boxShadow: "0 0 0 1px rgba(255, 136, 32, 0.12) inset, 0 8px 20px rgba(0, 0, 0, 0.18)",
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid #ff8820",
  borderRadius: 6,
  background: "linear-gradient(90deg, rgba(251, 177, 82, 1), rgba(254, 169, 78, 1), rgba(254, 155, 70, 1), rgba(255, 136, 32, 1))",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  padding: "0 10px",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#ff3d7f",
  color: "#8b123f",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 6,
  padding: "0 9px",
  font: "inherit",
  fontSize: 12,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: "min(280px, 34vh)",
  resize: "vertical",
  padding: 9,
  lineHeight: 1.45,
};

const mailListToolbarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
};

const accountRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
};

const selectButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 18px",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(255, 136, 32, 0.44)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "0 10px",
  textAlign: "left",
};

const selectMenuStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 40,
  top: "calc(100% + 6px)",
  left: 0,
  width: "min(260px, 78vw)",
  maxHeight: 220,
  overflowY: "auto",
  overflowX: "hidden",
  padding: 5,
  border: "1px solid rgba(255, 136, 32, 0.58)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#24120a",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.14), 0 0 0 1px rgba(255, 136, 32, 0.12) inset",
};

const selectOptionButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 32,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 18px",
  alignItems: "center",
  gap: 8,
  border: "none",
  borderRadius: 6,
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "7px 8px",
  textAlign: "left",
};

const searchRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
};

const checkboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 11,
};

const listHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 11,
  fontWeight: 600,
};

const messageListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 6,
};

function messageRowStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    minHeight: 78,
    border: `1px solid ${active ? "#ff8820" : unread ? "rgba(255, 136, 32, 0.45)" : "rgba(255, 136, 32, 0.16)"}`,
    borderRadius: 7,
    background: active ? "#fff2e0" : unread ? "#fff7ed" : "#ffffff",
    cursor: "pointer",
    color: "#24120a",
    font: "inherit",
    fontSize: 12,
    padding: 9,
    textAlign: "left",
    minWidth: 0,
  };
}

const messageRowTopStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  fontSize: 11,
};

const snippetStyle: React.CSSProperties = {
  overflow: "hidden",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  lineHeight: 1.35,
};

const paginationStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};

const detailStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 10,
};

const detailSubjectStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const iframeStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 0,
  height: "100%",
  border: "1px solid rgba(255, 136, 32, 0.16)",
  borderRadius: 6,
  background: "#fff",
};

const composeStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gap: 8,
  alignContent: "start",
};

const emptyStateStyle: React.CSSProperties = {
  minHeight: 120,
  display: "grid",
  placeItems: "center",
  color: "rgba(36, 18, 10, 0.56)",
  fontSize: 12,
};

const errorStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff0f4",
  color: "#8b123f",
  borderBottom: "1px solid rgba(255, 61, 127, 0.28)",
  fontSize: 12,
};

const noticeStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#effff6",
  color: "#0f7b3f",
  borderBottom: "1px solid rgba(15, 123, 63, 0.22)",
  fontSize: 12,
  fontWeight: 600,
};
