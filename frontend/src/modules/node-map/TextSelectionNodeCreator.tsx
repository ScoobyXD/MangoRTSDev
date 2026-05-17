import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishLiveSelection } from "../selectionCoordinator";
import { createNodeFromSelectionTitle, normalizeSelectedTextForNodeTitle } from "./selectionNodeCreation";

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
};

const BUTTON_SIZE = 28;
const VIEWPORT_MARGIN = 8;

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
  return Boolean(element.closest('[data-text-selection-node-creator="true"], button, input, textarea, select, option, [role="button"]'));
}

function readSelectionSnapshot(root: HTMLElement | null): TextSelectionSnapshot | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (root && !root.contains(range.commonAncestorContainer)) return null;
  if (selectionIsInsideSuppressedElement(range)) return null;

  const title = normalizeSelectedTextForNodeTitle(selection.toString());
  if (!title) return null;

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
  if (!Number.isFinite(rect.right) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) return null;

  const x = clampToViewport(rect.right + 42, BUTTON_SIZE, window.innerWidth);
  const y = clampToViewport(rect.top + (rect.height - BUTTON_SIZE) / 2, BUTTON_SIZE, window.innerHeight);
  return { title, x, y };
}

export const TextSelectionNodeCreator: React.FC<TextSelectionNodeCreatorProps> = ({ companyID, accent, targetFrameIDs, rootRef }) => {
  const [snapshot, setSnapshot] = useState<TextSelectionSnapshot | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const cleanTargetFrameIDs = useMemo(
    () => Array.from(new Set(targetFrameIDs.map((id) => id.trim()).filter(Boolean))),
    [targetFrameIDs],
  );

  const scheduleRefresh = useCallback(() => {
    if (creating) return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setSnapshot(readSelectionSnapshot(rootRef?.current ?? null));
      setError("");
    });
  }, [creating, rootRef]);

  useEffect(() => {
    scheduleRefresh();
    document.addEventListener("selectionchange", scheduleRefresh);
    document.addEventListener("pointerup", scheduleRefresh, true);
    document.addEventListener("keyup", scheduleRefresh, true);
    document.addEventListener("scroll", scheduleRefresh, true);
    window.addEventListener("resize", scheduleRefresh);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      document.removeEventListener("selectionchange", scheduleRefresh);
      document.removeEventListener("pointerup", scheduleRefresh, true);
      document.removeEventListener("keyup", scheduleRefresh, true);
      document.removeEventListener("scroll", scheduleRefresh, true);
      window.removeEventListener("resize", scheduleRefresh);
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

  const createNode = useCallback(async () => {
    const current = snapshot;
    if (!current || creating) return;
    setCreating(true);
    setError("");
    try {
      const node = await createNodeFromSelectionTitle({ companyID, title: current.title });
      const treeID = `node-${node.node_id}`;
      publishLiveSelection({
        companyID,
        entityKind: "node",
        entityID: node.node_id,
        label: node.title,
        sourceFrameID: "text-selection-node-creator",
        sourceModule: "editor",
        targetFrameIDs: cleanTargetFrameIDs,
        selectedTreeID: treeID,
        selectedTreeIDs: [treeID],
        selectedEntityIDs: [node.node_id],
        selectionIntent: "navigate",
      });
      document.getSelection()?.removeAllRanges();
      setSnapshot(null);
    } catch {
      showError("Could not create node");
    } finally {
      setCreating(false);
    }
  }, [cleanTargetFrameIDs, companyID, creating, showError, snapshot]);

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
          void createNode();
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
      {error && (
        <div style={{ minWidth: 118, border: `1px solid ${accent}`, borderRadius: 6, background: "#ffffff", color: "#9a1c1c", padding: "5px 7px", fontSize: 11, fontWeight: 700, boxShadow: "0 8px 20px rgba(0,0,0,0.16)", textAlign: "center", letterSpacing: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
};
