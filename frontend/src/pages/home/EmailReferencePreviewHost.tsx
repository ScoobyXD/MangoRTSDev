import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getStoredEmailThread,
  listEmailCollaborations,
  type CommunicationsSharedInbox,
  type EmailMessage,
} from "../../modules/communications/communicationsApi.js";
import {
  EVENT_EDITOR_EMAIL_REFERENCE_OPEN,
  type EditorEntityLink,
} from "../../modules/editor/editorEntityLinks.js";
import type { LogicGateRecord } from "../../modules/logic-gates/types.js";
import type { NodeRecord } from "../../modules/nodes/types.js";
import {
  realtimePersonalMailboxScope,
  realtimeSharedMailboxScope,
  subscribeRealtimeScope,
} from "../../modules/realtime/realtimeWebSocket.js";
import { cleanIDList, formatError, logicGateTitle, nodeTitle } from "./homeUtils.js";

const EmailReferencePreviewModal = React.lazy(() => (
  import("./HomeParts.js").then((module) => ({ default: module.EmailReferencePreviewModal }))
));

type EmailReferencePreview = {
  requestID: number;
  refreshRevision: number;
  entity: EditorEntityLink;
  message: EmailMessage | null;
  threadMessages: EmailMessage[];
  resources: Array<{ kind: "node" | "logic_gate"; id: string; label: string }>;
  sharedInboxID?: string;
  accountEmail?: string;
  providerThreadID: string;
  waitingForHistory: boolean;
  loading: boolean;
  error: string;
};

export type EmailReferencePreviewHostProps = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  sharedInboxes?: CommunicationsSharedInbox[];
  nodes?: NodeRecord[];
  logicGates?: LogicGateRecord[];
  onOpenNode?: (nodeID: string) => void;
  onOpenLogicGate?: (logicGateID: string) => void;
};

const EMPTY_SHARED_INBOXES: CommunicationsSharedInbox[] = [];
const EMPTY_NODES: NodeRecord[] = [];
const EMPTY_LOGIC_GATES: LogicGateRecord[] = [];

export function EmailReferencePreviewHost({
  apiBase,
  companyID,
  currentUserID,
  sharedInboxes = EMPTY_SHARED_INBOXES,
  nodes = EMPTY_NODES,
  logicGates = EMPTY_LOGIC_GATES,
  onOpenNode,
  onOpenLogicGate,
}: EmailReferencePreviewHostProps) {
  const [preview, setPreview] = useState<EmailReferencePreview | null>(null);
  const requestIDRef = useRef(0);
  const nodesRef = useRef(nodes);
  const logicGatesRef = useRef(logicGates);
  nodesRef.current = nodes;
  logicGatesRef.current = logicGates;

  const close = useCallback(() => {
    requestIDRef.current += 1;
    setPreview(null);
  }, []);

  const open = useCallback((entity: EditorEntityLink) => {
    if (entity.entityType !== "email_message") return;
    const sharedInboxID = entity.emailSharedInboxID?.trim() ?? "";
    const sharedFolder = sharedInboxID
      ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxID || folder.shared_inbox_id === sharedInboxID)
      : undefined;
    const previewSharedInboxID = sharedFolder?.folder_id || sharedInboxID || undefined;
    const previewAccountEmail = previewSharedInboxID ? undefined : entity.emailAccountEmail?.trim().toLowerCase() || undefined;
    const requestID = requestIDRef.current + 1;
    requestIDRef.current = requestID;
    setPreview({
      requestID,
      refreshRevision: 0,
      entity,
      message: null,
      threadMessages: [],
      resources: [],
      sharedInboxID: previewSharedInboxID,
      accountEmail: previewAccountEmail,
      providerThreadID: "",
      waitingForHistory: false,
      loading: true,
      error: "",
    });
  }, [sharedInboxes]);

  useEffect(() => {
    const onOpenEmailReference = (event: Event) => {
      const entity = (event as CustomEvent<EditorEntityLink>).detail;
      if (entity?.entityType === "email_message") open(entity);
    };
    window.addEventListener(EVENT_EDITOR_EMAIL_REFERENCE_OPEN, onOpenEmailReference);
    return () => window.removeEventListener(EVENT_EDITOR_EMAIL_REFERENCE_OPEN, onOpenEmailReference);
  }, [open]);

  const requestID = preview?.requestID ?? 0;
  const refreshRevision = preview?.refreshRevision ?? 0;
  const entity = preview?.entity ?? null;
  const sharedInboxID = preview?.sharedInboxID;
  const accountEmail = preview?.accountEmail;
  const providerThreadID = preview?.providerThreadID ?? "";
  const waitingForHistory = preview?.waitingForHistory === true;

  useEffect(() => {
    if (!entity || requestID === 0) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const emailThreadID = entity.emailThreadID?.trim() ?? "";
        const emailMessageID = entity.emailMessageID?.trim() ?? "";
        if (!emailThreadID || !emailMessageID) throw new Error("stored_email_reference_id_missing");
        if (!sharedInboxID && !accountEmail) throw new Error("stored_email_reference_scope_missing");
        const storedThread = await getStoredEmailThread(emailThreadID, companyID, sharedInboxID, { accountEmail });
        if (cancelled || requestIDRef.current !== requestID) return;
        const selectedMessage = storedThread.messages.find((message) => message.email_message_id === emailMessageID);
        if (!selectedMessage) throw new Error("stored_email_message_not_found");
        const waiting = !storedThread.history_complete && storedThread.download_status !== "failed";
        const threadDownloadError = !storedThread.history_complete && storedThread.download_status === "failed"
          ? storedThread.last_download_error?.trim() || "Stored email thread download failed. Showing available messages."
          : "";
        setPreview((current) => current?.requestID === requestID ? {
          ...current,
          message: selectedMessage,
          threadMessages: storedThread.messages,
          providerThreadID: storedThread.thread_id?.trim() || "",
          waitingForHistory: waiting,
          loading: false,
          error: threadDownloadError,
        } : current);

        const nodeByID = new Map(nodesRef.current.map((node) => [node.node_id, node]));
        const logicGateByID = new Map(logicGatesRef.current.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
        if (nodeByID.size === 0 && logicGateByID.size === 0) return;
        const matchingCollaborations = await listEmailCollaborations({
          companyID,
          messageID: selectedMessage.id,
          threadID: selectedMessage.thread_id?.trim() || "",
          sharedInboxID,
          accountEmail,
        }).catch(() => []);
        if (cancelled || requestIDRef.current !== requestID) return;
        const nodeIDs = cleanIDList([
          ...matchingCollaborations.map((collaboration) => collaboration.node_id),
          ...storedThread.messages.map((message) => message.collaboration_node_id ?? ""),
        ]).filter((nodeID) => nodeByID.has(nodeID));
        const logicGateIDs = cleanIDList([
          ...storedThread.messages.flatMap((message) => message.logic_gate_ids ?? []),
          ...nodeIDs.flatMap((nodeID) => nodeByID.get(nodeID)?.logic_gate_ids ?? []),
        ]).filter((logicGateID) => logicGateByID.has(logicGateID));
        setPreview((current) => current?.requestID === requestID ? {
          ...current,
          resources: [
            ...nodeIDs.map((nodeID) => ({ kind: "node" as const, id: nodeID, label: nodeTitle(nodeByID.get(nodeID)) })),
            ...logicGateIDs.map((logicGateID) => ({ kind: "logic_gate" as const, id: logicGateID, label: logicGateTitle(logicGateByID.get(logicGateID)) })),
          ],
        } : current);
      } catch (cause) {
        if (cancelled || requestIDRef.current !== requestID) return;
        setPreview((current) => {
          if (current?.requestID !== requestID) return current;
          const error = formatError(cause, "Unable to open the referenced email");
          if (current.message && current.threadMessages.length > 0) return { ...current, loading: false, error };
          return {
            ...current,
            message: null,
            threadMessages: [],
            resources: [],
            waitingForHistory: false,
            loading: false,
            error,
          };
        });
      }
    })();
    return () => { cancelled = true; };
  }, [accountEmail, companyID, entity, refreshRevision, requestID, sharedInboxID]);

  useEffect(() => {
    if (!entity || !waitingForHistory || requestID === 0) return undefined;
    const scope = sharedInboxID
      ? realtimeSharedMailboxScope(sharedInboxID)
      : realtimePersonalMailboxScope(currentUserID, accountEmail ?? "");
    if (!apiBase.trim() || !scope) return undefined;
    const refresh = () => {
      setPreview((current) => (
        current?.requestID === requestID && current.waitingForHistory
          ? { ...current, refreshRevision: current.refreshRevision + 1 }
          : current
      ));
    };
    return subscribeRealtimeScope(apiBase, companyID, scope, {
      onAccepted: refresh,
      onMailboxMessageChanged: (change) => {
        if (providerThreadID && change.thread_id?.trim() === providerThreadID) refresh();
      },
    });
  }, [accountEmail, apiBase, companyID, currentUserID, entity, providerThreadID, requestID, sharedInboxID, waitingForHistory]);

  const loadMessageBody = useCallback(async (messageID: string): Promise<EmailMessage | null> => {
    if (!preview) return null;
    return preview.threadMessages.find((message) => message.id === messageID || message.email_message_id === messageID) ?? null;
  }, [preview]);

  if (!preview) return null;
  return (
    <React.Suspense fallback={null}>
      <EmailReferencePreviewModal
        message={preview.message}
        threadMessages={preview.threadMessages}
        resources={preview.resources}
        nodes={nodes}
        companyID={companyID}
        sharedInboxID={preview.sharedInboxID}
        accountEmail={preview.accountEmail}
        loading={preview.loading}
        error={preview.error}
        onLoadMessageBody={loadMessageBody}
        onOpenNode={(nodeID) => {
          close();
          onOpenNode?.(nodeID);
        }}
        onOpenLogicGate={(logicGateID) => {
          close();
          onOpenLogicGate?.(logicGateID);
        }}
        onClose={close}
      />
    </React.Suspense>
  );
}
