import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameDataModel } from "../../types";
import { CompanyExplorerContent } from "../../modules/company-explorer";
import { EditorContent } from "../../modules/editor/EditorContent";
import { KanbanContent } from "../../modules/kanban/KanbanContent";
import { logicGateIDFromKanbanBoardID } from "../../modules/kanban/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../../modules/selectionCoordinator";

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

const SPLITTER_WIDTH_PX = 7;
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
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ArenaResizeState | null>(null);
  const [selectedLogicGate, setSelectedLogicGate] = useState({ id: "", label: "" });

  const arenaFrames = useMemo(() => getArenaFrames(frames), [frames]);
  const explorerFrame = arenaFrames.explorer;
  const editorFrame = arenaFrames.editor;
  const kanbanFrame = arenaFrames.kanban;
  const explorerUnits = Math.max(1, explorerFrame?.w ?? 22);
  const editorUnits = Math.max(1, editorFrame?.w ?? 34);
  const kanbanUnits = Math.max(1, kanbanFrame?.w ?? 44);

  const applySelection = useCallback((selection: LiveSelectionChange | null) => {
    if (!selection || selection.companyID !== companyID) return;
    if (selection.entityKind === "logic_gate") {
      setSelectedLogicGate({ id: selection.entityID.trim(), label: selection.label.trim() });
      return;
    }
    if (selection.entityKind === "kanban") {
      const logicGateID = logicGateIDFromKanbanBoardID(selection.entityID);
      setSelectedLogicGate({ id: logicGateID, label: logicGateID ? selection.label.trim() : "" });
      return;
    }
    setSelectedLogicGate({ id: "", label: "" });
  }, [companyID]);

  useEffect(() => {
    if (!editorFrame?.id) return;
    applySelection(readLiveSelectionForFrame(companyID, editorFrame.id));
    return subscribeLiveSelection(editorFrame.id, applySelection);
  }, [applySelection, companyID, editorFrame?.id]);

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
      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#ffffff", color: "#111111", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
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
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden", borderRight: "1px solid rgba(17,17,17,0.34)" }}>
        <CompanyExplorerContent accent={explorerFrame.accent} widgetId={explorerFrame.id} theme={explorerFrame.theme} />
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize Company Explorer and Editor"
        onPointerDown={(event) => startResize(event, "explorer-editor")}
        style={{ cursor: "col-resize", background: "linear-gradient(90deg, rgba(17,17,17,0.16), rgba(17,17,17,0.42), rgba(17,17,17,0.16))" }}
      />
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden", borderRight: "1px solid rgba(17,17,17,0.34)" }}>
        <EditorContent
          accent={editorFrame.accent}
          widgetId={editorFrame.id}
          theme={editorFrame.theme}
          forcedEntityKind="logic_gate"
          forcedEntityID={selectedLogicGate.id}
          forcedLabel={selectedLogicGate.label}
        />
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize Editor and Kanban board"
        onPointerDown={(event) => startResize(event, "editor-kanban")}
        style={{ cursor: "col-resize", background: "linear-gradient(90deg, rgba(17,17,17,0.16), rgba(17,17,17,0.42), rgba(17,17,17,0.16))" }}
      />
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <KanbanContent accent={kanbanFrame.accent} widgetId={kanbanFrame.id} theme={kanbanFrame.theme} arenaMode />
      </section>
    </div>
  );
};
