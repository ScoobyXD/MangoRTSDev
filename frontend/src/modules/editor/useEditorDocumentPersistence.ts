import type React from "react";
import { useCallback } from "react";
import {
  documentTargetKey,
  EDITOR_AUTOSAVE_DELAY_MS,
  generateStableInformationID,
  sameSaveRequest,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
  type LinkedEntityKind,
} from "./editorTypes";

type UseEditorDocumentPersistenceInput = {
  companyID: string;
  linkedEntityKind: "" | LinkedEntityKind;
  linkedEntityID: string;
  documentDraftRef: React.MutableRefObject<string>;
  persistedDocumentRef: React.MutableRefObject<string>;
  documentInformationIDRef: React.MutableRefObject<string>;
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

export function useEditorDocumentPersistence({
  companyID,
  linkedEntityKind,
  linkedEntityID,
  documentDraftRef,
  persistedDocumentRef,
  documentInformationIDRef,
  currentDocumentTargetKeyRef,
  persistedDocumentTargetKeyRef,
  saveTimerRef,
  pendingSaveRef,
  queuedSaveRef,
  saveInFlightRef,
  setDocumentInformationID,
  setError,
  requestJSON,
  invalidateDocumentTargetCaches,
}: UseEditorDocumentPersistenceInput) {
  const ensureDocumentInformationID = useCallback(() => {
    if (!documentInformationIDRef.current) {
      documentInformationIDRef.current = generateStableInformationID();
      setDocumentInformationID(documentInformationIDRef.current);
    }
    return documentInformationIDRef.current;
  }, [documentInformationIDRef, setDocumentInformationID]);

  const buildDocumentSaveRequest = useCallback((nextText: string): DocumentSaveRequest | null => {
    if (!linkedEntityID || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate")) return null;
    if (!documentInformationIDRef.current && nextText.trim().length === 0) return null;
    const target = {
      entityKind: linkedEntityKind,
      entityID: linkedEntityID,
      informationID: ensureDocumentInformationID(),
    };
    currentDocumentTargetKeyRef.current = documentTargetKey(target);
    return { target, text: nextText };
  }, [currentDocumentTargetKeyRef, documentInformationIDRef, ensureDocumentInformationID, linkedEntityID, linkedEntityKind]);

  const persistDocumentRequest = useCallback(async (request: DocumentSaveRequest) => {
    const targetKey = documentTargetKey(request.target);
    const isCurrentTarget = () => currentDocumentTargetKeyRef.current === targetKey;
    if (isCurrentTarget() && request.text === persistedDocumentRef.current && persistedDocumentTargetKeyRef.current === targetKey) return;

    setError("");
    try {
      if (request.text.trim().length === 0) {
        const path = request.target.entityKind === "logic_gate"
          ? `/v1/logic-gates/${request.target.entityID}/projection/${request.target.informationID}?company_id=${encodeURIComponent(companyID)}`
          : `/v1/nodes/${request.target.entityID}/projection/${request.target.informationID}?company_id=${encodeURIComponent(companyID)}`;
        await requestJSON<{ status: string }>(path, { method: "DELETE" });
        if (isCurrentTarget()) {
          persistedDocumentRef.current = "";
          persistedDocumentTargetKeyRef.current = targetKey;
        }
        invalidateDocumentTargetCaches(request.target);
        return;
      }

      const informationPayload = {
        company_id: companyID,
        type: "Text box",
        information: request.text,
        information_id: request.target.informationID,
      };
      if (request.target.entityKind === "logic_gate") {
        await requestJSON<unknown>(`/v1/logic-gates/${request.target.entityID}/information`, {
          method: "POST",
          body: JSON.stringify(informationPayload),
        });
      } else {
        await requestJSON<unknown>(`/v1/nodes/${request.target.entityID}/information`, {
          method: "POST",
          body: JSON.stringify(informationPayload),
        });
      }
      if (isCurrentTarget()) {
        setDocumentInformationID(request.target.informationID);
        persistedDocumentRef.current = request.text;
        persistedDocumentTargetKeyRef.current = targetKey;
      }
      invalidateDocumentTargetCaches(request.target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_save_document");
    }
  }, [
    companyID,
    currentDocumentTargetKeyRef,
    invalidateDocumentTargetCaches,
    persistedDocumentRef,
    persistedDocumentTargetKeyRef,
    requestJSON,
    setDocumentInformationID,
    setError,
  ]);

  const enqueueDocumentSave = useCallback((request: DocumentSaveRequest) => {
    if (saveInFlightRef.current) {
      queuedSaveRef.current = request;
      return;
    }

    // Autosaves must preserve the user's final text without POSTing every
    // keystroke. One request runs at a time; while it is running, we keep only
    // the newest queued value for this editor instance.
    saveInFlightRef.current = true;
    void (async () => {
      let nextRequest: DocumentSaveRequest | null = request;
      try {
        while (nextRequest) {
          const activeRequest: DocumentSaveRequest = nextRequest;
          queuedSaveRef.current = null;
          await persistDocumentRequest(activeRequest);
          const queued = queuedSaveRef.current;
          nextRequest = queued && !sameSaveRequest(queued, activeRequest) ? queued : null;
        }
      } finally {
        saveInFlightRef.current = false;
      }
    })();
  }, [persistDocumentRequest, queuedSaveRef, saveInFlightRef]);

  const scheduleDocumentSave = useCallback((nextText: string, immediate = false) => {
    documentDraftRef.current = nextText;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const request = buildDocumentSaveRequest(nextText);
    pendingSaveRef.current = request;
    if (!request) return;

    if (immediate) {
      pendingSaveRef.current = null;
      enqueueDocumentSave(request);
      return;
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) enqueueDocumentSave(pending);
    }, EDITOR_AUTOSAVE_DELAY_MS);
  }, [buildDocumentSaveRequest, documentDraftRef, enqueueDocumentSave, pendingSaveRef, saveTimerRef]);

  const flushPendingDocumentSave = useCallback((fallbackText?: string) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current ?? (typeof fallbackText === "string" ? buildDocumentSaveRequest(fallbackText) : null);
    pendingSaveRef.current = null;
    if (pending) enqueueDocumentSave(pending);
  }, [buildDocumentSaveRequest, enqueueDocumentSave, pendingSaveRef, saveTimerRef]);

  return {
    buildDocumentSaveRequest,
    scheduleDocumentSave,
    flushPendingDocumentSave,
  };
}
