import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameDataModel } from "../../types";
import { KanbanContent } from "../../modules/kanban/KanbanContent";
import type { ArenaBoardLeftResizeRequest, ArenaBoardLeftResizeResult } from "../../modules/kanban/KanbanContentModel";
import { logicGateIDFromKanbanBoardID } from "../../modules/kanban/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../../modules/selectionCoordinator";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { humanLabelOrFallback } from "../../modules/entityLabels.js";
import { consumePendingLogicGateArenaSelection, readPendingLogicGateArenaSelection, type PendingLogicGateArenaSelection } from "./logicGateArenaLaunch";

type LogicGateArenaPageProps = {
  frames: FrameDataModel[];
  updateFrames: (updater: (previous: FrameDataModel[]) => FrameDataModel[]) => void;
  targetLogicGate?: {
    logicGateID: string;
    label: string;
    nodeID?: string;
    informationID?: string;
    requestID?: number;
  } | null;
  onCollapseToTab?: (selection: { logicGateID: string; label: string; nodeID?: string }) => void;
  onNodeOpen?: (selection: { logicGateID: string; label: string; nodeID: string }) => void;
  onNodeClose?: (selection: { logicGateID: string; label: string }) => void;
  onLogicGateTitleChange?: (update: { logicGateID: string; label: string }) => void;
};

type ArenaResizeState = {
  sessionID: number;
  startX: number;
  containerWidth: number;
  editorUnits: number;
  kanbanUnits: number;
  editorFrameID: string;
  kanbanFrameID: string;
};

type ArenaLogicGateSelection = {
  id: string;
  label: string;
  emptyMessage: string;
  nodeID?: string;
  informationID?: string;
  requestID?: number;
};

const SPLITTER_WIDTH_PX = 5;
const MIN_EDITOR_WIDTH_PX = 300;
const MIN_KANBAN_WIDTH_PX = 340;
const LazyArenaEditorContent = React.lazy(() => import("../../modules/editor/EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
    forcedEmptyMessage?: string;
    focusInformationID?: string;
    focusRequestID?: number;
    onLogicGateTitleChange?: (update: { logicGateID: string; label: string }) => void;
  }>,
})));
const arenaPanelFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />;

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyArenaLogicGateSelection(): ArenaLogicGateSelection {
  return { id: "", label: "", emptyMessage: "" };
}

function selectionFromTargetLogicGate(targetLogicGate: LogicGateArenaPageProps["targetLogicGate"]): ArenaLogicGateSelection | null {
  if (!targetLogicGate) return null;
  const logicGateID = targetLogicGate.logicGateID.trim();
  if (!logicGateID) return null;
  return {
    id: logicGateID,
    label: humanLabelOrFallback(targetLogicGate.label, ""),
    emptyMessage: "",
    nodeID: targetLogicGate.nodeID,
    informationID: targetLogicGate.informationID,
    requestID: targetLogicGate.requestID,
  };
}

function selectionFromPendingLogicGateArenaSelection(pending: PendingLogicGateArenaSelection | null): ArenaLogicGateSelection | null {
  if (!pending) return null;
  return {
    id: pending.logicGateID,
    label: humanLabelOrFallback(pending.label, ""),
    emptyMessage: "",
    nodeID: pending.nodeID,
    informationID: pending.informationID,
    requestID: pending.createdAt,
  };
}

function readInitialArenaLogicGateSelection(companyID: string, targetLogicGate: LogicGateArenaPageProps["targetLogicGate"]): ArenaLogicGateSelection {
  return selectionFromTargetLogicGate(targetLogicGate)
    ?? selectionFromPendingLogicGateArenaSelection(readPendingLogicGateArenaSelection(companyID))
    ?? emptyArenaLogicGateSelection();
}

function arenaSelectionChangedAt(selection: ArenaLogicGateSelection): number {
  return selection.requestID && selection.requestID > 0 ? selection.requestID : Date.now();
}

function sameArenaLogicGateSelection(current: ArenaLogicGateSelection, next: ArenaLogicGateSelection): boolean {
  return current.id === next.id
    && current.label === next.label
    && current.emptyMessage === next.emptyMessage
    && (current.nodeID ?? "") === (next.nodeID ?? "")
    && (current.informationID ?? "") === (next.informationID ?? "")
    && (current.requestID ?? 0) === (next.requestID ?? 0);
}

function getArenaFrames(frames: FrameDataModel[]) {
  return {
    editor: frames.find((frame) => frame.kind === "editor") ?? null,
    kanban: frames.find((frame) => frame.kind === "kanban") ?? null,
  };
}

export const LogicGateArenaPage: React.FC<LogicGateArenaPageProps> = ({ frames, updateFrames, targetLogicGate, onCollapseToTab, onNodeOpen, onNodeClose, onLogicGateTitleChange }) => {
  const companyID = getActiveCompanyID();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ArenaResizeState | null>(null);
  const linkedNodeEditorResizeRef = useRef<ArenaResizeState | null>(null);
  const resizeSessionIDRef = useRef(0);
  const lastArenaSelectionChangedAtRef = useRef(0);
  const selectedLogicGateRef = useRef<ArenaLogicGateSelection>(emptyArenaLogicGateSelection());
  const [kanbanBoardLeftResizeRequest, setKanbanBoardLeftResizeRequest] = useState<ArenaBoardLeftResizeRequest | null>(null);
  const [selectedLogicGate, setSelectedLogicGate] = useState<ArenaLogicGateSelection>(() => {
    const initialSelection = readInitialArenaLogicGateSelection(companyID, targetLogicGate);
    if (initialSelection.id) lastArenaSelectionChangedAtRef.current = arenaSelectionChangedAt(initialSelection);
    selectedLogicGateRef.current = initialSelection;
    return initialSelection;
  });

  const arenaFrames = useMemo(() => getArenaFrames(frames), [frames]);
  const editorFrame = arenaFrames.editor;
  const kanbanFrame = arenaFrames.kanban;
  const editorUnits = Math.max(1, editorFrame?.w ?? 34);
  const kanbanUnits = Math.max(1, kanbanFrame?.w ?? 44);

  useEffect(() => {
    selectedLogicGateRef.current = selectedLogicGate;
  }, [selectedLogicGate]);

  const applyLogicGateTitle = useCallback((update: { logicGateID: string; label: string }) => {
    const logicGateID = update.logicGateID.trim();
    const label = humanLabelOrFallback(update.label, "");
    if (!logicGateID || !label) return;
    const currentSelection = selectedLogicGateRef.current;
    if (currentSelection.id !== logicGateID) return;
    lastArenaSelectionChangedAtRef.current = Math.max(lastArenaSelectionChangedAtRef.current, Date.now());
    selectedLogicGateRef.current = { ...currentSelection, label };
    setSelectedLogicGate((current) => (
      current.id === logicGateID && current.label !== label ? { ...current, label } : current
    ));
    onLogicGateTitleChange?.({ logicGateID, label });
  }, [onLogicGateTitleChange]);

  const createArenaResizeState = useCallback((startX: number): ArenaResizeState | null => {
    if (!containerRef.current || !editorFrame || !kanbanFrame) return null;
    const bounds = containerRef.current.getBoundingClientRect();
    resizeSessionIDRef.current += 1;
    return {
      sessionID: resizeSessionIDRef.current,
      startX,
      containerWidth: bounds.width,
      editorUnits,
      kanbanUnits,
      editorFrameID: editorFrame.id,
      kanbanFrameID: kanbanFrame.id,
    };
  }, [editorFrame, editorUnits, kanbanFrame, kanbanUnits]);

  const applyArenaResizeDelta = useCallback((state: ArenaResizeState, deltaX: number, notifyKanbanOverlay: boolean): ArenaBoardLeftResizeResult => {
    const availableWidth = Math.max(1, state.containerWidth - SPLITTER_WIDTH_PX);
    const totalUnits = state.editorUnits + state.kanbanUnits;
    const deltaUnits = deltaX * (totalUnits / availableWidth);
    const minEditor = totalUnits * (MIN_EDITOR_WIDTH_PX / availableWidth);
    const minKanban = totalUnits * (MIN_KANBAN_WIDTH_PX / availableWidth);
    const nextEditor = clamp(state.editorUnits + deltaUnits, minEditor, totalUnits - minKanban);
    const nextKanban = state.editorUnits + state.kanbanUnits - nextEditor;
    const appliedDeltaX = (nextEditor - state.editorUnits) * (availableWidth / totalUnits);
    const result: ArenaBoardLeftResizeResult = {
      appliedDeltaX,
      startKanbanWidthPx: state.kanbanUnits * (availableWidth / totalUnits),
      kanbanWidthPx: nextKanban * (availableWidth / totalUnits),
    };

    updateFrames((previous) => previous.map((frame) => {
      if (frame.id === state.editorFrameID) return { ...frame, x: 0, y: 0, w: nextEditor, h: 1 };
      if (frame.id === state.kanbanFrameID) return { ...frame, x: nextEditor, y: 0, w: nextKanban, h: 1 };
      return frame;
    }));
    if (notifyKanbanOverlay) {
      setKanbanBoardLeftResizeRequest({
        sessionID: state.sessionID,
        appliedDeltaX,
        startKanbanWidthPx: result.startKanbanWidthPx,
        kanbanWidthPx: result.kanbanWidthPx,
      });
    }
    return result;
  }, [updateFrames]);

  useEffect(() => {
    const pendingSelection = selectionFromPendingLogicGateArenaSelection(consumePendingLogicGateArenaSelection(companyID));
    if (!pendingSelection) return;
    const changedAt = arenaSelectionChangedAt(pendingSelection);
    if (changedAt <= lastArenaSelectionChangedAtRef.current) return;
    lastArenaSelectionChangedAtRef.current = changedAt;
    setSelectedLogicGate((current) => sameArenaLogicGateSelection(current, pendingSelection) ? current : pendingSelection);
  }, [companyID]);

  useEffect(() => {
    const nextSelection = selectionFromTargetLogicGate(targetLogicGate);
    if (!nextSelection) return;
    lastArenaSelectionChangedAtRef.current = Math.max(lastArenaSelectionChangedAtRef.current, arenaSelectionChangedAt(nextSelection));
    setSelectedLogicGate((current) => sameArenaLogicGateSelection(current, nextSelection) ? current : nextSelection);
  }, [targetLogicGate?.informationID, targetLogicGate?.logicGateID, targetLogicGate?.label, targetLogicGate?.nodeID, targetLogicGate?.requestID]);

  const applySelection = useCallback((selection: LiveSelectionChange | null) => {
    if (!selection || selection.companyID !== companyID) return;
    if (selection.changedAt > 0 && selection.changedAt < lastArenaSelectionChangedAtRef.current) return;
    if (selection.entityKind === "logic_gate") {
      lastArenaSelectionChangedAtRef.current = selection.changedAt || Date.now();
      setSelectedLogicGate({ id: selection.entityID.trim(), label: humanLabelOrFallback(selection.label, ""), emptyMessage: "" });
      return;
    }
    if (selection.entityKind === "kanban") {
      const logicGateID = logicGateIDFromKanbanBoardID(selection.entityID);
      lastArenaSelectionChangedAtRef.current = selection.changedAt || Date.now();
      setSelectedLogicGate({ id: logicGateID, label: logicGateID ? humanLabelOrFallback(selection.label, "") : "", emptyMessage: logicGateID ? "" : "Sorry, this editor can only display Logic Gates." });
      return;
    }
    if (selection.entityKind === "node" && selection.sourceModule === "company-explorer") {
      lastArenaSelectionChangedAtRef.current = selection.changedAt || Date.now();
      setSelectedLogicGate({ id: "", label: "", emptyMessage: "Sorry, this editor can only display Logic Gates." });
      return;
    }
  }, [companyID]);

  useEffect(() => {
    if (!editorFrame?.id) return;
    const initialSelections = [editorFrame.id, kanbanFrame?.id ?? ""]
      .map((frameID) => frameID ? readLiveSelectionForFrame(companyID, frameID) : null)
      .filter((selection): selection is LiveSelectionChange => Boolean(selection))
      .sort((a, b) => a.changedAt - b.changedAt);
    for (const selection of initialSelections) applySelection(selection);
    const unsubscribeEditor = subscribeLiveSelection(editorFrame.id, applySelection);
    const unsubscribeKanban = kanbanFrame?.id ? subscribeLiveSelection(kanbanFrame.id, applySelection) : () => {};
    return () => {
      unsubscribeEditor();
      unsubscribeKanban();
    };
  }, [applySelection, companyID, editorFrame?.id, kanbanFrame?.id]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      event.preventDefault();
      applyArenaResizeDelta(state, event.clientX - state.startX, true);
    };
    const onPointerUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [applyArenaResizeDelta]);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = createArenaResizeState(event.clientX);
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = state;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [createArenaResizeState]);

  const startNodeEditorLinkedLeftResize = useCallback((): boolean => {
    const state = createArenaResizeState(0);
    if (!state) return false;
    linkedNodeEditorResizeRef.current = state;
    return true;
  }, [createArenaResizeState]);

  const resizeArenaFromNodeEditorLeft = useCallback((deltaX: number): ArenaBoardLeftResizeResult | null => {
    const state = linkedNodeEditorResizeRef.current;
    if (!state) return null;
    return applyArenaResizeDelta(state, deltaX, false);
  }, [applyArenaResizeDelta]);

  const endNodeEditorLinkedLeftResize = useCallback(() => {
    linkedNodeEditorResizeRef.current = null;
  }, []);

  const collapseArenaToTab = useCallback(() => {
    onCollapseToTab?.({
      logicGateID: selectedLogicGate.id,
      label: selectedLogicGate.label || "Logic Gate Arena",
      nodeID: selectedLogicGate.nodeID,
    });
  }, [onCollapseToTab, selectedLogicGate.id, selectedLogicGate.label, selectedLogicGate.nodeID]);

  const openKanbanNode = useCallback((nodeID: string) => {
    if (!selectedLogicGate.id) return;
    onNodeOpen?.({ logicGateID: selectedLogicGate.id, label: selectedLogicGate.label || "Logic Gate", nodeID });
  }, [onNodeOpen, selectedLogicGate.id, selectedLogicGate.label]);

  const closeKanbanNode = useCallback(() => {
    if (!selectedLogicGate.id) return;
    onNodeClose?.({ logicGateID: selectedLogicGate.id, label: selectedLogicGate.label || "Logic Gate" });
  }, [onNodeClose, selectedLogicGate.id, selectedLogicGate.label]);

  if (!editorFrame || !kanbanFrame) {
    return (
      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#ffffff", color: "#111111", fontFamily: "var(--mango-font-family)", fontSize: 12 }}>
        Logic Gate Arena requires Editor and Kanban frames.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-frame-interactive="true"
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: `minmax(${MIN_EDITOR_WIDTH_PX}px, ${editorUnits}fr) ${SPLITTER_WIDTH_PX}px minmax(${MIN_KANBAN_WIDTH_PX}px, ${kanbanUnits}fr)`,
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <section style={{ position: "relative", zIndex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <React.Suspense fallback={arenaPanelFallback}>
          <LazyArenaEditorContent
            accent={editorFrame.accent}
            widgetId={editorFrame.id}
            theme={editorFrame.theme}
            forcedEntityKind="logic_gate"
            forcedEntityID={selectedLogicGate.id}
            forcedLabel={selectedLogicGate.label}
            forcedEmptyMessage={selectedLogicGate.emptyMessage}
            focusInformationID={selectedLogicGate.informationID}
            focusRequestID={selectedLogicGate.requestID}
            onLogicGateTitleChange={applyLogicGateTitle}
          />
        </React.Suspense>
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize Editor and Kanban board"
        onPointerDown={startResize}
        style={{ cursor: "col-resize", background: "transparent" }}
      />
      <section style={{ position: "relative", zIndex: 2, minWidth: 0, minHeight: 0, overflow: "visible" }}>
        <KanbanContent
          accent={kanbanFrame.accent}
          widgetId={kanbanFrame.id}
          theme={kanbanFrame.theme}
          arenaMode
          forcedLogicGateID={selectedLogicGate.id}
          forcedLogicGateLabel={selectedLogicGate.label}
          forcedHighlightedNodeID={selectedLogicGate.nodeID}
          forcedOpenNodeID={selectedLogicGate.nodeID}
          controlForcedOpenNode={!!targetLogicGate}
          onCollapseArenaToTab={onCollapseToTab ? collapseArenaToTab : undefined}
          onNodeEditorOverlayOpen={openKanbanNode}
          onNodeEditorOverlayClose={closeKanbanNode}
          arenaBoardLeftResizeRequest={kanbanBoardLeftResizeRequest}
          onNodeEditorOverlayLeftResizeStart={startNodeEditorLinkedLeftResize}
          onNodeEditorOverlayLeftResize={resizeArenaFromNodeEditorLeft}
          onNodeEditorOverlayLeftResizeEnd={endNodeEditorLinkedLeftResize}
        />
      </section>
    </div>
  );
};
