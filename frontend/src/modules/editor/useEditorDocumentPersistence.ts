import type React from "react";
import { useCallback, useEffect } from "react";
import { deserializeEditorDocumentHTML } from "./richTextEditing.js";
import { hydrateEditorAttachmentImageFrames } from "./editorImages.js";
import { loadMangoAttachmentObjectURL } from "../attachments/attachmentApi.js";
import {
  documentTargetKey,
  generateStableInformationID,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
  type LinkedEntityKind,
} from "./editorTypes.js";
import { useEditorTextboxSync } from "./useEditorTextboxSync.js";

type UseEditorDocumentPersistenceInput = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  linkedEntityKind: "" | LinkedEntityKind;
  linkedEntityID: string;
  documentInformationID: string;
  editorDocumentRef: React.MutableRefObject<HTMLDivElement | null>;
  attachmentHydrationCleanupRef: React.MutableRefObject<(() => void) | null>;
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
  flushPendingLocalInput?: () => void;
  requestJSON: <T>(path: string, init?: RequestInit) => Promise<T>;
  invalidateDocumentTargetCaches: (target: DocumentSaveTarget) => void;
};

export function editorTextboxSyncUserMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "";
  switch (code) {
    case "editor_collaboration_document_too_large":
      return "This document is over Mango's 2 MiB limit. The last edit was rolled back; shorten or split the content before continuing.";
    case "editor_collaboration_storage_quota_exceeded":
      return "Mango could not safely store this edit because browser storage is full. The last edit was rolled back; free browser storage before continuing.";
    case "editor_collaboration_storage_unavailable":
    case "editor_collaboration_storage_blocked":
    case "editor_collaboration_storage_failed":
      return "Mango could not safely store this edit on this device. The last edit was rolled back; check browser storage settings and retry.";
    case "editor_collaboration_sensitive_content_rejected":
      return "This paste contains an unsafe or temporary attachment URL. The last edit was rolled back; attach the file through Mango instead.";
    default:
      return code || "Mango could not sync this document. Your queued work remains on this device and will retry.";
  }
}

export function useEditorDocumentPersistence(input: UseEditorDocumentPersistenceInput) {
  const {
    apiBase, companyID, currentUserID, linkedEntityKind, linkedEntityID, documentInformationID,
    editorDocumentRef, attachmentHydrationCleanupRef, documentDraftRef, persistedDocumentRef, documentInformationIDRef,
    documentRevisionRef, currentDocumentTargetKeyRef, persistedDocumentTargetKeyRef,
    pendingSaveRef, queuedSaveRef, saveInFlightRef, setDocumentInformationID, setError,
    flushPendingLocalInput, requestJSON, invalidateDocumentTargetCaches,
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
    if (!saveInFlightRef.current) persistedDocumentRef.current = html;
    if (target) {
      const key = documentTargetKey(target);
      currentDocumentTargetKeyRef.current = key;
      persistedDocumentTargetKeyRef.current = key;
      invalidateDocumentTargetCaches(target);
    }
    const element = editorDocumentRef.current;
    if (element) {
      const nextHTML = deserializeEditorDocumentHTML(html);
      attachmentHydrationCleanupRef.current?.();
      attachmentHydrationCleanupRef.current = null;
      if (element.innerHTML !== nextHTML) element.innerHTML = nextHTML;
      if (apiBase.trim() && companyID.trim()) {
        attachmentHydrationCleanupRef.current = hydrateEditorAttachmentImageFrames(element, (attachmentID, variant, options) => (
          loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, variant, options)
        ));
      }
    }
  }, [apiBase, attachmentHydrationCleanupRef, companyID, currentDocumentTargetKeyRef, documentDraftRef, documentInformationIDRef, editorDocumentRef, invalidateDocumentTargetCaches, linkedEntityID, linkedEntityKind, persistedDocumentRef, persistedDocumentTargetKeyRef]);

  const { scheduleDocumentSave: scheduleSyncedSave, flushPendingDocumentSave: flushSyncedSave, recoverDocument } = useEditorTextboxSync({
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
    flushPendingLocalInput,
    onPendingChange: (count) => {
      saveInFlightRef.current = count > 0;
      if (count === 0) queuedSaveRef.current = null;
    },
    onDeleted: () => applyCommittedHTML(""),
    onError: (cause) => setError(editorTextboxSyncUserMessage(cause)),
  });

  useEffect(() => {
    const protectPendingWork = (event: BeforeUnloadEvent) => {
      if (!saveInFlightRef.current && pendingSaveRef.current === null && queuedSaveRef.current === null) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingWork);
    return () => window.removeEventListener("beforeunload", protectPendingWork);
  }, [pendingSaveRef, queuedSaveRef, saveInFlightRef]);

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
    scheduleSyncedSave(nextText, immediate);
    if (immediate) pendingSaveRef.current = null;
  }, [buildDocumentSaveRequest, documentDraftRef, pendingSaveRef, scheduleSyncedSave, setError]);

  const flushPendingDocumentSave = useCallback((fallbackText?: string) => {
    const next = typeof fallbackText === "string" ? fallbackText : documentDraftRef.current;
    if (next !== documentDraftRef.current || pendingSaveRef.current) scheduleDocumentSave(next, true);
    pendingSaveRef.current = null;
    void flushSyncedSave().catch((cause) => setError(cause instanceof Error ? cause.message : "failed_to_sync_editor_operations"));
  }, [documentDraftRef, flushSyncedSave, pendingSaveRef, scheduleDocumentSave, setError]);

  const saveDocumentNow = useCallback(async (nextText: string) => {
    scheduleDocumentSave(nextText, true);
    await flushSyncedSave();
  }, [flushSyncedSave, scheduleDocumentSave]);

  return {
    buildDocumentSaveRequest,
    scheduleDocumentSave,
    flushPendingDocumentSave,
    saveDocumentNow,
    retryFailedSave: recoverDocument,
    discardFailedSave: () => undefined,
  };
}
