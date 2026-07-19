import { useCallback, useEffect, useRef } from "react";
import {
  EditorTextboxSync,
  type EditorTextboxSyncRequest,
  type EditorTextboxSyncResourceType,
} from "./editorTextboxSync.js";

type UseEditorTextboxSyncInput = {
  enabled: boolean;
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resourceType: EditorTextboxSyncResourceType;
  resourceID: string;
  documentID: string;
  initialHTML: string;
  requestJSON: EditorTextboxSyncRequest;
  onHTML: (html: string, source: "remote" | "recovery") => void;
  onPendingChange?: (pendingCount: number) => void;
  flushPendingLocalInput?: () => void;
  onDeleted?: () => void;
  onError?: (cause: unknown) => void;
};

export function useEditorTextboxSync(input: UseEditorTextboxSyncInput) {
  const syncRef = useRef<EditorTextboxSync | null>(null);
  const callbacksRef = useRef(input);
  const scheduledBeforeMountRef = useRef<{ html: string; immediate: boolean } | null>(null);
  callbacksRef.current = input;

  const identity = input.enabled
    ? [input.apiBase, input.companyID, input.currentUserID, input.resourceType, input.resourceID, input.documentID].join("\u001f")
    : "";

  useEffect(() => {
    if (!identity) return undefined;
    const current = callbacksRef.current;
    const sync = new EditorTextboxSync({
      apiBase: current.apiBase,
      companyID: current.companyID,
      currentUserID: current.currentUserID,
      resourceType: current.resourceType,
      resourceID: current.resourceID,
      documentID: current.documentID,
      initialHTML: current.initialHTML,
      requestJSON: current.requestJSON,
      onHTML: (html, source) => callbacksRef.current.onHTML(html, source),
      onPendingChange: (count) => callbacksRef.current.onPendingChange?.(count),
      flushPendingLocalInput: () => callbacksRef.current.flushPendingLocalInput?.(),
      onDeleted: () => callbacksRef.current.onDeleted?.(),
      onError: (cause) => callbacksRef.current.onError?.(cause),
    });
    syncRef.current = sync;
    sync.start();
    const early = scheduledBeforeMountRef.current;
    scheduledBeforeMountRef.current = null;
    if (early) sync.schedule(early.html, early.immediate);
    return () => {
      callbacksRef.current.flushPendingLocalInput?.();
      void sync.shutdown()
        .catch((cause) => callbacksRef.current.onError?.(cause))
        .finally(() => {
          if (syncRef.current === sync) syncRef.current = null;
        });
    };
  }, [identity]);

  const scheduleDocumentSave = useCallback((html: string, immediate = false) => {
    const sync = syncRef.current;
    if (sync) sync.schedule(html, immediate);
    else scheduledBeforeMountRef.current = { html, immediate };
  }, []);

  const flushPendingDocumentSave = useCallback(async () => {
    await syncRef.current?.flush();
  }, []);

  const recoverDocument = useCallback(async () => {
    await syncRef.current?.recover();
  }, []);

  return { scheduleDocumentSave, flushPendingDocumentSave, recoverDocument };
}
