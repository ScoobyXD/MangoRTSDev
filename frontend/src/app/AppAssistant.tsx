import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, getAuthSessionCacheGeneration, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import {
  ASSISTANT_DEFAULT_REASONING_EFFORT, ASSISTANT_MAX_MESSAGE_CHARS, ASSISTANT_REASONING_EFFORTS,
  ASSISTANT_STOP_MESSAGE, assistantErrorMessage, assistantHistoryError, getAssistantStatus,
  isAssistantReasoningEffort, streamAssistantChat, type AssistantMessage, type AssistantReasoningEffort, type AssistantEvent,
} from "../modules/assistant/assistantApi.js";
import { createRequestJSON } from "../modules/api/requestJSON.js";
import { openEditorEntityLink } from "../modules/editor/editorEntityLinks.js";
import { AssistantComposer, type AssistantComposerHandle, type AssistantProcess } from "../modules/assistant/AssistantComposer.js";
import { AppModalPortal } from "./AppModalPortal.js";

type Props = { apiBase: string; userID: string; bottomInset: number };
type ContextSnapshot = Extract<AssistantEvent, { type: "context" }>["context"];
type Turn = { question: string; reply: string; status: "running" | "complete" | "stopped" | "failed"; notice: string; process?: AssistantProcess; nodeID?: string; contexts: ContextSnapshot[] };
const ASSISTANT_REASONING_STORAGE_KEY = "mangorts.assistant.reasoningEffort.v1";
const ASSISTANT_REASONING_LABELS: Record<AssistantReasoningEffort, string> = {
  low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum",
};

function loadReasoningEffort(): AssistantReasoningEffort {
  try {
    const saved = window.localStorage.getItem(ASSISTANT_REASONING_STORAGE_KEY);
    if (saved && isAssistantReasoningEffort(saved)) return saved;
  } catch {
    // A blocked localStorage must not block chat.
  }
  return ASSISTANT_DEFAULT_REASONING_EFFORT;
}

function saveReasoningEffort(effort: AssistantReasoningEffort): void {
  try {
    window.localStorage.setItem(ASSISTANT_REASONING_STORAGE_KEY, effort);
  } catch {
    // The current session still uses the selected value.
  }
}

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

function AssistantSession({ apiBase, companyID, bottomInset }: Props & { companyID: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedProcess, setSelectedProcess] = useState<AssistantProcess | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [canInspectContext, setCanInspectContext] = useState(false);
  const [inspectContext, setInspectContext] = useState(false);
  const [inspectedTurn, setInspectedTurn] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState(loadReasoningEffort);
  const [running, setRunning] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const composerRef = useRef<AssistantComposerHandle>(null);
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
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
      setCanInspectContext(status.can_inspect_context === true);
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
  const historyError = draft.length > ASSISTANT_MAX_MESSAGE_CHARS ? "Keep your message under 8,000 characters." : assistantHistoryError([...history, { role: "user", content: draft.trim() }]);

  const send = async () => {
    const question = draft.trim();
    if (activeRequest.current || pickerOpen || !available || !question || question.length > ASSISTANT_MAX_MESSAGE_CHARS || historyError) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const index = turns.length;
    const process = selectedProcess ?? undefined;
    const inspecting = canInspectContext && inspectContext;
    setTurns((current) => [...current, { question, reply: "", status: "running", notice: "Thinking…", process, contexts: [] }]);
    composerRef.current?.clearMessage();
    setInspectContext(false);
    setRunning(true);
    followReply.current = true;
    const update = (changes: Partial<Turn>) => setTurns((current) => current.map((turn, turnIndex) => turnIndex === index ? { ...turn, ...changes } : turn));
    let reply = "";
    try {
      await streamAssistantChat(apiBase, companyID, [...history, { role: "user", content: question }], reasoningEffort, controller.signal, (message) => {
        if (controller.signal.aborted) return;
        if (message.type === "text") {
          reply += message.text;
          update({ reply, notice: "" });
        } else if (message.type === "tool") {
          update({ notice: message.status === "running" ? "Working in Mango…" : "Preparing reply…" });
        } else if (message.type === "node") {
          if (process?.id === message.process_id) update({ nodeID: message.node_id });
        } else if (message.type === "context") {
          if (inspecting) setTurns((current) => current.map((turn, turnIndex) => turnIndex === index ? { ...turn, contexts: [...turn.contexts, message.context] } : turn));
        } else if (message.type === "done") {
          update({ status: "complete", notice: reply ? "" : "Finished without a text reply." });
        } else {
          update({ status: "failed", notice: message.message });
        }
      }, process?.id, inspecting);
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
        {turns.length > 0 && <section className="mango-assistant-transcript" id={transcriptID} aria-label="Chat transcript">
        <header>
          <strong>Mango chat</strong>
          <button type="button" disabled={running || turns.length === 0} onClick={() => { setTurns([]); composerRef.current?.clear(); setInspectContext(false); setInspectedTurn(null); }}>Clear chat</button>
        </header>
        <div className="mango-assistant-messages mango-home-scroll" ref={transcriptRef} onScroll={(event) => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}>
          {turns.map((turn, index) => <React.Fragment key={index}>
            <div className="mango-assistant-message mango-assistant-question"><strong>You</strong><p>{turn.question}</p>
              {turn.process && <button type="button" className="mango-assistant-resource" onClick={() => openEditorEntityLink({ entityType: "logic_gate", entityID: turn.process!.id, label: turn.process!.label })}>Process: {turn.process.label}</button>}
            </div>
            <div className="mango-assistant-message" data-assistant-turn-status={turn.status}>
              <strong>Mango</strong>
              {turn.reply && <p>{turn.reply}</p>}
              {turn.notice && <p className="mango-assistant-hint" role="status">{turn.notice}</p>}
              {turn.nodeID && <button type="button" className="mango-assistant-resource" onClick={() => openEditorEntityLink({ entityType: "node", entityID: turn.nodeID!, label: "AI Process Node" })}>Open Node</button>}
              {turn.contexts.length > 0 && <button type="button" className="mango-assistant-resource" onClick={() => setInspectedTurn(index)}>View context</button>}
            </div>
          </React.Fragment>)}
        </div>
        </section>}
        <form className="mango-assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <AssistantComposer ref={composerRef} companyID={companyID} requestJSON={requestJSON} disabled={!available || running} visible={panelOpen}
            placeholder={available === null ? "Checking Mango chat…" : "Ask Mango… Type # to select a Process"}
            onChange={(next) => { setDraft(next.text); setSelectedProcess(next.process); }} onSubmit={() => { void send(); }} onPickerChange={setPickerOpen} />
          <label className="mango-assistant-reasoning">
            <span>Reasoning</span>
            <select aria-label="Reasoning effort" value={reasoningEffort} disabled={running} onChange={(event) => {
              const effort = event.currentTarget.value;
              if (!isAssistantReasoningEffort(effort)) return;
              setReasoningEffort(effort);
              saveReasoningEffort(effort);
            }}>
              {ASSISTANT_REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{ASSISTANT_REASONING_LABELS[effort]}</option>)}
            </select>
          </label>
          {running
            ? <button type="button" className="mango-assistant-send" onClick={stop}>Stop</button>
            : <button type="submit" className="mango-assistant-send" disabled={!available || !draft.trim() || Boolean(historyError) || pickerOpen}>Send</button>}
        </form>
        {canInspectContext && <label className="mango-assistant-inspect"><input type="checkbox" checked={inspectContext} disabled={running} onChange={(event) => setInspectContext(event.currentTarget.checked)} />Inspect context for next message</label>}
        {(availabilityMessage || historyError) && <p className="mango-assistant-availability" role="status">{availabilityMessage || historyError}</p>}
      </div>
    </div>
    {inspectedTurn !== null && turns[inspectedTurn] && <AppModalPortal onRequestClose={() => setInspectedTurn(null)}>
      <section role="dialog" aria-modal="true" aria-label="AI context" className="mango-assistant-context">
        <header><strong>AI context</strong><button type="button" onClick={() => setInspectedTurn(null)}>Close context</button></header>
        <p>Initial model input and the additions supplied to each later call. Earlier input is included again in later calls.</p>
        <div className="mango-assistant-context-calls">{turns[inspectedTurn].contexts.map((context, index) => <details key={index} open={index === 0}>
          <summary>Model call {context.step} — {index === 0 ? "initial context" : "additional input"}</summary>
          {context.model && <p>Model: {context.model} · Reasoning: {context.reasoning_effort}</p>}
          {context.instructions && <><strong>Instructions</strong><pre>{context.instructions}</pre></>}
          <strong>Input</strong><pre>{JSON.stringify(context.input, null, 2)}</pre>
          {context.tools && <><strong>Available tools</strong><pre>{JSON.stringify(context.tools, null, 2)}</pre></>}
          {context.omitted_reasoning_items > 0 && <p>{context.omitted_reasoning_items} private model reasoning item(s) omitted.</p>}
        </details>)}</div>
      </section>
    </AppModalPortal>}
  </aside>;
}
