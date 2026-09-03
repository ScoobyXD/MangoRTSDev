import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, getAuthSessionCacheGeneration, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import {
  ASSISTANT_MAX_MESSAGE_CHARS, ASSISTANT_STOP_MESSAGE, assistantErrorMessage, assistantHistoryError,
  getAssistantStatus, streamAssistantChat, type AssistantMessage,
} from "../modules/assistant/assistantApi.js";

type Props = { apiBase: string; userID: string; leftInset: number; bottomInset: number };
type Turn = { question: string; reply: string; status: "running" | "complete" | "stopped" | "failed"; notice: string };

function AssistantToggleIcon({ direction }: { direction: "up" | "down" }) {
  const path = direction === "up" ? "M5 15l7-7 7 7" : "M5 9l7 7 7-7";
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function subscribeCompany(listener: () => void): () => void {
  window.addEventListener(ACTIVE_COMPANY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACTIVE_COMPANY_CHANGED_EVENT, listener);
}

export function AppAssistant(props: Props) {
  const companyID = useSyncExternalStore(subscribeCompany, getActiveCompanyID);
  const authGeneration = useSyncExternalStore(addAuthTerminalFailureListener, getAuthSessionCacheGeneration);
  return <AssistantSession key={`${props.userID}:${companyID}:${authGeneration}`} {...props} companyID={companyID} />;
}

function AssistantSession({ apiBase, companyID, leftInset, bottomInset }: Props & { companyID: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const focusToggleAfterChange = useRef(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const panelID = React.useId();
  const transcriptID = React.useId();

  useLayoutEffect(() => () => { activeRequest.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (isTerminalAuthFailureActive()) {
      setAvailable(false);
      setAvailabilityMessage("Sign in to use Mango chat.");
      return;
    }
    void getAssistantStatus(apiBase, companyID, controller.signal).then((status) => {
      if (controller.signal.aborted) return;
      setAvailable(status.available);
      if (!status.available) setAvailabilityMessage("Mango chat is unavailable. Ask your administrator to configure it.");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setAvailable(false);
      setAvailabilityMessage(assistantErrorMessage(error));
    });
    return () => controller.abort();
  }, [apiBase, companyID]);

  useLayoutEffect(() => {
    if (!focusToggleAfterChange.current) return;
    focusToggleAfterChange.current = false;
    (panelOpen ? collapseButtonRef : expandButtonRef).current?.focus();
  }, [panelOpen]);

  useLayoutEffect(() => {
    if (panelOpen && followReply.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [panelOpen, turns]);

  const history: AssistantMessage[] = turns.filter((turn) => turn.status === "complete" && turn.reply.trim()).flatMap((turn) => [
    { role: "user" as const, content: turn.question }, { role: "assistant" as const, content: turn.reply },
  ]);
  const historyError = assistantHistoryError([...history, { role: "user", content: draft.trim() }]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (activeRequest.current || !available || !question || question.length > ASSISTANT_MAX_MESSAGE_CHARS || historyError) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const index = turns.length;
    setTurns((current) => [...current, { question, reply: "", status: "running", notice: "Thinking…" }]);
    setDraft("");
    setRunning(true);
    followReply.current = true;
    const update = (changes: Partial<Turn>) => setTurns((current) => current.map((turn, turnIndex) => turnIndex === index ? { ...turn, ...changes } : turn));
    let reply = "";
    try {
      await streamAssistantChat(apiBase, companyID, [...history, { role: "user", content: question }], controller.signal, (message) => {
        if (controller.signal.aborted) return;
        if (message.type === "text") {
          reply += message.text;
          update({ reply, notice: "" });
        } else if (message.type === "tool") {
          update({ notice: message.status === "running" ? "Working in Mango…" : "Preparing reply…" });
        } else if (message.type === "done") {
          update({ status: "complete", notice: reply ? "" : "Finished without a text reply." });
        } else {
          update({ status: "failed", notice: message.message });
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) update({ status: "failed", notice: assistantErrorMessage(error) });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setRunning(false);
      }
    }
  };

  const stop = () => {
    activeRequest.current?.abort();
    setTurns((current) => current.map((turn) => turn.status === "running" ? { ...turn, status: "stopped", notice: ASSISTANT_STOP_MESSAGE } : turn));
  };

  const setPanelVisibility = (open: boolean) => {
    focusToggleAfterChange.current = true;
    setPanelOpen(open);
  };

  return <aside className="mango-assistant" aria-label="Mango chat" style={{ left: leftInset, bottom: bottomInset }}>
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
        {turns.length > 0 && <section className="mango-assistant-transcript" id={transcriptID} aria-label="Chat transcript">
        <header>
          <strong>Mango chat</strong>
          <button type="button" disabled={running || turns.length === 0} onClick={() => { setTurns([]); setDraft(""); }}>Clear chat</button>
        </header>
        <div className="mango-assistant-messages mango-home-scroll" ref={transcriptRef} onScroll={(event) => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}>
          {turns.map((turn, index) => <React.Fragment key={index}>
            <div className="mango-assistant-message mango-assistant-question"><strong>You</strong><p>{turn.question}</p></div>
            <div className="mango-assistant-message" data-assistant-turn-status={turn.status}>
              <strong>Mango</strong>
              {turn.reply && <p>{turn.reply}</p>}
              {turn.notice && <p className="mango-assistant-hint" role="status">{turn.notice}</p>}
            </div>
          </React.Fragment>)}
        </div>
        </section>}
        <form className="mango-assistant-composer" onSubmit={(event) => { void send(event); }}>
          <input aria-label="Message Mango" placeholder={available === null ? "Checking Mango chat…" : "Ask Mango…"} value={draft} maxLength={ASSISTANT_MAX_MESSAGE_CHARS} disabled={!available || running} onChange={(event) => setDraft(event.currentTarget.value)} />
          {running
            ? <button type="button" className="mango-assistant-send" onClick={stop}>Stop</button>
            : <button type="submit" className="mango-assistant-send" disabled={!available || !draft.trim() || Boolean(historyError)}>Send</button>}
        </form>
        {(availabilityMessage || historyError) && <p className="mango-assistant-availability" role="status">{availabilityMessage || historyError}</p>}
      </div>
    </div>
  </aside>;
}
