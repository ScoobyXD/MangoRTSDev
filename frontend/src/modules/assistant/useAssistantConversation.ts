import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  assistantErrorCode, assistantErrorMessage, cancelAssistantRun, createAssistantRun, getAssistantConversation, getAssistantRun, isUnsubmittedAssistantError,
  listAssistantConversations, watchAssistantRun,
  type AssistantConversationSummary, type AssistantMessage, type AssistantRun, type AssistantSubmission,
} from "./assistantApi.js";

export function useAssistantConversation(apiBase: string, companyID: string, visible: boolean) {
  const [conversations, setConversations] = useState<AssistantConversationSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [conversationID, setConversationID] = useState("");
  const selectedID = useRef<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [nextMessageOffset, setNextMessageOffset] = useState<number | null>(null);
  const [runID, setRunID] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<AssistantSubmission | null>(null);
  const pendingRef = useRef<AssistantSubmission | null>(null);
  const operation = useRef<AbortController | null>(null);
  const cancelOperation = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => {
    operation.current?.abort();
    cancelOperation.current?.abort();
  }, [apiBase, companyID]);

  const startOperation = () => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    return controller;
  };

  const selectID = (id: string) => {
    selectedID.current = id;
    setConversationID(id);
  };

  const finishRun = async (run: AssistantRun, controller: AbortController) => {
    if (controller.signal.aborted) return;
    setRunID("");
    setConnected(false);
    setStopping(false);
    if (run.output) setMessages((current) => [...current, { id: run.run_id, role: "assistant", content: run.output! }]);
    setReply("");
    if (run.status === "failed") setError("Mango could not complete this response. Any completed actions remain saved.");
    if (run.status === "cancelled") setNotice("Stopped. Any completed actions remain saved.");
    if (run.status === "interrupted") setNotice("The run was interrupted. Its saved conversation and completed actions were kept.");
    // Reload the native transcript once after completion so resume and the live
    // view use the same saved messages, including an interrupted run's outcome.
    const id = run.conversation_id || run.session_id || selectedID.current;
    if (!id) return;
    try {
      const conversation = await getAssistantConversation(apiBase, companyID, id, controller.signal);
      if (!controller.signal.aborted) {
        setMessages(conversation.messages);
        setNextMessageOffset(conversation.has_older_messages ? conversation.next_message_offset ?? 500 : null);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(assistantErrorMessage(cause));
    }
  };

  const observeRun = async (id: string, controller: AbortController) => {
    setRunID(id);
    setReply("");
    setConnected(true);
    try {
      const run = await getAssistantRun(apiBase, companyID, id, controller.signal);
      if (controller.signal.aborted) return;
      if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
        await finishRun(run, controller);
        return;
      }
      let finalRun: AssistantRun | undefined;
      await watchAssistantRun(apiBase, companyID, id, controller.signal, (event) => {
        if (controller.signal.aborted) return;
        if (event.event === "message.delta") setReply((current) => current + event.delta!);
        if (["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.event)) {
          finalRun = { ...run, status: event.event.slice(4), output: event.output };
        }
      });
      if (controller.signal.aborted) return;
      if (finalRun) await finishRun(finalRun, controller);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setConnected(false);
        setError(`${assistantErrorMessage(cause)} Resume to check the saved response; do not send it again.`);
      }
    }
  };

  const loadConversation = async (id: string, controller: AbortController) => {
    const conversation = await getAssistantConversation(apiBase, companyID, id, controller.signal);
    if (controller.signal.aborted) return;
    selectID(conversation.id);
    setMessages(conversation.messages);
    setNextMessageOffset(conversation.has_older_messages ? conversation.next_message_offset ?? 500 : null);
    pendingRef.current = conversation.pending_submission ?? null;
    setPending(conversation.pending_submission ?? null);
    setRunID(conversation.active_run_id || "");
    setReply("");
    setBusy(false);
    if (conversation.active_run_id) void observeRun(conversation.active_run_id, controller);
  };

  const load = async (id?: string) => {
    if (pendingRef.current) return;
    const controller = startOperation();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await listAssistantConversations(apiBase, companyID, controller.signal);
      if (controller.signal.aborted) return;
      setConversations(result.conversations);
      setNextOffset(result.has_more ? result.next_offset ?? (result.offset ?? 0) + 50 : null);
      const nextID = id ?? selectedID.current ?? result.conversations[0]?.id;
      if (nextID) await loadConversation(nextID, controller);
      else { selectID(""); setMessages([]); setRunID(""); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(assistantErrorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  useEffect(() => {
    if (visible) void load();
    else {
      operation.current?.abort();
      setConnected(false);
      setBusy(false);
    }
  }, [visible]);

  const send = async (message: string): Promise<boolean> => {
    if (busy || runID || !message.trim()) return false;
    if (new TextEncoder().encode(message).length > 32_000) {
      setError("This message is too long. Shorten it before sending; your draft has been kept.");
      return false;
    }
    const retrying = pendingRef.current !== null;
    const submission = pendingRef.current ?? { request_id: crypto.randomUUID(), conversation_id: selectedID.current || undefined, message };
    if (submission.message !== message) return false;
    pendingRef.current = submission;
    setPending(submission);
    const controller = startOperation();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const run = await createAssistantRun(apiBase, companyID, submission, controller.signal);
      if (controller.signal.aborted) return false;
      const id = run.conversation_id || run.session_id;
      if (!run.run_id || !id) throw new Error("Invalid run response.");
      pendingRef.current = null;
      setPending(null);
      selectID(id);
      setMessages((current) => [...current, { id: submission.request_id, role: "user", content: message }]);
      setConversations((current) => current.some((item) => item.id === id) ? current : [{ id, title: message.slice(0, 80) }, ...current]);
      setBusy(false);
      void observeRun(run.run_id, controller);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) {
        const code = assistantErrorCode(cause);
        if (["assistant_request_expired_check_saved_conversation", "assistant_run_active_or_request_conflict"].includes(code)) {
          pendingRef.current = null;
          setPending(null);
          selectedID.current = null;
          await load();
          setNotice(code === "assistant_request_expired_check_saved_conversation"
            ? "The old send was closed. Check the saved conversation before requesting any action again."
            : "Another request is already active. Its saved conversation has been opened.");
        } else if (isUnsubmittedAssistantError(cause) || (!retrying && code === "assistant_not_configured_for_account")) {
          pendingRef.current = null;
          setPending(null);
          setError(assistantErrorMessage(cause));
        } else setError(`${assistantErrorMessage(cause)} Retry the same send to check whether it was accepted.`);
      }
      return false;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const stop = async () => {
    if (!runID || stopping) return;
    cancelOperation.current?.abort();
    const controller = new AbortController();
    cancelOperation.current = controller;
    setStopping(true);
    setError("");
    try {
      await cancelAssistantRun(apiBase, companyID, runID, controller.signal);
      if (controller.signal.aborted) return;
      setNotice("Stop requested. Any completed actions remain saved.");
      if (!connected) void observeRun(runID, startOperation());
    } catch (cause) {
      if (!controller.signal.aborted) { setStopping(false); setError(assistantErrorMessage(cause)); }
    }
  };

  const newConversation = () => {
    if (busy || runID || pendingRef.current) return;
    operation.current?.abort();
    selectID(""); setMessages([]); setNextMessageOffset(null); setReply(""); setError(""); setNotice("");
  };

  const loadOlder = async () => {
    if (nextOffset === null || busy || runID || pendingRef.current) return;
    const controller = startOperation();
    setBusy(true);
    try {
      const result = await listAssistantConversations(apiBase, companyID, controller.signal, nextOffset);
      if (controller.signal.aborted) return;
      setConversations((current) => [...current, ...result.conversations.filter((item) => !current.some((saved) => saved.id === item.id))]);
      setNextOffset(result.has_more ? result.next_offset ?? nextOffset + 50 : null);
    } catch (cause) {
      if (!controller.signal.aborted) setError(assistantErrorMessage(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const loadEarlierMessages = async () => {
    if (nextMessageOffset === null || !conversationID || busy || runID || pendingRef.current) return;
    const controller = startOperation();
    setBusy(true);
    try {
      const result = await getAssistantConversation(apiBase, companyID, conversationID, controller.signal, nextMessageOffset);
      if (controller.signal.aborted) return;
      setMessages((current) => [...result.messages.filter((item) => !current.some((saved) => saved.id === item.id)), ...current]);
      setNextMessageOffset(result.has_older_messages ? result.next_message_offset ?? nextMessageOffset + 500 : null);
    } catch (cause) {
      if (!controller.signal.aborted) setError(assistantErrorMessage(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return {
    conversations, conversationID, messages, runID, reply, busy, connected, stopping, error, notice, pending,
    load, loadOlder, nextOffset, loadEarlierMessages, nextMessageOffset, send, stop, newConversation,
    resume: () => { setError(""); if (runID) void observeRun(runID, startOperation()); else void load(); },
  };
}
