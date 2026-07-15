import type React from "react";
import { useCallback } from "react";
import { deserializeEditorDocumentHTML } from "./richTextEditing.js";
import {
  documentTargetKey,
  generateStableInformationID,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
  type LinkedEntityKind,
} from "./editorTypes.js";
import { useCollaborativeEditorDocument } from "./useCollaborativeEditorDocument.js";

type UseEditorDocumentPersistenceInput = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  linkedEntityKind: "" | LinkedEntityKind;
  linkedEntityID: string;
  documentInformationID: string;
  editorDocumentRef: React.MutableRefObject<HTMLDivElement | null>;
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
  requestJSON: <T>(path: string, init?: RequestInit) => Promise<T>;
  invalidateDocumentTargetCaches: (target: DocumentSaveTarget) => void;
};

export function useEditorDocumentPersistence(input: UseEditorDocumentPersistenceInput) {
  const {
    apiBase, companyID, currentUserID, linkedEntityKind, linkedEntityID, documentInformationID,
    editorDocumentRef, documentDraftRef, persistedDocumentRef, documentInformationIDRef,
    documentRevisionRef, currentDocumentTargetKeyRef, persistedDocumentTargetKeyRef,
    pendingSaveRef, queuedSaveRef, saveInFlightRef, setDocumentInformationID, setError,
    requestJSON, invalidateDocumentTargetCaches,
  } = input;

  const ensureDocumentInformationID = useCallback(() => {
    if (!documentInformationIDRef.current) {
      documentInformationIDRef.current = generateStableInformationID();
      documentRevisionRef.current = 0;
      setDocumentInformationID(documentInformationIDRef.current);
    }
    return documentInformationIDRef.current;
  }, [documentInformationIDRef, documentRevisionRef, setDocumentInformationID]);

  const applyCommittedHTML = useCallback((html: string) => {
    const target = linkedEntityKind === "node" || linkedEntityKind === "logic_gate"
      ? { entityKind: linkedEntityKind, entityID: linkedEntityID, informationID: documentInformationIDRef.current }
      : null;
    documentDraftRef.current = html;
    persistedDocumentRef.current = html;
    if (target) {
      const key = documentTargetKey(target);
      currentDocumentTargetKeyRef.current = key;
      persistedDocumentTargetKeyRef.current = key;
      invalidateDocumentTargetCaches(target);
    }
    const element = editorDocumentRef.current;
    if (element) {
      const nextHTML = deserializeEditorDocumentHTML(html);
      if (element.innerHTML !== nextHTML) element.innerHTML = nextHTML;
    }
  }, [currentDocumentTargetKeyRef, documentDraftRef, documentInformationIDRef, editorDocumentRef, invalidateDocumentTargetCaches, linkedEntityID, linkedEntityKind, persistedDocumentRef, persistedDocumentTargetKeyRef]);

  const { scheduleDocumentSave: scheduleCollaborativeSave, flushPendingDocumentSave: flushCollaborativeSave, recoverDocument } = useCollaborativeEditorDocument({
    enabled: Boolean(currentUserID && companyID && linkedEntityID && documentInformationID && (linkedEntityKind === "node" || linkedEntityKind === "logic_gate")),
    apiBase,
    companyID,
    currentUserID,
    resourceType: linkedEntityKind === "logic_gate" ? "logic_gate" : "node",
    resourceID: linkedEntityID,
    documentID: documentInformationID,
    initialHTML: persistedDocumentRef.current,
    requestJSON,
    onHTML: applyCommittedHTML,
    onPendingChange: (count) => {
      saveInFlightRef.current = count > 0;
      if (count === 0) queuedSaveRef.current = null;
    },
    onDeleted: () => applyCommittedHTML(""),
    onError: (cause) => setError(cause instanceof Error ? cause.message : "failed_to_sync_editor_operations"),
  });

  const buildDocumentSaveRequest = useCallback((nextText: string): DocumentSaveRequest | null => {
    if (!currentUserID || !linkedEntityID || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate")) return null;
    if (!documentInformationIDRef.current && nextText.trim().length === 0) return null;
    const target = { entityKind: linkedEntityKind, entityID: linkedEntityID, informationID: ensureDocumentInformationID() };
    currentDocumentTargetKeyRef.current = documentTargetKey(target);
    return { target, text: nextText, baseRevision: documentRevisionRef.current };
  }, [currentDocumentTargetKeyRef, currentUserID, documentInformationIDRef, documentRevisionRef, ensureDocumentInformationID, linkedEntityID, linkedEntityKind]);

  const scheduleDocumentSave = useCallback((nextText: string, immediate = false) => {
    documentDraftRef.current = nextText;
    const request = buildDocumentSaveRequest(nextText);
    pendingSaveRef.current = request;
    if (!request) return;
    setError("");
    scheduleCollaborativeSave(nextText, immediate);
    if (immediate) pendingSaveRef.current = null;
  }, [buildDocumentSaveRequest, documentDraftRef, pendingSaveRef, scheduleCollaborativeSave, setError]);

  const flushPendingDocumentSave = useCallback((fallbackText?: string) => {
    const next = typeof fallbackText === "string" ? fallbackText : documentDraftRef.current;
    if (next !== documentDraftRef.current || pendingSaveRef.current) scheduleDocumentSave(next, true);
    pendingSaveRef.current = null;
    void flushCollaborativeSave().catch((cause) => setError(cause instanceof Error ? cause.message : "failed_to_sync_editor_operations"));
  }, [documentDraftRef, flushCollaborativeSave, pendingSaveRef, scheduleDocumentSave, setError]);

  const saveDocumentNow = useCallback(async (nextText: string) => {
    scheduleDocumentSave(nextText, true);
    await flushCollaborativeSave();
  }, [flushCollaborativeSave, scheduleDocumentSave]);

  return {
    buildDocumentSaveRequest,
    scheduleDocumentSave,
    flushPendingDocumentSave,
    saveDocumentNow,
    retryFailedSave: recoverDocument,
    discardFailedSave: () => undefined,
  };
}