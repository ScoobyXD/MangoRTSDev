import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameDataModel } from "../../types";
import { KanbanContent } from "../../modules/kanban/KanbanContent";
import { logicGateIDFromKanbanBoardID } from "../../modules/kanban/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../../modules/selectionCoordinator";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { consumePendingLogicGateArenaSelection } from "./logicGateArenaLaunch";

type LogicGateArenaPageProps = {
  frames: FrameDataModel[];
  updateFrames: (updater: (previous: FrameDataModel[]) => FrameDataModel[]) => void;
  targetLogicGate?: {
    logicGateID: string;
    label: string;
    nodeID?: string;
    requestID?: number;
  } | null;
  onCollapseToTab?: (selection: { logicGateID: string; label: string; nodeID?: string }) => void;
};

type ArenaResizeState = {
  startX: number;
  containerWidth: number;
  editorUnits: number;
  kanbanUnits: number;
};

type ArenaLogicGateSelection = {
  id: string;
  label: string;
  emptyMessage: string;
  nodeID?: string;
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
  }>,
})));
const arenaPanelFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />;

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function getArenaFrames(frames: FrameDataModel[]) {
  return {
    editor: frames.find((frame) => frame.kind === "editor") ?? null,
    kanban: frames.find((frame) => frame.kind === "kanban") ?? null,
  };
}

export const LogicGateArenaPage: React.FC<LogicGateArenaPageProps> = ({ frames, updateFrames, targetLogicGate, onCollapseToTab }) => {
  const companyID = getActiveCompanyID();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ArenaResizeState | null>(null);
  const lastArenaSelectionChangedAtRef = useRef(0);
  const [selectedLogicGate, setSelectedLogicGate] = useState<ArenaLogicGateSelection>({ id: "", label: "", emptyMessage: "" });

  const arenaFrames = useMemo(() => getArenaFrames(frames), [frames]);
  const editorFrame = arenaFrames.editor;
  const kanbanFrame = arenaFrames.kanban;
  const editorUnits = Math.max(1, editorFrame?.w ?? 34);
  const kanbanUnits = Math.max(1, kanbanFrame?.w ?? 44);

  useEffect(() => {
    const pending = consumePendingLogicGateArenaSelection(companyID);
    if (!pending) return;
    lastArenaSelectionChangedAtRef.current = pending.createdAt;
    setSelectedLogicGate({ id: pending.logicGateID, label: pending.label, emptyMessage: "", nodeID: pending.nodeID });
  }, [companyID]);

  useEffect(() => {
    if (!targetLogicGate) return;
    const logicGateID = targetLogicGate.logicGateID.trim();
    lastArenaSelectionChangedAtRef.current = Date.now();
    setSelectedLogicGate({
      id: logicGateID,
      label: logicGateID ? targetLogicGate.label.trim() : "",
      emptyMessage: "",
      nodeID: targetLogicGate.nodeID,
    });
  }, [targetLogicGate?.logicGateID, targetLogicGate?.label, targetLogicGate?.nodeID, targetLogicGate?.requestID]);

  const applySelection = useCallback((selection: LiveSelectionChange | null) => {
    if (!selection || selection.companyID !== companyID) return;
    if (selection.changedAt > 0 && selection.changedAt < lastArenaSelectionChangedAtRef.current) return;
    if (selection.entityKind === "logic_gate") {
      lastArenaSelectionChangedAtRef.current = selection.changedAt || Date.now();
      setSelectedLogicGate({ id: selection.entityID.trim(), label: selection.label.trim(), emptyMessage: "" });
      return;
    }
    if (selection.entityKind === "kanban") {
      const logicGateID = logicGateIDFromKanbanBoardID(selection.entityID);
      lastArenaSelectionChangedAtRef.current = selection.changedAt || Date.now();
      setSelectedLogicGate({ id: logicGateID, label: logicGateID ? selection.label.trim() : "", emptyMessage: logicGateID ? "" : "Sorry, this editor can only display Logic Gates." });
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
      if (!state || !editorFrame || !kanbanFrame) return;
      event.preventDefault();
      const availableWidth = Math.max(1, state.containerWidth - SPLITTER_WIDTH_PX);
      const totalUnits = state.editorUnits + state.kanbanUnits;
      const deltaUnits = (event.clientX - state.startX) * (totalUnits / availableWidth);
      const minEditor = totalUnits * (MIN_EDITOR_WIDTH_PX / availableWidth);
      const minKanban = totalUnits * (MIN_KANBAN_WIDTH_PX / availableWidth);
      const nextEditor = clamp(state.editorUnits + deltaUnits, minEditor, totalUnits - minKanban);
      const nextKanban = state.editorUnits + state.kanbanUnits - nextEditor;

      updateFrames((previous) => previous.map((frame) => {
        if (frame.id === editorFrame.id) return { ...frame, x: 0, y: 0, w: nextEditor, h: 1 };
        if (frame.id === kanbanFrame.id) return { ...frame, x: nextEditor, y: 0, w: nextKanban, h: 1 };
        return frame;
      }));
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
  }, [editorFrame, kanbanFrame, updateFrames]);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || !editorFrame || !kanbanFrame) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = containerRef.current.getBoundingClientRect();
    resizeRef.current = {
      startX: event.clientX,
      containerWidth: bounds.width,
      editorUnits,
      kanbanUnits,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [editorFrame, editorUnits, kanbanFrame, kanbanUnits]);

  const collapseArenaToTab = useCallback(() => {
    onCollapseToTab?.({
      logicGateID: selectedLogicGate.id,
      label: selectedLogicGate.label || "Logic Gate Arena",
      nodeID: selectedLogicGate.nodeID,
    });
  }, [onCollapseToTab, selectedLogicGate.id, selectedLogicGate.label, selectedLogicGate.nodeID]);

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
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <React.Suspense fallback={arenaPanelFallback}>
          <LazyArenaEditorContent
            accent={editorFrame.accent}
            widgetId={editorFrame.id}
            theme={editorFrame.theme}
            forcedEntityKind="logic_gate"
            forcedEntityID={selectedLogicGate.id}
            forcedLabel={selectedLogicGate.label}
            forcedEmptyMessage={selectedLogicGate.emptyMessage}
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
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <KanbanContent
          accent={kanbanFrame.accent}
          widgetId={kanbanFrame.id}
          theme={kanbanFrame.theme}
          arenaMode
          forcedLogicGateID={selectedLogicGate.id}
          forcedLogicGateLabel={selectedLogicGate.label}
          forcedHighlightedNodeID={selectedLogicGate.nodeID}
          onCollapseArenaToTab={onCollapseToTab ? collapseArenaToTab : undefined}
        />
      </section>
    </div>
  );
};
