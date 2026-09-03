import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, getAuthSessionCacheGeneration, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import {
  ASSISTANT_MAX_MESSAGE_CHARS, ASSISTANT_STOP_MESSAGE, assistantErrorMessage, assistantHistoryError,
  getAssistantStatus, streamAssistantChat, type AssistantMessage,
} from "../modules/assistant/assistantApi.js";

type Props = { apiBase: string; userID: string; leftInset: number; bottomInset: number };
type Turn = { question: string; reply: string; status: "running" | "complete" | "stopped" | "failed"; notice: string };

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
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
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
    if (expanded && followReply.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [expanded, turns]);

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
    setExpanded(true);
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

  return <aside className="mango-assistant" aria-label="Mango chat" style={{ left: leftInset, bottom: bottomInset }}>
    <div className="mango-assistant-panel">
      {expanded && <section className="mango-assistant-transcript" id={transcriptID} aria-label="Chat transcript">
        <header>
          <strong>Mango chat</strong>
          <button type="button" disabled={running || turns.length === 0} onClick={() => { setTurns([]); setDraft(""); }}>Clear chat</button>
          <button type="button" aria-label="Collapse chat transcript" onClick={() => setExpanded(false)}>Collapse</button>
        </header>
        <div className="mango-assistant-messages mango-home-scroll" ref={transcriptRef} onScroll={(event) => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}>
          {turns.length === 0 && <p className="mango-assistant-hint">Ask about your Mango work or request a change.</p>}
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
        <button type="button" className="mango-assistant-toggle" aria-label={expanded ? "Collapse chat transcript" : "Expand chat transcript"} aria-expanded={expanded} aria-controls={transcriptID} onClick={() => setExpanded((current) => !current)}>{expanded ? "⌄" : "⌃"}</button>
        <input aria-label="Message Mango" placeholder={available === null ? "Checking Mango chat…" : "Ask Mango…"} value={draft} maxLength={ASSISTANT_MAX_MESSAGE_CHARS} disabled={!available || running} onChange={(event) => setDraft(event.currentTarget.value)} />
        {running
          ? <button type="button" className="mango-assistant-send" onClick={stop}>Stop</button>
          : <button type="submit" className="mango-assistant-send" disabled={!available || !draft.trim() || Boolean(historyError)}>Send</button>}
      </form>
      {(availabilityMessage || historyError) && <p className="mango-assistant-availability" role="status">{availabilityMessage || historyError}</p>}
    </div>
  </aside>;
}
