import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import { AssistantComposer } from "../modules/assistant/AssistantComposer.js";
import { useAssistantConversation } from "../modules/assistant/useAssistantConversation.js";

function AssistantToggleIcon({ direction }: { direction: "up" | "down" }) {
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

export function AppAssistant(props: Props) {
  const companyID = useSyncExternalStore(subscribeCompany, getActiveCompanyID);
  const authFailed = useSyncExternalStore(addAuthTerminalFailureListener, isTerminalAuthFailureActive);
  return <AssistantSession key={`${props.apiBase}:${props.userID}:${companyID}:${authFailed}`} {...props} companyID={companyID} />;
}

function AssistantSession({ apiBase, companyID, bottomInset }: Props & { companyID: string }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [composerVersion, setComposerVersion] = useState(0);
  const [dictationBusy, setDictationBusy] = useState(false);
  const chat = useAssistantConversation(apiBase, companyID, panelOpen);
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
    const lastID = chat.messages[chat.messages.length - 1]?.id;
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

  return <aside className="mango-assistant" aria-label="Mango chat" style={{ bottom: bottomInset }}>
    <button
      ref={expandButtonRef}
      type="button"
      className="mango-assistant-expand"
      aria-label="Expand Mango chat"
      aria-expanded={false}
      aria-controls={panelID}
      hidden={panelOpen}
      onClick={() => setPanelVisibility(true)}
    ><AssistantToggleIcon direction="up" /></button>
    <div className="mango-assistant-expanded" hidden={!panelOpen}>
      <button
        ref={collapseButtonRef}
        type="button"
        className="mango-assistant-collapse"
        aria-label="Collapse Mango chat"
        aria-expanded={true}
        aria-controls={panelID}
        onClick={() => setPanelVisibility(false)}
      ><AssistantToggleIcon direction="down" /></button>
      <div className="mango-assistant-panel" id={panelID}>
        <header className="mango-assistant-header">
          <strong>Mango chat</strong>
          <select aria-label="Saved conversations" value={chat.conversationID} disabled={chat.busy || !!chat.runID || !!chat.pending}
            onChange={(event) => { resetDraft(); if (event.currentTarget.value) void chat.load(event.currentTarget.value); else chat.newConversation(); }}>
            <option value="">New conversation</option>
            {chat.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title || "Untitled conversation"}</option>)}
          </select>
          <button type="button" disabled={chat.busy || !!chat.runID || !!chat.pending} onClick={() => { chat.newConversation(); resetDraft(); }}>New chat</button>
          {chat.nextOffset !== null && <button type="button" disabled={chat.busy || !!chat.runID || !!chat.pending} onClick={() => { void chat.loadOlder(); }}>Load older chats</button>}
        </header>
        <div className="mango-assistant-transcript" ref={transcriptRef} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
          {chat.nextMessageOffset !== null && <button type="button" disabled={chat.busy || !!chat.runID || !!chat.pending} onClick={() => { void chat.loadEarlierMessages(); }}>Load earlier messages</button>}
          {!chat.messages.length && !chat.busy && !chat.runID && <p className="mango-assistant-empty">Ask Mango a question or request an action in your workspace.</p>}
          {chat.messages.filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim())
            .map((message) => <article key={message.id} className="mango-assistant-message" data-role={message.role}>
              <strong>{message.role === "user" ? "You" : "Mango"}</strong><p>{message.content}</p>
            </article>)}
          {!!chat.runID && <article className="mango-assistant-message" data-role="assistant"><strong>Mango</strong><p>{chat.reply || (chat.connected ? "Working…" : "Response paused. Resume to check its progress.")}</p></article>}
        </div>
        <div className="mango-assistant-run-status">
          {chat.busy && <p role="status">Loading…</p>}
          {chat.notice && <p role="status">{chat.notice}</p>}
          {chat.error && <p role="alert">{chat.error}</p>}
          {chat.pending && <div className="mango-assistant-pending"><p>A send needs to be checked: “{chat.pending.message}”</p>
            <button type="button" disabled={chat.busy || dictationBusy} onClick={() => { void send(chat.pending!.message); }}>Retry saved message</button>
          </div>}
          {!!chat.runID && <button type="button" disabled={chat.stopping} onClick={() => { void chat.stop(); }}>{chat.stopping ? "Stopping…" : "Stop response"}</button>}
          {!chat.connected && !chat.busy && !chat.pending && (chat.runID || chat.error) && <button type="button" onClick={chat.resume}>Resume</button>}
        </div>
        <AssistantComposer key={composerVersion} apiBase={apiBase} companyID={companyID} visible={panelOpen}
          sending={chat.busy || !!chat.runID || !!chat.pending} submitting={chat.busy && !!chat.pending} onDictationBusyChange={setDictationBusy}
          draft={draft} setDraft={setDraft} onSend={send} />
      </div>
    </div>
  </aside>;
}
