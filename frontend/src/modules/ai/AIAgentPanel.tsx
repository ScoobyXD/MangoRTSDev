import { useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { ACTIVE_COMPANY_CHANGED_EVENT } from "../../auth/currentCompany";
import {
  advanceAISession, cancelAISession, createAILiveSession, createAISession, decideAIAction,
  deleteAISession, getAISession, listAISessions, messageAISession,
  type AIAction, type AISession, type AISessionSummary, type AISkill,
} from "./aiApi";
import { AILiveConnection, type AILiveStatus, type AILiveTranscript } from "./aiLive";
import "./ai.css";

function isRunning(session: AISession): boolean {
  return !session.stopped && (["queued", "in_progress", "waiting"].includes(session.status) || session.items.some((item) => item.status === "in_progress"));
}

function needsAdvance(session: AISession): boolean {
  return isRunning(session) && !session.actions.some((action) => action.state === "executing" || (action.consequential && action.state === "pending"));
}

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(new DOMException("Request canceled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 1500);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The AI request failed. Please try again.";
}

function spokenStatus(session: AISession): string {
  if (session.actions.some((action) => action.state === "executing")) return "An action may still be running, or its result is uncertain. Inspect the app before retrying. See the action details in Mango AI.";
  if (session.actions.some((action) => action.consequential && action.state === "pending")) return "The next action needs your approval. Review its exact details in Mango AI and choose Approve or Reject.";
  if (session.status === "cancelled") return "The task was canceled. Review Mango AI for any actions that already completed.";
  if (session.stopped) return "Stopping has been requested. Check the task status in Mango AI; work that already completed remains in the app.";
  if (session.error || session.status === "failed") return "The task could not finish. Review the error in Mango AI.";
  return [...session.items].reverse().find((item) => item.role === "ai" && item.text)?.text ?? "The task is complete. Review Mango AI for the result.";
}

function actionLabel(name: string): string {
  const labels: Record<string, string> = {
    list_email_accounts: "List your email accounts", list_email_messages: "Read an email page", read_email_message: "Read an email",
    list_processes: "List workflows", read_process: "Read a workflow and its steps", read_node: "Read work details",
    create_process_node: "Create work in a workflow", assign_process_node: "Move work to a workflow step", update_process_node_state: "Change work status",
  };
  return labels[name] ?? name.replace(/_/g, " ");
}

export default function AIAgentPanel({ companyID, onClose }: { companyID: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<AISessionSummary[]>([]);
  const [session, setSession] = useState<AISession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [skills, setSkills] = useState<AISkill[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<AILiveStatus>("closed");
  const [transcripts, setTranscripts] = useState<AILiveTranscript[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = useRef<AISession | null>(null);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const live = useRef<AILiveConnection | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const voiceActive = voiceStatus !== "closed";

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void listAISessions(companyID, controller.signal).then(setSessions).catch((cause) => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const companyChanged = () => close.current();
    window.addEventListener(ACTIVE_COMPANY_CHANGED_EVENT, companyChanged);
    return () => {
      alive.current = false;
      controller.abort();
      operation.current?.abort();
      void live.current?.close();
      window.removeEventListener(ACTIVE_COMPANY_CHANGED_EVENT, companyChanged);
    };
  }, [companyID]);

  function publish(next: AISession): AISession {
    if (current.current?.id === next.id) {
      const items = new Map(current.current.items.map((item) => [item.id, item]));
      next.items.forEach((item) => items.set(item.id, item));
      next = { ...next, items: [...items.values()] };
    }
    if (!alive.current) return next;
    current.current = next;
    setSession(next);
    setSessions((previous) => [{ id: next.id, prompt: next.prompt, stopped: next.stopped, created_at: next.created_at }, ...previous.filter((item) => item.id !== next.id)]);
    return next;
  }

  async function collectPages(next: AISession, signal: AbortSignal): Promise<AISession> {
    let previousCursor = current.current?.id === next.id ? current.current.items_cursor : "";
    next = publish(next);
    while (next.items_has_more && next.items_cursor && next.items_cursor !== previousCursor) {
      previousCursor = next.items_cursor;
      next = await getAISession(companyID, next.id, signal, next.items_cursor);
      if (signal.aborted) throw new DOMException("Request canceled", "AbortError");
      next = publish(next);
    }
    return next;
  }

  async function run(action: (signal: AbortSignal) => Promise<AISession>, advance = true): Promise<AISession> {
    if (operation.current) throw new Error("Wait for the current task or cancel it first.");
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      let next = await action(controller.signal);
      if (controller.signal.aborted) throw new DOMException("Request canceled", "AbortError");
      next = await collectPages(next, controller.signal);
      while (advance && needsAdvance(next)) {
        await delay(controller.signal);
        next = await advanceAISession(companyID, next.id, controller.signal, next.items_cursor);
        if (controller.signal.aborted) throw new DOMException("Request canceled", "AbortError");
        next = await collectPages(next, controller.signal);
      }
      return next;
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (alive.current) setBusy(false);
      }
    }
  }

  function report(promise: Promise<unknown>) {
    void promise.catch((cause) => {
      if (alive.current && !(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause));
    });
  }

  async function submit(text: string): Promise<AISession> {
    if (text.length > 16000) throw new Error("The request is too long. Use a shorter request or start a new voice conversation.");
    if (!text.trim()) throw new Error("Enter a request first.");
    if (!current.current && skills.some((skill) => !skill.name.trim() || !skill.content.trim())) throw new Error("Give each skill a name and its steps, or remove the empty skill.");
    return run((signal) => current.current
      ? messageAISession(companyID, current.current.id, text, signal, current.current.items_cursor)
      : createAISession(companyID, { prompt: text, instructions, skills }, signal));
  }

  function sendPrompt() {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt("");
    report(submit(text).catch((cause) => { if (alive.current) setPrompt(text); throw cause; }));
  }

  async function cancel() {
    const id = current.current?.id;
    if (!id) return;
    operation.current?.abort();
    const cancellation = new AbortController();
    operation.current = cancellation;
    setBusy(true);
    setError("");
    try { publish(await cancelAISession(companyID, id)); }
    finally {
      if (operation.current === cancellation) {
        operation.current = null;
        if (alive.current) setBusy(false);
      }
    }
  }

  async function endVoice() {
    const connection = live.current;
    // The visible Cancel task action controls backend work separately from speech.
    await connection?.close();
    if (live.current === connection) live.current = null;
  }

  function startVoice() {
    if (busy || voiceActive) return;
    setError("");
    setTranscripts([]);
    const connection = new AILiveConnection({
      createSession: (sdp, signal) => createAILiveSession(companyID, sdp, signal),
      onStatus: (status) => { if (alive.current && live.current === connection) setVoiceStatus(status); },
      onTranscript: (part) => { if (alive.current && live.current === connection) setTranscripts((previous) => [...previous, part]); },
      onError: (message) => { if (alive.current && live.current === connection) setError(message); },
      onDelegation: async (context) => {
        const result = await submit(`Respond to the latest request in this live voice conversation. Earlier transcript fragments are context; do not repeat completed work. Use corrections in the latest user speech. Ask when details are unclear. Voice transcripts and spoken approval do not authorize consequential actions; request approval in Mango AI.\n\n${context}`);
        return spokenStatus(result);
      },
    });
    live.current = connection;
    void connection.start();
  }

  function decide(action: AIAction, approved: boolean) {
    if (!session || busy) return;
    report(run((signal) => decideAIAction(companyID, session.id, action, approved, signal, current.current?.items_cursor)));
  }

  function reset() {
    current.current = null;
    setSession(null);
    setPrompt("");
    setError("");
    setConfirmDelete(false);
    setTranscripts([]);
  }

  function select(id: string) {
    if (!id) { reset(); return; }
    setConfirmDelete(false);
    report(run((signal) => getAISession(companyID, id, signal), false).then((next) => {
      setInstructions(next.instructions);
      setSkills(next.skills);
    }));
  }

  function remove() {
    if (!session) return;
    const id = session.id;
    setBusy(true);
    report(deleteAISession(companyID, id).then(() => {
      if (!alive.current) return;
      setSessions((previous) => previous.filter((item) => item.id !== id));
      reset();
    }).finally(() => { if (alive.current) setBusy(false); }));
  }

  const awaitingApproval = session?.actions.some((action) => action.consequential && action.state === "pending");
  const status = session?.stopped
    ? session.status === "cancelled" ? "Canceled" : session.status === "completed" ? "Completed" : "Stop requested"
    : awaitingApproval ? "Needs your approval" : session?.status.replace(/_/g, " ") ?? "Ready";
  const captionRows = transcripts.reduce<{ role: "user" | "ai"; text: string }[]>((rows, fragment) => {
    const last = rows[rows.length - 1];
    if (last?.role === fragment.role) last.text += fragment.delta;
    else rows.push({ role: fragment.role, text: fragment.delta });
    return rows;
  }, []);
  return (
    <AppModalPortal onRequestClose={onClose}>
      <div className="mango-ai-backdrop">
        <section className="mango-ai-panel" role="dialog" aria-modal="true" aria-labelledby="mango-ai-title">
          <header className="mango-ai-header">
            <div><h2 id="mango-ai-title">Mango AI</h2><p>Ask about your emails and workflows, then review the next action.</p></div>
            <button type="button" onClick={onClose} aria-label="Close Mango AI">Close</button>
          </header>
          <div className="mango-ai-toolbar">
            <label>Task<select aria-label="Choose AI task" value={session?.id ?? ""} disabled={busy || voiceActive || loading} onChange={(event) => select(event.target.value)}>
              <option value="">New task</option>
              {sessions.map((item) => <option key={item.id} value={item.id}>{item.prompt.slice(0, 80) || "AI task"}</option>)}
            </select></label>
            <button type="button" disabled={busy || voiceActive} onClick={reset}>New task</button>
            {session && <button type="button" disabled={busy} onClick={() => report(run((signal) => getAISession(companyID, session.id, signal, current.current?.items_cursor), false))}>Refresh task</button>}
            {session && <button type="button" disabled={busy || voiceActive || isRunning(session)} onClick={() => setConfirmDelete(!confirmDelete)}>Delete task</button>}
          </div>
          {confirmDelete && <div className="mango-ai-notice">Delete this AI task and its history? Completed app actions stay in place.<div className="mango-ai-actions"><button type="button" onClick={() => setConfirmDelete(false)}>Keep task</button><button type="button" disabled={busy} onClick={remove}>Delete task and history</button></div></div>}
          <div className="mango-ai-body">
            <details className="mango-ai-guidance">
              <summary>Instructions and skills{session ? " for this task" : " for the new task"}</summary>
              <label>Instructions<textarea value={instructions} maxLength={16000} disabled={!!session || busy || voiceActive} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the workflows the AI should follow, step by step." rows={4} /></label>
              {skills.map((skill, index) => <fieldset key={index}>
                <legend>Skill {index + 1}</legend>
                <label>Name<input value={skill.name} maxLength={100} disabled={!!session || busy || voiceActive} onChange={(event) => setSkills((previous) => previous.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></label>
                <label>Steps<textarea value={skill.content} maxLength={16000} rows={3} disabled={!!session || busy || voiceActive} onChange={(event) => setSkills((previous) => previous.map((item, i) => i === index ? { ...item, content: event.target.value } : item))} /></label>
                {!session && <button type="button" disabled={busy || voiceActive} onClick={() => setSkills((previous) => previous.filter((_, i) => i !== index))}>Remove skill</button>}
              </fieldset>)}
              {!session && <button type="button" disabled={busy || voiceActive || skills.length >= 8} onClick={() => setSkills((previous) => [...previous, { name: "", content: "" }])}>Add skill</button>}
              {session && <p>Start a new task to use different instructions or skills.</p>}
            </details>
            {!session && !loading && <div className="mango-ai-empty"><h3>What would you like to work on?</h3><p>For example: “Review all of my emails, group them by workflow, and explain which steps are next.”</p><p>Review AI results before using them. Workflow changes need your approval; send emails through the email screen.</p></div>}
            <div className="mango-ai-status" role="status"><span className={busy ? "mango-ai-dot busy" : "mango-ai-dot"} />{loading ? "Loading tasks…" : status}{busy ? " · Working…" : ""}</div>
            {session && Object.keys(session.read_counts).length > 0 && <details className="mango-ai-read-progress"><summary>Read progress</summary><ul>{Object.entries(session.read_counts).map(([name, count]) => <li key={name}>{actionLabel(name)}: {count}</li>)}</ul><p>These counts show completed reads, not proof of complete mailbox coverage.</p></details>}
            {session?.error && <div className="mango-ai-error" role="alert">{session.error}</div>}
            {error && <div className="mango-ai-error" role="alert">{error}</div>}
            {session?.items.map((item) => <article key={item.id} className={`mango-ai-message ${item.role}`}><strong>{item.role === "user" ? "You" : "Mango AI"}</strong><div>{item.text}</div></article>)}
            {session?.actions.map((action) => <article className="mango-ai-action" key={`${action.turn_id}:${action.call_id}`}>
              <div className="mango-ai-action-heading"><strong>{actionLabel(action.name)}</strong><span>{action.state}</span></div>
              {action.consequential && <dl className="mango-ai-review-fields">{Object.entries(action.arguments).map(([key, value]) => <div key={key}><dt>{({ process_id: "Workflow", step_id: "Step", node_id: "Work item", title: "Title", status: "New status" } as Record<string, string>)[key] ?? key.replace(/_/g, " ")}</dt><dd>{value == null ? "No step selected" : typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>}
              <details open={action.state === "pending" && action.consequential}><summary>Exact action details</summary><pre>{JSON.stringify(action.arguments, null, 2)}</pre></details>
              {action.error && <p className="mango-ai-error">{action.error}</p>}
              {action.state === "executing" && <p className="mango-ai-error">This action may still be running, or its outcome may be unknown after an interruption. Inspect the app before retrying.</p>}
              {action.output != null && <details><summary>Action result</summary><pre>{typeof action.output === "string" ? action.output : JSON.stringify(action.output, null, 2)}</pre></details>}
              {action.state === "pending" && action.consequential && !session.stopped && <><p>Review these details before approving this action.</p><div className="mango-ai-actions"><button type="button" disabled={busy} onClick={() => decide(action, false)}>Reject</button><button type="button" className="primary" disabled={busy} onClick={() => decide(action, true)}>Approve this action</button></div></>}
            </article>)}
            {captionRows.length > 0 && <details className="mango-ai-transcript" open={voiceActive}><summary>Voice transcript</summary>{captionRows.map((part, index) => <span key={index} className={part.role}><b>{part.role === "user" ? "You" : "AI"}: </b>{part.text}</span>)}</details>}
          </div>
          <footer className="mango-ai-footer">
            <form onSubmit={(event) => { event.preventDefault(); sendPrompt(); }}>
              <label className="mango-ai-prompt-label">Your request<textarea aria-label="Your AI request" value={prompt} maxLength={16000} rows={3} disabled={busy || voiceActive || !!awaitingApproval || !!session?.stopped} onChange={(event) => setPrompt(event.target.value)} placeholder={awaitingApproval ? "Review the pending action above." : "Describe what you want the AI to do…"} /></label>
              <div className="mango-ai-actions"><button className="primary" type="submit" disabled={busy || voiceActive || !prompt.trim() || !!awaitingApproval || !!session?.stopped}>Send</button>
                {session && !busy && needsAdvance(session) && <button type="button" onClick={() => report(run((signal) => advanceAISession(companyID, session.id, signal, current.current?.items_cursor)))}>Continue task</button>}
                {session && !session.stopped && (busy || isRunning(session) || awaitingApproval) && <button type="button" onClick={() => report(cancel())}>Cancel task</button>}
                <button type="button" disabled={voiceStatus === "closing" || (!voiceActive && (busy || !!awaitingApproval || !!session?.stopped))} onClick={() => voiceActive ? report(endVoice()) : startVoice()}>{voiceStatus === "closing" ? "Ending voice…" : voiceActive ? "End voice" : "Start voice"}</button>
                {voiceActive && <span role="status">{voiceStatus === "listening" ? "Microphone on" : voiceStatus}</span>}
              </div>
            </form>
            <p>End voice stops the conversation; Cancel task stops the agent. Closing this panel ends voice and pauses app tool handling.</p>
          </footer>
        </section>
      </div>
    </AppModalPortal>
  );
}
