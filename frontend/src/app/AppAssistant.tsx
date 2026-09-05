import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, getAuthSessionCacheGeneration, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import {
  ASSISTANT_DEFAULT_REASONING_EFFORT, ASSISTANT_MAX_MESSAGE_CHARS, ASSISTANT_REASONING_EFFORTS,
  ASSISTANT_STOP_MESSAGE, assistantErrorMessage, assistantHistoryError, getAssistantStatus, getAssistantTrace, getAssistantResult,
  isAssistantReasoningEffort, streamAssistantChat, type AssistantMessage, type AssistantReasoningEffort, type AssistantTrace,
} from "../modules/assistant/assistantApi.js";
import { APIHTTPError, createRequestJSON } from "../modules/api/requestJSON.js";
import { openEditorEntityLink } from "../modules/editor/editorEntityLinks.js";
import { AssistantComposer, type AssistantComposerHandle, type AssistantProcess } from "../modules/assistant/AssistantComposer.js";
import { AppModalPortal } from "./AppModalPortal.js";

type Props = { apiBase: string; userID: string; bottomInset: number };
type Turn = { requestID: string; question: string; reply: string; status: "running" | "complete" | "stopped" | "failed"; notice: string; process?: AssistantProcess; nodeID?: string; inspecting: boolean; traces: AssistantTrace[]; captureFinished?: boolean; recovering?: boolean; inspectionNotice?: string; interruption?: { time: string; message: string } };
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

const AssistantTraceDetails = React.memo(function AssistantTraceDetails({ trace }: { trace: AssistantTrace }) {
  return <details>
    <summary>{trace.sequence}. {trace.kind.replace(/_/g, " ")} · {trace.status} · {trace.time}</summary>
    <pre>{JSON.stringify(trace, null, 2)}</pre>
  </details>;
});

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
  const [inspectedTurn, setInspectedTurn] = useState<number | "latest" | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState(loadReasoningEffort);
  const [running, setRunning] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const inspectionRequests = useRef(new Set<AbortController>());
  const composerRef = useRef<AssistantComposerHandle>(null);
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const inspectionRef = useRef<HTMLDivElement>(null);
  const followInspection = useRef(true);
  const focusToggleAfterChange = useRef(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const panelID = React.useId();
  const transcriptID = React.useId();
  const inspection = inspectedTurn === "latest" ? turns[turns.length - 1] : inspectedTurn === null ? undefined : turns[inspectedTurn];

  useLayoutEffect(() => () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    for (const controller of inspectionRequests.current) controller.abort();
  }, []);
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

  useLayoutEffect(() => {
    if (followInspection.current && inspectionRef.current) {
      inspectionRef.current.scrollTop = inspectionRef.current.scrollHeight;
    }
  }, [inspection]);

  const history: AssistantMessage[] = turns.filter((turn) => turn.status === "complete" && turn.reply.trim()).flatMap((turn) => [
    { role: "user" as const, content: turn.question }, { role: "assistant" as const, content: turn.reply },
  ]);
  const historyError = draft.length > ASSISTANT_MAX_MESSAGE_CHARS ? "Keep your message under 8,000 characters." : assistantHistoryError([...history, { role: "user", content: draft.trim() }]);

  const revokeInspection = () => {
    setCanInspectContext(false);
    setInspectedTurn(null);
    setTurns((current) => current.map((item) => ({ ...item, traces: [], inspecting: false })));
  };

  const recoverTurn = async (index: number, requestID: string, inspecting: boolean, bindRecoveredProcess = false) => {
    const controller = new AbortController();
    inspectionRequests.current.add(controller);
    const update = (changes: Partial<Turn>) => setTurns((current) => current.map((turn, turnIndex) => turnIndex === index && turn.requestID === requestID ? { ...turn, ...changes } : turn));
    update({ recovering: true, ...(inspecting ? { inspectionNotice: "Recovering the final server capture…" } : {}) });
    try {
      const snapshot = await (inspecting ? getAssistantTrace : getAssistantResult)(apiBase, companyID, requestID, controller.signal);
      if (controller.signal.aborted) return;
      const events = "events" in snapshot ? (snapshot as { events: AssistantTrace[] }).events : undefined;
      const process = snapshot.process ? { id: snapshot.process.id, label: snapshot.process.name } : undefined;
      if (bindRecoveredProcess && process) composerRef.current?.bindProcess(process);
      setTurns((current) => current.map((turn, turnIndex) => turnIndex === index && turn.requestID === requestID && (!events || turn.inspecting && events.length >= turn.traces.length) && (!turn.captureFinished || snapshot.finished) ? {
        ...turn, ...(events ? { traces: events } : {}), captureFinished: snapshot.finished, ...(process ? { process } : {}), ...(snapshot.node_id ? { nodeID: snapshot.node_id } : {}), inspectionNotice: snapshot.finished
        ? "Final server capture recovered. Saved actions remain in Mango."
        : "The server has not finished stopping. Some action outcomes remain uncertain. Reopen Inspect to recover the latest capture.",
      } : turn));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (inspecting && error instanceof APIHTTPError && (error.status === 403 || error.status === 404)) {
        const captureUnavailable = error.status === 404;
        if (captureUnavailable) update({ inspectionNotice: "Final server capture is unavailable. Received events are retained; saved action results remain uncertain. Reopen Inspect to try again." });
        else revokeInspection();
        try {
          const result = await getAssistantResult(apiBase, companyID, requestID, controller.signal);
          if (controller.signal.aborted) return;
          const process = result.process ? { id: result.process.id, label: result.process.name } : undefined;
          update({ captureFinished: result.finished, ...(process ? { process } : {}), ...(result.node_id ? { nodeID: result.node_id } : {}), ...(captureUnavailable ? { inspectionNotice: result.finished
            ? "Final server capture is unavailable. Received events are retained. Saved action results recovered; saved actions remain in Mango."
            : "Final server capture is unavailable. Received events are retained. The server has not finished stopping. Reopen Inspect to refresh saved action results." } : {}) });
          if (bindRecoveredProcess && process) composerRef.current?.bindProcess(process);
        } catch {
          // Keep already received links and traces; public results cannot restore unavailable inspection.
        }
      }
      else if (inspecting) update({ inspectionNotice: "Final server capture could not be recovered. Received events are retained; later action outcomes are uncertain. Reopen Inspect to try again." });
    } finally {
      inspectionRequests.current.delete(controller);
      if (!controller.signal.aborted) update({ recovering: false });
    }
  };

  const openInspection = async (selected: number | "latest") => {
    const index = selected === "latest" ? turns.length - 1 : selected;
    const turn = turns[index];
    if (turn && !turn.inspecting) return;
    const controller = new AbortController();
    inspectionRequests.current.add(controller);
    try {
      const status = await getAssistantStatus(apiBase, companyID, controller.signal);
      if (controller.signal.aborted) return;
      setCanInspectContext(status.can_inspect_context === true);
      if (!status.can_inspect_context) {
        revokeInspection();
        return;
      }
      followInspection.current = true;
      setInspectedTurn(selected);
      if (turn && !turn.captureFinished && (turn.status === "failed" || turn.status === "stopped")) await recoverTurn(index, turn.requestID, true);
    } catch {
      if (!controller.signal.aborted) setAvailabilityMessage("Inspection access could not be checked. Try Inspect again.");
    } finally {
      inspectionRequests.current.delete(controller);
    }
  };

  const send = async () => {
    const question = draft.trim();
    if (activeRequest.current || pickerOpen || !available || !question || question.length > ASSISTANT_MAX_MESSAGE_CHARS || historyError) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const index = turns.length;
    const requestID = crypto.randomUUID();
    let process = selectedProcess ?? undefined;
    const inspecting = canInspectContext;
    setTurns((current) => [...current, { requestID, question, reply: "", status: "running", notice: "Thinking…", process, inspecting, traces: [] }]);
    composerRef.current?.clearMessage();
    setRunning(true);
    followReply.current = true;
    const update = (changes: Partial<Turn>) => setTurns((current) => current.map((turn, turnIndex) => turnIndex === index ? { ...turn, ...changes } : turn));
    let reply = "";
    let recover = false;
    try {
      await streamAssistantChat(apiBase, companyID, requestID, [...history, { role: "user", content: question }], reasoningEffort, controller.signal, (message) => {
        if (controller.signal.aborted) return;
        if (message.type === "text") {
          reply += message.text;
          update({ reply, notice: "" });
        } else if (message.type === "tool") {
          update({ notice: message.status === "running" ? "Working in Mango…" : "Preparing reply…" });
        } else if (message.type === "node") {
          if (process?.id === message.process_id) update({ nodeID: message.node_id });
        } else if (message.type === "process") {
          process = { id: message.process_id, label: message.name };
          update({ process });
          composerRef.current?.bindProcess(process);
        } else if (message.type === "trace") {
          if (inspecting) setTurns((current) => current.map((turn, turnIndex) => turnIndex === index && turn.inspecting ? { ...turn, traces: [...turn.traces, message.trace] } : turn));
        } else if (message.type === "done") {
          update({ status: "complete", captureFinished: true, notice: reply ? "" : "Finished without a text reply." });
        } else {
          recover = true;
          update({ status: "failed", notice: message.message });
        }
      }, process?.id, inspecting);
    } catch (error) {
      recover = true;
      if (!controller.signal.aborted) update({ status: "failed", notice: assistantErrorMessage(error), interruption: { time: new Date().toISOString(), message: "The browser lost the response stream. Server completion and in-flight action outcomes were not confirmed." } });
    } finally {
      if (activeRequest.current === controller) {
        if (recover || controller.signal.aborted) await recoverTurn(index, requestID, inspecting, true);
        activeRequest.current = null;
        setRunning(false);
      }
    }
  };

  const stop = () => {
    activeRequest.current?.abort();
    setTurns((current) => current.map((turn) => turn.status === "running" ? { ...turn, status: "stopped", notice: ASSISTANT_STOP_MESSAGE, interruption: { time: new Date().toISOString(), message: "Stop requested in the browser; the response stream was closed. This is not confirmation that an in-flight action was canceled or undone." } } : turn));
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
          {canInspectContext && <button type="button" aria-haspopup="dialog" onClick={() => { void openInspection("latest"); }}>Inspect</button>}
          <button type="button" className="mango-assistant-clear" disabled={running || turns.length === 0} onClick={() => {
            for (const controller of inspectionRequests.current) controller.abort();
            setTurns([]); composerRef.current?.clear(); setInspectedTurn(null);
          }}>Clear chat</button>
        </header>
        {turns.length > 0 && <section className="mango-assistant-transcript" id={transcriptID} aria-label="Chat transcript">
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
              {!turn.inspecting && turn.captureFinished !== true && (turn.status === "stopped" || turn.status === "failed") && <button type="button" className="mango-assistant-resource" disabled={running || turn.recovering} onClick={() => { void recoverTurn(index, turn.requestID, false); }}>Refresh saved result</button>}
              {canInspectContext && turn.inspecting && <button type="button" className="mango-assistant-resource" onClick={() => { void openInspection(index); }}>Inspect</button>}
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
        {(availabilityMessage || historyError) && <p className="mango-assistant-availability" role="status">{availabilityMessage || historyError}</p>}
      </div>
    </div>
    {canInspectContext && inspectedTurn !== null && <AppModalPortal onRequestClose={() => setInspectedTurn(null)}>
      <section role="dialog" aria-modal="true" aria-label="AI inspection" className="mango-assistant-context">
        <header><strong>AI inspection</strong><button type="button" onClick={() => setInspectedTurn(null)}>Close inspection</button></header>
        <p>Events appear live while Mango works: captured context, skills, tool events, and provider requests. Prepared, dispatched, saved, failed, and uncertain are separate outcomes.</p>
        <p>Security omissions: credentials, authentication headers, private provider internals, and hidden reasoning are excluded. Recorded omission markers identify unavailable or removed fields.</p>
        <p>Inspection stays in memory. Clear chat, reload, or an account/company change loses this browser history. Server recovery lasts up to 15 minutes, until your next Send in this company, or until backend restart. Earlier captured turns remain here until this chat is cleared.</p>
        <div className="mango-assistant-context-calls" ref={inspectionRef} onScroll={(event) => {
          const element = event.currentTarget;
          followInspection.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}>
          {inspection?.interruption && <p role="status">Browser observation at {inspection.interruption.time}: {inspection.interruption.message}</p>}
          {inspection?.inspectionNotice && <p role="status">{inspection.inspectionNotice}</p>}
          {!inspection && <p>No runs yet. Send a message, then open Inspect to watch its events live.</p>}
          {inspection?.traces.length === 0 && <p>No server events received yet.</p>}
          {inspection?.traces.map((trace) => <AssistantTraceDetails key={trace.sequence} trace={trace} />)}
        </div>
      </section>
    </AppModalPortal>}
  </aside>;
}
