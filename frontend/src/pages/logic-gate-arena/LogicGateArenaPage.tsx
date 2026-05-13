import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameDataModel } from "../../types";
import { CompanyExplorerContent } from "../../modules/company-explorer";
import { EditorContent } from "../../modules/editor/EditorContent";
import { KanbanContent } from "../../modules/kanban/KanbanContent";
import { logicGateIDFromKanbanBoardID } from "../../modules/kanban/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../../modules/selectionCoordinator";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { consumePendingLogicGateArenaSelection } from "./logicGateArenaLaunch";

type LogicGateArenaPageProps = {
  frames: FrameDataModel[];
  updateFrames: (updater: (previous: FrameDataModel[]) => FrameDataModel[]) => void;
};

type ArenaResizeState = {
  splitter: "explorer-editor" | "editor-kanban";
  startX: number;
  containerWidth: number;
  explorerUnits: number;
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
const MIN_EXPLORER_WIDTH_PX = 230;
const MIN_EDITOR_WIDTH_PX = 300;
const MIN_KANBAN_WIDTH_PX = 340;

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function getArenaFrames(frames: FrameDataModel[]) {
  return {
    explorer: frames.find((frame) => frame.kind === "company-explorer") ?? null,
    editor: frames.find((frame) => frame.kind === "editor") ?? null,
    kanban: frames.find((frame) => frame.kind === "kanban") ?? null,
  };
}

export const LogicGateArenaPage: React.FC<LogicGateArenaPageProps> = ({ frames, updateFrames }) => {
  const companyID = getActiveCompanyID();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ArenaResizeState | null>(null);
  const lastArenaSelectionChangedAtRef = useRef(0);
  const [selectedLogicGate, setSelectedLogicGate] = useState<ArenaLogicGateSelection>({ id: "", label: "", emptyMessage: "" });

  const arenaFrames = useMemo(() => getArenaFrames(frames), [frames]);
  const explorerFrame = arenaFrames.explorer;
  const editorFrame = arenaFrames.editor;
  const kanbanFrame = arenaFrames.kanban;
  const explorerUnits = Math.max(1, explorerFrame?.w ?? 22);
  const editorUnits = Math.max(1, editorFrame?.w ?? 34);
  const kanbanUnits = Math.max(1, kanbanFrame?.w ?? 44);
  const explorerSelectionTargetFrameIDs = useMemo(() => (
    editorFrame?.id ? [editorFrame.id] : []
  ), [editorFrame?.id]);

  useEffect(() => {
    const pending = consumePendingLogicGateArenaSelection(companyID);
    if (!pending) return;
    lastArenaSelectionChangedAtRef.current = pending.createdAt;
    setSelectedLogicGate({ id: pending.logicGateID, label: pending.label, emptyMessage: "", nodeID: pending.nodeID });
  }, [companyID]);

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
    if (selection.entityKind === "node" && selection.sourceModule === "company-explorer" && selection.sourceFrameID === explorerFrame?.id) {
      lastArenaSelectionChangedAtRef.current = selection.changedAt || Date.now();
      setSelectedLogicGate({ id: "", label: "", emptyMessage: "Sorry, this editor can only display Logic Gates." });
      return;
    }
  }, [companyID, explorerFrame?.id]);

  useEffect(() => {
    if (!editorFrame?.id) return;
    const initialSelections = [explorerFrame?.id ?? "", editorFrame.id, kanbanFrame?.id ?? ""]
      .map((frameID) => frameID ? readLiveSelectionForFrame(companyID, frameID) : null)
      .filter((selection): selection is LiveSelectionChange => Boolean(selection))
      .sort((a, b) => a.changedAt - b.changedAt);
    for (const selection of initialSelections) applySelection(selection);
    const unsubscribeExplorer = explorerFrame?.id ? subscribeLiveSelection(explorerFrame.id, applySelection) : () => {};
    const unsubscribeEditor = subscribeLiveSelection(editorFrame.id, applySelection);
    const unsubscribeKanban = kanbanFrame?.id ? subscribeLiveSelection(kanbanFrame.id, applySelection) : () => {};
    return () => {
      unsubscribeExplorer();
      unsubscribeEditor();
      unsubscribeKanban();
    };
  }, [applySelection, companyID, editorFrame?.id, explorerFrame?.id, kanbanFrame?.id]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeRef.current;
      if (!state || !explorerFrame || !editorFrame || !kanbanFrame) return;
      event.preventDefault();
      const availableWidth = Math.max(1, state.containerWidth - SPLITTER_WIDTH_PX * 2);
      const totalUnits = state.explorerUnits + state.editorUnits + state.kanbanUnits;
      const deltaUnits = (event.clientX - state.startX) * (totalUnits / availableWidth);
      const minExplorer = totalUnits * (MIN_EXPLORER_WIDTH_PX / availableWidth);
      const minEditor = totalUnits * (MIN_EDITOR_WIDTH_PX / availableWidth);
      const minKanban = totalUnits * (MIN_KANBAN_WIDTH_PX / availableWidth);
      let nextExplorer = state.explorerUnits;
      let nextEditor = state.editorUnits;
      let nextKanban = state.kanbanUnits;

      if (state.splitter === "explorer-editor") {
        nextExplorer = clamp(state.explorerUnits + deltaUnits, minExplorer, totalUnits - minEditor - state.kanbanUnits);
        nextEditor = state.explorerUnits + state.editorUnits - nextExplorer;
      } else {
        nextEditor = clamp(state.editorUnits + deltaUnits, minEditor, totalUnits - state.explorerUnits - minKanban);
        nextKanban = state.editorUnits + state.kanbanUnits - nextEditor;
      }

      updateFrames((previous) => previous.map((frame) => {
        if (frame.id === explorerFrame.id) return { ...frame, x: 0, y: 0, w: nextExplorer, h: 1 };
        if (frame.id === editorFrame.id) return { ...frame, x: nextExplorer, y: 0, w: nextEditor, h: 1 };
        if (frame.id === kanbanFrame.id) return { ...frame, x: nextExplorer + nextEditor, y: 0, w: nextKanban, h: 1 };
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
  }, [explorerFrame, editorFrame, kanbanFrame, updateFrames]);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>, splitter: ArenaResizeState["splitter"]) => {
    if (!containerRef.current || !explorerFrame || !editorFrame || !kanbanFrame) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = containerRef.current.getBoundingClientRect();
    resizeRef.current = {
      splitter,
      startX: event.clientX,
      containerWidth: bounds.width,
      explorerUnits,
      editorUnits,
      kanbanUnits,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [editorFrame, editorUnits, explorerFrame, explorerUnits, kanbanFrame, kanbanUnits]);

  if (!explorerFrame || !editorFrame || !kanbanFrame) {
    return (
      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#ffffff", color: "#111111", fontFamily: "var(--mango-font-family)", fontSize: 12 }}>
        Logic Gate Arena requires Company Explorer, Editor, and Kanban frames.
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
        gridTemplateColumns: `minmax(${MIN_EXPLORER_WIDTH_PX}px, ${explorerUnits}fr) ${SPLITTER_WIDTH_PX}px minmax(${MIN_EDITOR_WIDTH_PX}px, ${editorUnits}fr) ${SPLITTER_WIDTH_PX}px minmax(${MIN_KANBAN_WIDTH_PX}px, ${kanbanUnits}fr)`,
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <CompanyExplorerContent
          accent={explorerFrame.accent}
          widgetId={explorerFrame.id}
          theme={explorerFrame.theme}
          selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
        />
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize Company Explorer and Editor"
        onPointerDown={(event) => startResize(event, "explorer-editor")}
        style={{ cursor: "col-resize", background: "transparent" }}
      />
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <EditorContent
          accent={editorFrame.accent}
          widgetId={editorFrame.id}
          theme={editorFrame.theme}
          forcedEntityKind="logic_gate"
          forcedEntityID={selectedLogicGate.id}
          forcedLabel={selectedLogicGate.label}
          forcedEmptyMessage={selectedLogicGate.emptyMessage}
        />
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize Editor and Kanban board"
        onPointerDown={(event) => startResize(event, "editor-kanban")}
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
        />
      </section>
    </div>
  );
};
