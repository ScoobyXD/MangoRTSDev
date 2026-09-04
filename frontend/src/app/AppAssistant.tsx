import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addAuthTerminalFailureListener, getAuthSessionCacheGeneration, isTerminalAuthFailureActive } from "../auth/cognitoAuth.js";
import { ACTIVE_COMPANY_CHANGED_EVENT, getActiveCompanyID } from "../auth/currentCompany.js";
import {
  ASSISTANT_DEFAULT_REASONING_EFFORT, ASSISTANT_MAX_MESSAGE_CHARS, ASSISTANT_REASONING_EFFORTS,
  ASSISTANT_STOP_MESSAGE, assistantErrorMessage, assistantHistoryError, getAssistantStatus,
  isAssistantReasoningEffort, streamAssistantChat, type AssistantMessage, type AssistantReasoningEffort,
} from "../modules/assistant/assistantApi.js";
import { createRequestJSON } from "../modules/api/requestJSON.js";
import { openEditorEntityLink } from "../modules/editor/editorEntityLinks.js";
import { UniversalEntityPicker, type UniversalEntityPickerAnchor } from "../modules/editor/UniversalEntityPicker.js";

type Props = { apiBase: string; userID: string; bottomInset: number };
type SelectedProcess = { id: string; label: string; start: number; end: number };
type Turn = { question: string; reply: string; status: "running" | "complete" | "stopped" | "failed"; notice: string; process?: SelectedProcess; nodeID?: string };
const PROCESS_PICKER_TYPES = ["logic_gate"] as const;
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
  const [selectedProcess, setSelectedProcess] = useState<SelectedProcess | null>(null);
  const [picker, setPicker] = useState<{ anchor: UniversalEntityPickerAnchor; start: number } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState(loadReasoningEffort);
  const [running, setRunning] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const focusComposerAt = useRef<number | null>(null);
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
    if (picker || focusComposerAt.current === null) return;
    composerRef.current?.focus();
    composerRef.current?.setSelectionRange(focusComposerAt.current, focusComposerAt.current);
    focusComposerAt.current = null;
  }, [picker, selectedProcess]);

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
    if (activeRequest.current || picker || !available || !question || question.length > ASSISTANT_MAX_MESSAGE_CHARS || historyError) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const index = turns.length;
    const process = selectedProcess ?? undefined;
    setTurns((current) => [...current, { question, reply: "", status: "running", notice: "Thinking…", process }]);
    setDraft("");
    setSelectedProcess(null);
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
        } else if (message.type === "done") {
          update({ status: "complete", notice: reply ? "" : "Finished without a text reply." });
        } else {
          update({ status: "failed", notice: message.message });
        }
      }, process?.id);
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
    if (!open) setPicker(null);
    focusToggleAfterChange.current = true;
    setPanelOpen(open);
  };

  const changeDraft = (input: HTMLInputElement) => {
    const next = input.value;
    const cursor = input.selectionStart ?? next.length;
    let selection = selectedProcess;
    if (selection && next !== draft) {
      let start = 0;
      while (start < draft.length && start < cursor && draft[start] === next[start]) start += 1;
      let end = draft.length;
      let nextEnd = next.length;
      while (end > start && nextEnd > start && draft[end - 1] === next[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
      if (end <= selection.start) {
        const offset = next.length - draft.length;
        selection = { ...selection, start: selection.start + offset, end: selection.end + offset };
      } else if (start < selection.end) selection = null;
      setSelectedProcess(selection);
    }
    setDraft(next);
    if (!selection && next !== draft && next[cursor - 1] === "#" && (cursor === 1 || /\s/.test(next[cursor - 2]))) {
      const rect = input.getBoundingClientRect();
      setPicker({ anchor: { left: rect.left, top: rect.top }, start: cursor - 1 });
    }
  };

  const removeProcess = () => {
    if (!selectedProcess) return;
    setDraft(draft.slice(0, selectedProcess.start) + draft.slice(selectedProcess.end));
    focusComposerAt.current = selectedProcess.start;
    setSelectedProcess(null);
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
          <button type="button" disabled={running || turns.length === 0} onClick={() => { setTurns([]); setDraft(""); setSelectedProcess(null); setPicker(null); }}>Clear chat</button>
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
            </div>
          </React.Fragment>)}
        </div>
        </section>}
        {selectedProcess && <div className="mango-assistant-process" aria-label="Selected Process">
          <span>Process: <strong>{selectedProcess.label}</strong></span>
          <button type="button" aria-label="Remove selected Process" onClick={removeProcess}>×</button>
        </div>}
        <form className="mango-assistant-composer" onSubmit={(event) => { void send(event); }}>
          <input ref={composerRef} aria-label="Message Mango" placeholder={available === null ? "Checking Mango chat…" : "Ask Mango… Type # to select a Process"} value={draft} maxLength={ASSISTANT_MAX_MESSAGE_CHARS} disabled={!available || running} onChange={(event) => changeDraft(event.currentTarget)} onKeyDown={(event) => { if (event.nativeEvent.isComposing && event.key === "Enter") event.preventDefault(); }} />
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
            : <button type="submit" className="mango-assistant-send" disabled={!available || !draft.trim() || Boolean(historyError) || Boolean(picker)}>Send</button>}
        </form>
        {(availabilityMessage || historyError) && <p className="mango-assistant-availability" role="status">{availabilityMessage || historyError}</p>}
      </div>
    </div>
    {picker && <UniversalEntityPicker
      companyID={companyID}
      requestJSON={requestJSON}
      sourceLabel="Select a Process for Mango"
      linkTargetTypes={[]}
      referenceTargetTypes={PROCESS_PICKER_TYPES}
      initialMode="reference"
      initialCategory="logic_gate"
      lockMode
      anchor={picker.anchor}
      onCancel={() => { focusComposerAt.current = picker.start + 1; setPicker(null); }}
      onChoose={async (entity) => {
        if (entity.entityType !== "logic_gate") throw new Error("Select a Process.");
        const mention = `#${entity.label}`;
        const next = draft.slice(0, picker.start) + mention + " " + draft.slice(picker.start + 1);
        if (next.length > ASSISTANT_MAX_MESSAGE_CHARS) throw new Error("Shorten your message before selecting a Process.");
        setDraft(next);
        setSelectedProcess({ id: entity.entityID, label: entity.label, start: picker.start, end: picker.start + mention.length });
        focusComposerAt.current = picker.start + mention.length + 1;
        setPicker(null);
      }}
    />}
  </aside>;
}
