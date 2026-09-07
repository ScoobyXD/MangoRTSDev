import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import { AIComposer } from "../modules/ai/AIComposer.js";
import { useAIChat } from "../modules/ai/useAIChat.js";

function AIToggleIcon({ direction }: { direction: "up" | "down" }) {
  const path = direction === "up" ? "M5 15l7-7 7 7" : "M5 9l7 7 7-7";
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

type Props = { apiBase: string; userID: string; bottomInset: number };

function subscribeCompany(listener: () => void) {
  window.addEventListener(ACTIVE_COMPANY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACTIVE_COMPANY_CHANGED_EVENT, listener);
}

export function AppAI(props: Props) {
  const companyID = useSyncExternalStore(subscribeCompany, getActiveCompanyID);
  const authFailed = useSyncExternalStore(addAuthTerminalFailureListener, isTerminalAuthFailureActive);
  return <AISession key={`${props.apiBase}:${props.userID}:${companyID}:${authFailed}`} {...props} companyID={companyID} />;
}

function AISession({ apiBase, companyID, bottomInset }: Props & { companyID: string }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [composerVersion, setComposerVersion] = useState(0);
  const [dictationBusy, setDictationBusy] = useState(false);
  const chat = useAIChat(apiBase, companyID, panelOpen);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const lastVisibleMessage = useRef<string | number | undefined>();
  const focusToggleAfterChange = useRef(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const panelID = React.useId();

  useLayoutEffect(() => {
    if (!focusToggleAfterChange.current) return;
    focusToggleAfterChange.current = false;
    (panelOpen ? collapseButtonRef : expandButtonRef).current?.focus();
  }, [panelOpen]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    const lastID = chat.messages[chat.messages.length - 1]?.message_id;
    if (transcript) transcript.scrollTop = chat.reply || lastID !== lastVisibleMessage.current ? transcript.scrollHeight : 0;
    lastVisibleMessage.current = lastID;
  }, [chat.messages, chat.reply]);

  const send = async (message: string) => {
    const accepted = await chat.send(message);
    if (accepted) setDraft((current) => current.trim() === message ? "" : current);
    return accepted;
  };

  const resetDraft = () => {
    setDraft("");
    setComposerVersion((version) => version + 1);
  };

  const setPanelVisibility = (open: boolean) => {
    focusToggleAfterChange.current = true;
    setPanelOpen(open);
  };

  return <aside className="mango-ai" aria-label="AI chat" style={{ bottom: bottomInset }}>
    <button
      ref={expandButtonRef}
      type="button"
      className="mango-ai-expand"
      aria-label="Expand AI chat"
      aria-expanded={false}
      aria-controls={panelID}
      hidden={panelOpen}
      onClick={() => setPanelVisibility(true)}
    ><AIToggleIcon direction="up" /></button>
    <div className="mango-ai-expanded" hidden={!panelOpen}>
      <button
        ref={collapseButtonRef}
        type="button"
        className="mango-ai-collapse"
        aria-label="Collapse AI chat"
        aria-expanded={true}
        aria-controls={panelID}
        onClick={() => setPanelVisibility(false)}
      ><AIToggleIcon direction="down" /></button>
      <div className="mango-ai-panel" id={panelID}>
        <header className="mango-ai-header">
          <strong>AI chat</strong>
          <select aria-label="Saved chats" value={chat.chatID} disabled={chat.busy || !!chat.runID || !!chat.pending}
            onChange={(event) => { resetDraft(); if (event.currentTarget.value) void chat.load(event.currentTarget.value); else void chat.newChat(); }}>
            <option value="">New chat</option>
            {chat.chats.map((saved) => <option key={saved.chat_id} value={saved.chat_id}>{saved.name || "Unnamed chat"}</option>)}
          </select>
          <button type="button" disabled={chat.busy || !!chat.runID || !!chat.pending} onClick={() => { void chat.newChat(); resetDraft(); }}>New chat</button>
          {chat.nextOffset !== null && <button type="button" disabled={chat.busy || !!chat.runID || !!chat.pending} onClick={() => { void chat.loadOlder(); }}>Load older chats</button>}
        </header>
        <div className="mango-ai-transcript" ref={transcriptRef} role="log" aria-label="Chat" aria-live="polite" aria-relevant="additions text">
          {chat.nextMessageOffset !== null && <button type="button" disabled={chat.busy || !!chat.runID || !!chat.pending} onClick={() => { void chat.loadEarlierMessages(); }}>Load earlier messages</button>}
          {!chat.messages.length && !chat.busy && !chat.runID && <p className="mango-ai-empty">Ask AI a question or request an action in your workspace.</p>}
          {chat.messages.filter((message) => (message.role === "user" || message.role === "ai") && typeof message.content === "string" && message.content.trim())
            .map((message) => <article key={message.message_id} className="mango-ai-message" data-role={message.role}>
              <strong>{message.role === "user" ? "You" : "AI"}</strong><p>{message.content}</p>
            </article>)}
          {!!chat.runID && <article className="mango-ai-message" data-role="ai"><strong>AI</strong><p>{chat.reply || (chat.connected ? "Working…" : "Response paused. Resume to check its progress.")}</p></article>}
        </div>
        <div className="mango-ai-run-status">
          {chat.busy && <p role="status">Loading…</p>}
          {chat.notice && <p role="status">{chat.notice}</p>}
          {chat.error && <p role="alert">{chat.error}</p>}
          {chat.pending && <div className="mango-ai-pending"><p>A send needs to be checked: “{chat.pending.message}”</p>
            <button type="button" disabled={chat.busy || chat.stopping || dictationBusy} onClick={() => { void send(chat.pending!.message); }}>Retry saved message</button>
          </div>}
          {(chat.runID || chat.pending) && <button type="button" disabled={chat.busy || chat.stopping} onClick={() => { void chat.stop(); }}>{chat.stopping ? "Stopping…" : "Stop response"}</button>}
          {!chat.connected && !chat.busy && !chat.pending && (chat.runID || chat.error || chat.historyPending) && <button type="button" onClick={chat.resume}>Resume</button>}
        </div>
        <AIComposer key={composerVersion} apiBase={apiBase} companyID={companyID} visible={panelOpen}
          sending={chat.busy || !!chat.runID || !!chat.pending} submitting={chat.busy && !!chat.pending} onDictationBusyChange={setDictationBusy}
          draft={draft} setDraft={setDraft} onSend={send} />
      </div>
    </div>
  </aside>;
}
