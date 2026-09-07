import { lazy, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MangoTiptapEditorProps } from "./tiptap/MangoTiptapEditor.js";
import { MangoTiptapStaticRenderer } from "./tiptap/MangoTiptapStaticRenderer.js";
import { createEmptyMangoTiptapDocument, type MangoTiptapDocument } from "./tiptap/mangoTiptapDocument.js";
import { captureMangoTiptapPointerBookmark, type MangoTiptapPointerActivationRequest } from "./tiptap/mangoTiptapPointerActivation.js";
import "./processStepInstructionEditor.css";

const LazyMangoTiptapEditor = lazy(async () => {
  const module = await import("./tiptap/MangoTiptapEditor.js");
  return { default: module.MangoTiptapEditor };
});

export type ProcessStepEditorPlacement = {
  stepID: string;
  container: HTMLElement;
  activation: MangoTiptapPointerActivationRequest;
};

type Props = MangoTiptapEditorProps & {
  body?: MangoTiptapDocument;
  placement?: ProcessStepEditorPlacement | null;
  onReturn?: () => void;
};

/** One native Step editor and save session; its host moves without remounting. */
export function ProcessStepInstructionEditor({ body, placement, onReturn, onDocumentSnapshotChange, onCanonicalDocumentChange, style, ...props }: Props) {
  const homeSlot = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  const [preview, setPreview] = useState(() => body ?? createEmptyMangoTiptapDocument());
  const [returnActivation, setReturnActivation] = useState<MangoTiptapPointerActivationRequest | null>(null);
  const callbacks = useRef({ onDocumentSnapshotChange, onCanonicalDocumentChange });
  callbacks.current = { onDocumentSnapshotChange, onCanonicalDocumentChange };
  const inMap = placement?.stepID === props.resourceID ? placement : null;

  useLayoutEffect(() => {
    const destination = inMap?.container ?? homeSlot.current;
    if (!destination) return undefined;
    host.className = "mango-step-editor-host";
    host.dataset.mangoStepEditorLocation = inMap ? "map" : "sidebar";
    destination.appendChild(host);
    return () => host.remove();
  }, [host, inMap?.container]);
  useLayoutEffect(() => { if (inMap) setReturnActivation(null); }, [inMap]);

  const publishSnapshot = useCallback((document: MangoTiptapDocument) => {
    setPreview(document);
    callbacks.current.onDocumentSnapshotChange?.(document);
  }, []);
  const publishCanonical = useCallback((document: MangoTiptapDocument) => {
    setPreview(document);
    callbacks.current.onCanonicalDocumentChange?.(document);
  }, []);

  return <>
    <div ref={homeSlot} className="mango-step-editor-slot">
      {inMap && <div className="mango-step-editor-copy" onPointerDown={(event) => {
        if (event.button !== 0 || !onReturn) return;
        if ((event.target as Element).closest("a, button, input, [data-mango-entity-link]")) return;
        event.preventDefault();
        const coordinates = { left: event.clientX, top: event.clientY };
        setReturnActivation({ requestID: inMap.activation.requestID, coordinates, bookmark: captureMangoTiptapPointerBookmark(event.currentTarget, event.target, coordinates) });
        onReturn();
      }}>
        <MangoTiptapStaticRenderer value={preview} ariaLabel={props.ariaLabel} style={style} />
      </div>}
    </div>
    {createPortal(<LazyMangoTiptapEditor {...props}
      style={inMap ? { ...style, minHeight: 0, height: "100%" } : style}
      pointerActivation={inMap?.activation ?? returnActivation}
      onDocumentSnapshotChange={publishSnapshot} onCanonicalDocumentChange={publishCanonical} />, host)}
  </>;
}
