import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  aiErrorDetails, aiErrorMessage, cancelAIRun, createAIChat, createAIRun, getAIChat, getAIRun, isUnsubmittedAIError,
  listAIChats, watchAIRun,
  type AIChatSummary, type AIMessage, type AIRun, type AISubmission,
} from "./aiApi.js";

type VisibleMessage = Pick<AIMessage, "role" | "content"> & { message_id: number | string };
const historyPendingNotice = "Saved chat history is still syncing. Resume to check it.";

export function useAIChat(apiBase: string, companyID: string, visible: boolean) {
  const [chats, setChats] = useState<AIChatSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [chatID, setChatID] = useState("");
  const selectedID = useRef<string | null>(null);
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
  const [nextMessageOffset, setNextMessageOffset] = useState<number | null>(null);
  const [runID, setRunID] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<AISubmission | null>(null);
  const pendingRef = useRef<AISubmission | null>(null);
  const completedHistory = useRef<{ runID: string; chatID: string } | null>(null);
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
    if (completedHistory.current?.chatID !== id) completedHistory.current = null;
    selectedID.current = id;
    setChatID(id);
  };

  const savedHistoryReady = async (id: string, controller: AbortController): Promise<boolean> => {
    const completed = completedHistory.current;
    if (!completed || completed.chatID !== id) return true;
    const run = await getAIRun(apiBase, companyID, completed.runID, controller.signal);
    if (controller.signal.aborted) return false;
    if (run.run_id !== completed.runID) throw new Error("Invalid run response.");
    // The durable callback sends this observation after its final transcript snapshots.
    if (!run.history?.some((event) => event.event === "run.finished")) {
      setNotice((current) => current.includes(historyPendingNotice) ? current : [current, historyPendingNotice].filter(Boolean).join(" "));
      return false;
    }
    completedHistory.current = null;
    setNotice((current) => current.replace(historyPendingNotice, "").trim());
    return true;
  };

  const finishRun = async (run: AIRun, controller: AbortController) => {
    if (controller.signal.aborted) return;
    setRunID("");
    pendingRef.current = null;
    setPending(null);
    setConnected(false);
    setStopping(false);
    if (run.output) setMessages((current) => [...current, { message_id: `local:${run.run_id}:ai`, role: "ai", content: run.output! }]);
    setReply("");
    if (run.status === "failed") setError("AI could not complete this response. Any completed actions remain saved.");
    if (run.status === "cancelled") setNotice("Stopped. Any completed actions remain saved.");
    if (run.status === "interrupted") setNotice("The run was interrupted. Its saved chat and completed actions were kept.");
    const id = run.chat_id || selectedID.current;
    if (!id) return;
    completedHistory.current = { runID: run.run_id, chatID: id };
    try {
      // Keep the exact completed reply while native history callbacks are queued.
      // Reading run status also saves native final output independently of the stream.
      if (!await savedHistoryReady(id, controller)) return;
      const chat = await getAIChat(apiBase, companyID, id, controller.signal);
      if (!controller.signal.aborted) {
        setMessages(chat.messages);
        setNextMessageOffset(chat.has_older_messages ? chat.next_message_offset ?? 500 : null);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(aiErrorMessage(cause));
    }
  };

  const observeRun = async (id: string, controller: AbortController) => {
    setRunID(id);
    setReply("");
    setConnected(true);
    try {
      const run = await getAIRun(apiBase, companyID, id, controller.signal);
      if (controller.signal.aborted) return;
      if (run.run_id !== id) throw new Error("Invalid run response.");
      if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
        await finishRun(run, controller);
        return;
      }
      if (run.pending_submission) {
        pendingRef.current = run.pending_submission;
        setPending(run.pending_submission);
        setRunID("");
        setConnected(false);
        return;
      }
      let finalRun: AIRun | undefined;
      await watchAIRun(apiBase, companyID, id, controller.signal, (event) => {
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
        setError(`${aiErrorMessage(cause)} Resume to check the saved response; do not send it again.`);
      }
    }
  };

  const loadChat = async (id: string, controller: AbortController) => {
    if (!await savedHistoryReady(id, controller)) {
      if (runID && !controller.signal.aborted) void observeRun(runID, controller);
      return;
    }
    const chat = await getAIChat(apiBase, companyID, id, controller.signal);
    if (controller.signal.aborted) return;
    selectID(chat.chat_id);
    setMessages(chat.messages);
    setNextMessageOffset(chat.has_older_messages ? chat.next_message_offset ?? 500 : null);
    pendingRef.current = chat.pending_submission ?? null;
    setPending(chat.pending_submission ?? null);
    setRunID(chat.pending_submission ? "" : chat.active_run_id || "");
    setReply("");
    setBusy(false);
    if (chat.active_run_id && !chat.pending_submission) void observeRun(chat.active_run_id, controller);
  };

  const load = async (id?: string) => {
    if (pendingRef.current) return;
    const controller = startOperation();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await listAIChats(apiBase, companyID, controller.signal);
      if (controller.signal.aborted) return;
      setChats(result.chats);
      setNextOffset(result.has_more ? result.next_offset ?? (result.offset ?? 0) + 50 : null);
      const nextID = id ?? selectedID.current ?? result.chats[0]?.chat_id;
      if (nextID) await loadChat(nextID, controller);
      else { selectID(""); setMessages([]); setRunID(""); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(aiErrorMessage(cause));
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
    if (busy || stopping || runID || !message.trim()) return false;
    if (new TextEncoder().encode(message).length > 32_000) {
      setError("This message is too long. Shorten it before sending; your draft has been kept.");
      return false;
    }
    const retrying = pendingRef.current !== null;
    const submission = pendingRef.current ?? { run_id: crypto.randomUUID(), chat_id: selectedID.current || undefined, message };
    if (submission.message !== message) return false;
    pendingRef.current = submission;
    setPending(submission);
    const controller = startOperation();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const run = await createAIRun(apiBase, companyID, submission, controller.signal);
      if (controller.signal.aborted) return false;
      const id = run.chat_id;
      if (run.run_id !== submission.run_id || !id || (submission.chat_id && id !== submission.chat_id)) throw new Error("Invalid run response.");
      if (run.pending_submission) {
        setNotice("This send is still being checked. Retry the saved message to check its status.");
        return false;
      }
      pendingRef.current = null;
      setPending(null);
      selectID(id);
      if (!retrying) setMessages((current) => [...current, { message_id: `local:${submission.run_id}:user`, role: "user", content: message }]);
      setChats((current) => current.some((item) => item.chat_id === id) ? current : [{ chat_id: id, name: message.slice(0, 80) }, ...current]);
      setBusy(false);
      void observeRun(run.run_id, controller);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) {
        const { code, activeChatID, activeRunID } = aiErrorDetails(cause);
        if (code === "ai_request_expired_check_saved_chat" || (code === "ai_run_active_or_request_conflict" && activeChatID && activeRunID)) {
          pendingRef.current = null;
          setPending(null);
          selectedID.current = null;
          await load(activeChatID);
          setNotice(code === "ai_request_expired_check_saved_chat"
            ? "The old send was closed. Check the saved chat before requesting any action again."
            : "Another request is already active. Its saved chat has been opened.");
        } else if (isUnsubmittedAIError(cause) || (!retrying && code === "ai_not_configured_for_account")) {
          pendingRef.current = null;
          setPending(null);
          setError(aiErrorMessage(cause));
        } else setError(`${aiErrorMessage(cause)} Retry the same send to check whether it was accepted.`);
      }
      return false;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const stop = async () => {
    const id = runID || pendingRef.current?.run_id;
    if (!id || busy || stopping) return;
    cancelOperation.current?.abort();
    const controller = new AbortController();
    cancelOperation.current = controller;
    setStopping(true);
    setError("");
    try {
      const run = await cancelAIRun(apiBase, companyID, id, controller.signal);
      if (controller.signal.aborted) return;
      if (run.run_id !== id) throw new Error("Invalid run response.");
      if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
        await finishRun(run, startOperation());
        return;
      }
      setNotice("Stop requested. Any completed actions remain saved.");
      if (pendingRef.current) setStopping(false);
      else if (!connected) void observeRun(id, startOperation());
    } catch (cause) {
      if (!controller.signal.aborted) { setStopping(false); setError(aiErrorMessage(cause)); }
    }
  };

  const newChat = async () => {
    if (busy || runID || pendingRef.current) return;
    const controller = startOperation();
    const id = crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const chat = await createAIChat(apiBase, companyID, id, controller.signal);
      if (controller.signal.aborted) return;
      if (chat.chat_id !== id) throw new Error("Invalid chat response.");
      setChats((current) => [chat, ...current]);
      selectID(id); setMessages([]); setNextMessageOffset(null); setReply(""); setNotice("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(aiErrorMessage(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const loadOlder = async () => {
    if (nextOffset === null || busy || runID || pendingRef.current) return;
    const controller = startOperation();
    setBusy(true);
    try {
      const result = await listAIChats(apiBase, companyID, controller.signal, nextOffset);
      if (controller.signal.aborted) return;
      setChats((current) => [...current, ...result.chats.filter((item) => !current.some((saved) => saved.chat_id === item.chat_id))]);
      setNextOffset(result.has_more ? result.next_offset ?? nextOffset + 50 : null);
    } catch (cause) {
      if (!controller.signal.aborted) setError(aiErrorMessage(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const loadEarlierMessages = async () => {
    if (nextMessageOffset === null || !chatID || busy || runID || pendingRef.current) return;
    const controller = startOperation();
    setBusy(true);
    try {
      const result = await getAIChat(apiBase, companyID, chatID, controller.signal, nextMessageOffset);
      if (controller.signal.aborted) return;
      setMessages((current) => [...result.messages.filter((item) => !current.some((saved) => saved.message_id === item.message_id)), ...current]);
      setNextMessageOffset(result.has_older_messages ? result.next_message_offset ?? nextMessageOffset + 500 : null);
    } catch (cause) {
      if (!controller.signal.aborted) setError(aiErrorMessage(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return {
    chats, chatID, messages, runID, reply, busy, connected, stopping, error, notice, pending,
    historyPending: completedHistory.current !== null,
    load, loadOlder, nextOffset, loadEarlierMessages, nextMessageOffset, send, stop, newChat,
    resume: () => { setError(""); if (runID) void observeRun(runID, startOperation()); else void load(); },
  };
}
