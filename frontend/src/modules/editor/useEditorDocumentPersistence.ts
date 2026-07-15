import type React from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  documentTargetKey,
  EDITOR_AUTOSAVE_DELAY_MS,
  generateStableInformationID,
  sameSaveRequest,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
  type LinkedEntityKind,
} from "./editorTypes";
import { createEditorDocumentSaveQueue, type EditorDocumentSaveQueue } from "./editorDocumentSaveQueue";
import {
  clearEditorProjectionDraft,
  editorSyncBlockReason,
  parseEditorProjectionConflict,
  readEditorProjectionDraft,
  retainEditorProjectionDraft,
  runEditorWriteWithBoundedRetry,
  type EditorProjectionDraftScope,
  type EditorSyncBlock,
} from "./editorProjectionSync";

type ProjectionWriteResponse = { revision?: number };

type UseEditorDocumentPersistenceInput = {
  companyID: string;
  currentUserID: string;
  linkedEntityKind: "" | LinkedEntityKind;
  linkedEntityID: string;
  documentDraftRef: React.MutableRefObject<string>;
  persistedDocumentRef: React.MutableRefObject<string>;
  documentInformationIDRef: React.MutableRefObject<string>;
  documentRevisionRef: React.MutableRefObject<number>;
  currentDocumentTargetKeyRef: React.MutableRefObject<string>;
  persistedDocumentTargetKeyRef: React.MutableRefObject<string>;
  saveTimerRef: React.MutableRefObject<number | null>;
  pendingSaveRef: React.MutableRefObject<DocumentSaveRequest | null>;
  queuedSaveRef: React.MutableRefObject<DocumentSaveRequest | null>;
  saveInFlightRef: React.MutableRefObject<boolean>;
  setDocumentInformationID: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  onSyncBlocked: (block: EditorSyncBlock) => void;
  requestJSON: <T>(path: string, init?: RequestInit) => Promise<T>;
  invalidateDocumentTargetCaches: (target: DocumentSaveTarget) => void;
};

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function useEditorDocumentPersistence({
  companyID,
  currentUserID,
  linkedEntityKind,
  linkedEntityID,
  documentDraftRef,
  persistedDocumentRef,
  documentInformationIDRef,
  documentRevisionRef,
  currentDocumentTargetKeyRef,
  persistedDocumentTargetKeyRef,
  saveTimerRef,
  pendingSaveRef,
  queuedSaveRef,
  saveInFlightRef,
  setDocumentInformationID,
  setError,
  onSyncBlocked,
  requestJSON,
  invalidateDocumentTargetCaches,
}: UseEditorDocumentPersistenceInput) {
  const acknowledgedRevisionByTargetRef = useRef(new Map<string, number>());

  const ensureDocumentInformationID = useCallback(() => {
    if (!documentInformationIDRef.current) {
      documentInformationIDRef.current = generateStableInformationID();
      documentRevisionRef.current = 0;
      setDocumentInformationID(documentInformationIDRef.current);
    }
    return documentInformationIDRef.current;
  }, [documentInformationIDRef, documentRevisionRef, setDocumentInformationID]);

  const scopeForRequest = useCallback((request: DocumentSaveRequest): EditorProjectionDraftScope => ({
    userID: currentUserID,
    companyID,
    entityKind: request.target.entityKind,
    entityID: request.target.entityID,
    informationID: request.target.informationID,
  }), [companyID, currentUserID]);

  const buildDocumentSaveRequest = useCallback((nextText: string): DocumentSaveRequest | null => {
    if (!currentUserID || !linkedEntityID || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate")) return null;
    if (!documentInformationIDRef.current && nextText.trim().length === 0) return null;
    const target = { entityKind: linkedEntityKind, entityID: linkedEntityID, informationID: ensureDocumentInformationID() };
    const targetKey = documentTargetKey(target);
    currentDocumentTargetKeyRef.current = targetKey;
    const baseRevision = documentRevisionRef.current;
    acknowledgedRevisionByTargetRef.current.set(targetKey, baseRevision);
    return { target, text: nextText, baseRevision };
  }, [currentDocumentTargetKeyRef, currentUserID, documentInformationIDRef, documentRevisionRef, ensureDocumentInformationID, linkedEntityID, linkedEntityKind]);

  const persistDocumentRequest = useCallback(async (request: DocumentSaveRequest) => {
    const targetKey = documentTargetKey(request.target);
    const isCurrentTarget = () => currentDocumentTargetKeyRef.current === targetKey;
    const expectedRevision = acknowledgedRevisionByTargetRef.current.get(targetKey) ?? request.baseRevision;
    if (isCurrentTarget() && request.text === persistedDocumentRef.current && persistedDocumentTargetKeyRef.current === targetKey) return;
    setError("");
    try {
      let acknowledgedRevision = expectedRevision;
      if (request.text.trim().length === 0) {
        const basePath = request.target.entityKind === "logic_gate"
          ? `/v1/logic-gates/${request.target.entityID}/projection/${request.target.informationID}`
          : `/v1/nodes/${request.target.entityID}/projection/${request.target.informationID}`;
        const path = `${basePath}?company_id=${encodeURIComponent(companyID)}&expected_revision=${expectedRevision}`;
        await runEditorWriteWithBoundedRetry(() => requestJSON<{ status: string }>(path, { method: "DELETE" }));
        acknowledgedRevision = 0;
      } else {
        const informationPayload = {
          company_id: companyID,
          type: "Text box",
          information: request.text,
          information_id: request.target.informationID,
          expected_revision: expectedRevision,
        };
        const path = request.target.entityKind === "logic_gate"
          ? `/v1/logic-gates/${request.target.entityID}/projection`
          : `/v1/nodes/${request.target.entityID}/projection`;
        const response = await runEditorWriteWithBoundedRetry(() => requestJSON<ProjectionWriteResponse>(path, { method: "POST", body: JSON.stringify(informationPayload) }));
        if (!Number.isInteger(response?.revision) || (response.revision ?? 0) < 1) throw new Error("invalid_projection_revision_ack");
        acknowledgedRevision = response.revision as number;
      }
      acknowledgedRevisionByTargetRef.current.set(targetKey, acknowledgedRevision);
      const scope = scopeForRequest(request);
      const retained = readEditorProjectionDraft(browserStorage(), scope);
      if (!retained || retained.text === request.text) clearEditorProjectionDraft(browserStorage(), scope);
      else retainEditorProjectionDraft(browserStorage(), scope, { ...retained, baseRevision: acknowledgedRevision });
      if (isCurrentTarget()) {
        setDocumentInformationID(request.target.informationID);
        documentRevisionRef.current = acknowledgedRevision;
        persistedDocumentRef.current = request.text;
        persistedDocumentTargetKeyRef.current = targetKey;
      }
      invalidateDocumentTargetCaches(request.target);
    } catch (cause) {
      const conflict = parseEditorProjectionConflict(cause);
      const scope = scopeForRequest(request);
      const retained = readEditorProjectionDraft(browserStorage(), scope);
      onSyncBlocked({
        reason: editorSyncBlockReason(cause),
        target: scope,
        localText: retained?.text ?? request.text,
        current: conflict?.current ?? null,
        message: conflict ? "Another tab saved a newer full document. Choose which version to keep." : "Mango could not confirm this write. Editing is blocked until the retained draft is resolved.",
      });
      setError(cause instanceof Error ? cause.message : "failed_to_save_document");
      throw cause;
    }
  }, [companyID, currentDocumentTargetKeyRef, documentRevisionRef, invalidateDocumentTargetCaches, onSyncBlocked, persistedDocumentRef, persistedDocumentTargetKeyRef, requestJSON, scopeForRequest, setDocumentInformationID, setError]);

  const saveQueueRef = useRef<EditorDocumentSaveQueue<DocumentSaveRequest> | null>(null);
  if (!saveQueueRef.current) saveQueueRef.current = createEditorDocumentSaveQueue<DocumentSaveRequest>();
  const saveQueue = saveQueueRef.current;
  useLayoutEffect(() => {
    saveQueue.configure({
      targetKey: (request) => documentTargetKey(request.target),
      sameRequest: (left, right) => sameSaveRequest(left, right),
      persist: persistDocumentRequest,
      onStateChange: (state) => {
        saveInFlightRef.current = state.inFlight;
        queuedSaveRef.current = state.failedRequest ?? state.queuedRequests[0] ?? null;
      },
    });
  }, [persistDocumentRequest, queuedSaveRef, saveInFlightRef, saveQueue]);

  const retainRequestDraft = useCallback((request: DocumentSaveRequest) => {
    retainEditorProjectionDraft(browserStorage(), scopeForRequest(request), { text: request.text, baseRevision: request.baseRevision, updatedAt: new Date().toISOString() });
  }, [scopeForRequest]);

  const enqueueDocumentSave = useCallback((request: DocumentSaveRequest) => saveQueue.enqueue(request), [saveQueue]);
  const waitForSaveQueue = useCallback(async () => saveQueue.waitForIdle(), [saveQueue]);

  const saveDocumentNow = useCallback(async (nextText: string) => {
    documentDraftRef.current = nextText;
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const request = buildDocumentSaveRequest(nextText);
    pendingSaveRef.current = null;
    if (!request) return;
    retainRequestDraft(request);
    saveQueue.enqueue(request);
    await waitForSaveQueue();
  }, [buildDocumentSaveRequest, documentDraftRef, pendingSaveRef, retainRequestDraft, saveQueue, saveTimerRef, waitForSaveQueue]);

  const scheduleDocumentSave = useCallback((nextText: string, immediate = false) => {
    documentDraftRef.current = nextText;
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const request = buildDocumentSaveRequest(nextText);
    pendingSaveRef.current = request;
    if (!request) return;
    retainRequestDraft(request);
    if (immediate) { pendingSaveRef.current = null; enqueueDocumentSave(request); return; }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) enqueueDocumentSave(pending);
    }, EDITOR_AUTOSAVE_DELAY_MS);
  }, [buildDocumentSaveRequest, documentDraftRef, enqueueDocumentSave, pendingSaveRef, retainRequestDraft, saveTimerRef]);

  const flushPendingDocumentSave = useCallback((fallbackText?: string) => {
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const pending = pendingSaveRef.current ?? (typeof fallbackText === "string" ? buildDocumentSaveRequest(fallbackText) : null);
    pendingSaveRef.current = null;
    if (pending) { retainRequestDraft(pending); enqueueDocumentSave(pending); }
  }, [buildDocumentSaveRequest, enqueueDocumentSave, pendingSaveRef, retainRequestDraft, saveTimerRef]);

  const retryFailedSave = useCallback((latestRevision?: number) => {
    const failed = saveQueue.getState().failedRequest;
    if (!failed) return;
    const next = Number.isInteger(latestRevision) ? { ...failed, baseRevision: latestRevision as number } : failed;
    acknowledgedRevisionByTargetRef.current.set(documentTargetKey(next.target), next.baseRevision);
    retainRequestDraft(next);
    saveQueue.retryFailed(next);
  }, [retainRequestDraft, saveQueue]);

  const discardFailedSave = useCallback(() => saveQueue.discardFailed(), [saveQueue]);

  return { buildDocumentSaveRequest, scheduleDocumentSave, flushPendingDocumentSave, saveDocumentNow, retryFailedSave, discardFailedSave };
}
