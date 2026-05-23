import React, { useCallback, useEffect, useRef, useState } from "react";
import { createNodeFromSelectionTitle, normalizeSelectedTextForNodeTitle, type SelectionNodeRelationshipKind } from "./selectionNodeCreation";

type TextSelectionNodeCreatorProps = {
  companyID: string;
  accent: string;
  targetFrameIDs: string[];
  rootRef?: React.RefObject<HTMLElement>;
};

type TextSelectionSnapshot = {
  title: string;
  x: number;
  y: number;
  sourceNodeID: string;
};

const BUTTON_SIZE = 28;
const VIEWPORT_MARGIN = 8;
const NODE_SELECTION_SOURCE_SELECTOR = '[data-mango-linked-entity-kind="node"][data-mango-linked-entity-id]';
const RELATIONSHIP_OPTIONS: Array<{ kind: SelectionNodeRelationshipKind; label: string }> = [
  { kind: "parent", label: "Create parent node" },
  { kind: "peer", label: "Create peer node" },
  { kind: "child", label: "Create child node" },
];

const CreateNodeIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" fill="none" stroke={color} strokeWidth="1.4" />
    <path d="M8 5v6M5 8h6" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function clampToViewport(value: number, size: number, viewportSize: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(value, viewportSize - size - VIEWPORT_MARGIN));
}

function elementForNode(node: Node): Element | null {
  if (node instanceof Element) return node;
  return node.parentElement;
}

function selectionIsInsideSuppressedElement(range: Range): boolean {
  const element = elementForNode(range.commonAncestorContainer);
  if (!element) return false;
  return Boolean(element.closest('[data-text-selection-node-creator="true"], [data-node-map-viewport="true"], button, input, textarea, select, option, [role="button"]'));
}

function eventTargetIsNodeCreator(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-text-selection-node-creator="true"]'));
}

function readSelectionSourceNodeID(range: Range): string {
  const element = elementForNode(range.commonAncestorContainer);
  const sourceElement = element?.closest(NODE_SELECTION_SOURCE_SELECTOR);
  return sourceElement instanceof HTMLElement
    ? sourceElement.dataset.mangoLinkedEntityId?.trim() ?? ""
    : "";
}

function readSelectionSnapshot(root: HTMLElement | null): TextSelectionSnapshot | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (root && !root.contains(range.commonAncestorContainer)) return null;
  if (selectionIsInsideSuppressedElement(range)) return null;
  const sourceNodeID = readSelectionSourceNodeID(range);
  if (!sourceNodeID) return null;

  const title = normalizeSelectedTextForNodeTitle(selection.toString());
  if (!title) return null;

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
  if (!Number.isFinite(rect.right) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) return null;

  const x = clampToViewport(rect.right + 42, BUTTON_SIZE, window.innerWidth);
  const y = clampToViewport(rect.top + (rect.height - BUTTON_SIZE) / 2, BUTTON_SIZE, window.innerHeight);
  return { title, x, y, sourceNodeID };
}

export const TextSelectionNodeCreator: React.FC<TextSelectionNodeCreatorProps> = ({ companyID, accent, rootRef }) => {
  const [snapshot, setSnapshot] = useState<TextSelectionSnapshot | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  const pointerSelectingRef = useRef(false);

  const scheduleRefresh = useCallback((force = false) => {
    if (creating) return;
    if (pointerSelectingRef.current && !force) return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setSnapshot(readSelectionSnapshot(rootRef?.current ?? null));
      setError("");
    });
  }, [creating, rootRef]);

  useEffect(() => {
    scheduleRefresh();
    const refreshAfterSelectionChange = () => scheduleRefresh();
    const refreshAfterInput = () => scheduleRefresh();
    const refreshAfterPointerEnd = () => {
      if (!pointerSelectingRef.current) return;
      pointerSelectingRef.current = false;
      scheduleRefresh(true);
    };
    const hideDuringPointerSelection = (event: PointerEvent) => {
      if (eventTargetIsNodeCreator(event.target)) return;
      pointerSelectingRef.current = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setSnapshot(null);
      setMenuOpen(false);
      setError("");
    };
    document.addEventListener("selectionchange", refreshAfterSelectionChange);
    document.addEventListener("pointerdown", hideDuringPointerSelection, true);
    document.addEventListener("pointerup", refreshAfterPointerEnd, true);
    document.addEventListener("pointercancel", refreshAfterPointerEnd, true);
    document.addEventListener("keyup", refreshAfterInput, true);
    document.addEventListener("scroll", refreshAfterInput, true);
    window.addEventListener("resize", refreshAfterInput);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      document.removeEventListener("selectionchange", refreshAfterSelectionChange);
      document.removeEventListener("pointerdown", hideDuringPointerSelection, true);
      document.removeEventListener("pointerup", refreshAfterPointerEnd, true);
      document.removeEventListener("pointercancel", refreshAfterPointerEnd, true);
      document.removeEventListener("keyup", refreshAfterInput, true);
      document.removeEventListener("scroll", refreshAfterInput, true);
      window.removeEventListener("resize", refreshAfterInput);
    };
  }, [scheduleRefresh]);

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => {
      errorTimerRef.current = null;
      setError("");
    }, 2400);
  }, []);

  const createNode = useCallback(async (relationshipKind: SelectionNodeRelationshipKind) => {
    const current = snapshot;
    if (!current || creating) return;
    setCreating(true);
    setError("");
    try {
      await createNodeFromSelectionTitle({
        companyID,
        title: current.title,
        sourceNodeID: current.sourceNodeID,
        relationshipKind,
      });
      document.getSelection()?.removeAllRanges();
      setSnapshot(null);
      setMenuOpen(false);
    } catch {
      showError("Could not create node");
    } finally {
      setCreating(false);
    }
  }, [companyID, creating, showError, snapshot]);

  if (!snapshot || !companyID) return null;

  return (
    <div
      data-text-selection-node-creator="true"
      style={{
        position: "fixed",
        left: snapshot.x,
        top: snapshot.y,
        zIndex: 150,
        display: "grid",
        gap: 6,
        justifyItems: "center",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        title="Create node from selection"
        aria-label="Create node from selection"
        disabled={creating}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: 6,
          border: `1px solid ${accent}`,
          background: "#ffffff",
          color: accent,
          display: "grid",
          placeItems: "center",
          padding: 0,
          cursor: creating ? "wait" : "pointer",
          opacity: creating ? 0.72 : 1,
          boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
        }}
      >
        <CreateNodeIcon color={accent} />
      </button>
      {menuOpen && (
        <div
          role="menu"
          aria-label="Create related node"
          style={{
            minWidth: 156,
            display: "grid",
            gap: 2,
            padding: 4,
            border: `1px solid ${accent}`,
            borderRadius: 7,
            background: "#ffffff",
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
          }}
        >
          {RELATIONSHIP_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="menuitem"
              disabled={creating}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void createNode(option.kind);
              }}
              style={{
                minHeight: 27,
                border: "none",
                borderRadius: 5,
                background: "transparent",
                color: "#111827",
                cursor: creating ? "wait" : "pointer",
                font: "inherit",
                fontSize: 11,
                fontWeight: 800,
                textAlign: "left",
                padding: "5px 8px",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div style={{ minWidth: 118, border: `1px solid ${accent}`, borderRadius: 6, background: "#ffffff", color: "#b00020", padding: "5px 7px", fontSize: 11, fontWeight: 700, boxShadow: "0 8px 20px rgba(0,0,0,0.16)", textAlign: "center", letterSpacing: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
};
