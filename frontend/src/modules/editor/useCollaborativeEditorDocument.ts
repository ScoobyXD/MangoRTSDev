import { useCallback, useEffect, useRef } from "react";
import {
  EditorCollaborationController,
  type EditorCollaborationRequest,
  type EditorCollaborationResourceType,
} from "./editorCollaboration.js";

type UseCollaborativeEditorDocumentInput = {
  enabled: boolean;
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resourceType: EditorCollaborationResourceType;
  resourceID: string;
  documentID: string;
  initialHTML: string;
  requestJSON: EditorCollaborationRequest;
  onHTML: (html: string, source: "remote" | "recovery") => void;
  onPendingChange?: (pendingCount: number) => void;
  flushPendingLocalInput?: () => void;
  onDeleted?: () => void;
  onError?: (cause: unknown) => void;
};

export function useCollaborativeEditorDocument(input: UseCollaborativeEditorDocumentInput) {
  const controllerRef = useRef<EditorCollaborationController | null>(null);
  const callbacksRef = useRef(input);
  const scheduledBeforeMountRef = useRef<{ html: string; immediate: boolean } | null>(null);
  callbacksRef.current = input;

  const identity = input.enabled
    ? [input.apiBase, input.companyID, input.currentUserID, input.resourceType, input.resourceID, input.documentID].join("\u001f")
    : "";

  useEffect(() => {
    if (!identity) return undefined;
    const current = callbacksRef.current;
    const controller = new EditorCollaborationController({
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
    controllerRef.current = controller;
    controller.start();
    const early = scheduledBeforeMountRef.current;
    scheduledBeforeMountRef.current = null;
    if (early) controller.schedule(early.html, early.immediate);
    return () => {
      void controller.flush().catch((cause) => callbacksRef.current.onError?.(cause));
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [identity]);

  const scheduleDocumentSave = useCallback((html: string, immediate = false) => {
    const controller = controllerRef.current;
    if (controller) controller.schedule(html, immediate);
    else scheduledBeforeMountRef.current = { html, immediate };
  }, []);

  const flushPendingDocumentSave = useCallback(async () => {
    await controllerRef.current?.flush();
  }, []);

  const recoverDocument = useCallback(async () => {
    await controllerRef.current?.recover();
  }, []);

  return { scheduleDocumentSave, flushPendingDocumentSave, recoverDocument };
}
