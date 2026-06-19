import { useEffect, useRef } from "react";
import type React from "react";
import { MinimizeToLineIcon, OpenInNewTabIcon } from "../../app/nodeEditorPopupControls";
import { EXPLORER_DRAG_MIME } from "../company-explorer/companyExplorerDragDrop";
import {
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  getKanbanBoardDisplayTitle,
  type KanbanBoard,
} from "./shared";
import { KanbanBoardIcon } from "./KanbanBoardIcon";
import {
  contextMenuHoverHandlers,
  KANBAN_ACTIVE_SURFACE,
  KANBAN_EDGE_FRAME,
  KANBAN_PANEL_BACKGROUND,
  KANBAN_PANEL_SHADOW,
  KANBAN_SHADOW,
  KANBAN_SOFT_BORDER,
  KANBAN_SURFACE,
} from "./KanbanContentModel";

type KanbanBoardGroup = {
  folderLabel: string;
  items: KanbanBoard[];
};

type KanbanBoardSidebarProps = {
  activeBoardTitle: string;
  boardID: string;
  boardTitleDraft: string;
  contentSearchQuery: string;
  contentSearchPlaceholder: string;
  allBoardsOpen: boolean;
  boardsLoading: boolean;
  filteredBoardRowsLength: number;
  filteredBoardGroups: KanbanBoardGroup[];
  accent: string;
  line: string;
  text: string;
  subtext: string;
  isDark: boolean;
  theme: "mango" | "teal" | "light" | "dark";
  editingBoardTitle: boolean;
  boardTitleReadOnly?: boolean;
  headerLeftPaddingPx?: number;
  topClearancePx?: number;
  compactArenaHeader?: boolean;
  onSetBoardTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  onSetContentSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onSetEditingBoardTitle: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleAllBoards: () => void;
  onCloseAllBoards: () => void;
  onCommitBoardTitle: (title: string) => void;
  onRefreshBoards: () => void;
  onSaveCurrentBoardView: () => void;
  onCreateNewBoardView: () => void;
  onSelectBoard: (boardID: string) => void;
  onCollapseToTab?: () => void;
  onOpenInNewTab?: () => void;
  timelineDragEntity?: { kind: "logic_gate"; id: string; label: string };
};

export const KanbanBoardSidebar: React.FC<KanbanBoardSidebarProps> = ({
  activeBoardTitle,
  boardID,
  boardTitleDraft,
  contentSearchQuery,
  contentSearchPlaceholder,
  allBoardsOpen,
  boardsLoading,
  filteredBoardRowsLength,
  filteredBoardGroups,
  accent,
  line,
  text,
  subtext,
  isDark,
  theme,
  editingBoardTitle,
  boardTitleReadOnly = false,
  headerLeftPaddingPx = 162,
  topClearancePx = KANBAN_MODULE_TOP_CLEARANCE_PX,
  compactArenaHeader = false,
  onSetBoardTitleDraft,
  onSetContentSearchQuery,
  onSetEditingBoardTitle,
  onToggleAllBoards,
  onCloseAllBoards,
  onCommitBoardTitle,
  onRefreshBoards,
  onSaveCurrentBoardView: _onSaveCurrentBoardView,
  onCreateNewBoardView: _onCreateNewBoardView,
  onSelectBoard,
  onCollapseToTab,
  onOpenInNewTab,
  timelineDragEntity,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const boardPickerOpen = allBoardsOpen;

  useEffect(() => {
    if (!boardPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (headerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onCloseAllBoards();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseAllBoards();
    };
    const timer = window.setTimeout(() => window.addEventListener("mousedown", onPointerDown, true), 0);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [boardPickerOpen, onCloseAllBoards]);

  const headerActionCount = (onOpenInNewTab ? 1 : 0) + (onCollapseToTab ? 1 : 0);
  const headerGridTemplateColumns = headerActionCount > 0
    ? `minmax(150px, 270px) minmax(140px, 1fr) auto repeat(${headerActionCount}, 25px)`
    : "minmax(150px, 270px) minmax(140px, 1fr) auto";
  const headerButtonStyle = compactHeaderButtonStyle(isDark, line, text);

  if (compactArenaHeader) {
    return onCollapseToTab || onOpenInNewTab ? (
      <div ref={headerRef} data-frame-interactive="true" style={{ position: "absolute", top: 4, right: 10, zIndex: 32, display: "flex", alignItems: "center", gap: 6, pointerEvents: "auto" }}>
        {onOpenInNewTab && (
          <button
            className="mango-elevated-action"
            type="button"
            title="Open Logic Gate in new browser tab"
            aria-label="Open Logic Gate in new browser tab"
            data-frame-interactive="true"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onOpenInNewTab}
            style={headerButtonStyle}
          >
            <OpenInNewTabIcon />
          </button>
        )}
        {onCollapseToTab && (
          <button
            className="mango-elevated-action"
            type="button"
            title="Minimize Logic Gate Arena to app tab"
            aria-label="Minimize Logic Gate Arena to app tab"
            data-frame-interactive="true"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onCollapseToTab}
            style={headerButtonStyle}
          >
            <MinimizeToLineIcon />
          </button>
        )}
      </div>
    ) : null;
  }

  return (
  <>
    <div ref={headerRef} data-frame-interactive="true" style={{ position: "absolute", top: 3, left: 10, right: 10, display: "grid", gridTemplateColumns: headerGridTemplateColumns, alignItems: "center", gap: 8, padding: `3px 6px 3px ${Math.max(6, headerLeftPaddingPx)}px`, zIndex: 32, pointerEvents: "auto", border: isDark ? `1px solid ${line}` : `1px solid ${KANBAN_SOFT_BORDER}`, borderRadius: 12, background: isDark ? "rgba(17,22,27,0.82)" : "linear-gradient(90deg, rgba(255,241,242,0.70), rgba(254,249,195,0.46) 34%, rgba(236,253,245,0.50) 66%, rgba(239,246,255,0.70))", boxShadow: isDark ? "none" : "0 10px 24px rgba(15, 23, 42, 0.08), inset 1px 1px 0 rgba(255,255,255,0.88)" }}>
      {editingBoardTitle ? (
        <input
          value={boardTitleDraft}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onSetBoardTitleDraft(event.target.value)}
          onBlur={(event) => onCommitBoardTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              onSetEditingBoardTitle(false);
              onRefreshBoards();
            }
          }}
          style={{ minWidth: 0, height: 25, border: "none", borderBottom: `1px solid ${accent}`, background: "transparent", color: text, fontSize: 14, fontWeight: 500, padding: "0 2px", outline: "none" }}
        />
      ) : (
        <button
          type="button"
          title={boardTitleReadOnly ? activeBoardTitle : "Rename Kanban board"}
          draggable={!!timelineDragEntity}
          onDragStart={(event) => {
            if (!timelineDragEntity) return;
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify({
              kind: timelineDragEntity.kind,
              itemID: timelineDragEntity.id,
              itemType: timelineDragEntity.kind,
              sourceTreeID: `logic-gate-${timelineDragEntity.id}`,
            }));
            event.dataTransfer.setData("text/plain", timelineDragEntity.label);
          }}
          onClick={() => {
            if (boardTitleReadOnly) return;
            onSetBoardTitleDraft(activeBoardTitle);
            onSetEditingBoardTitle(true);
          }}
          style={{ minWidth: 0, height: 25, border: "none", background: "transparent", color: text, cursor: boardTitleReadOnly ? "default" : "text", fontSize: 14, fontWeight: 500, textAlign: "left", padding: "0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {activeBoardTitle}
        </button>
      )}
      <label style={{ position: "relative", minWidth: 0, height: 25, display: "block" }}>
        <input
          aria-label="Search current Kanban content"
          value={contentSearchQuery}
          onChange={(event) => onSetContentSearchQuery(event.target.value)}
          placeholder={contentSearchPlaceholder}
          style={{ width: "100%", height: "100%", boxSizing: "border-box", border: isDark ? `1px solid ${line}` : `1px solid ${KANBAN_SOFT_BORDER}`, borderRadius: 8, background: isDark ? "rgba(255,255,255,0.08)" : KANBAN_ACTIVE_SURFACE, color: text, fontSize: 11, fontWeight: 600, padding: "0 28px 0 8px", outline: "none", boxShadow: isDark ? "none" : "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
        />
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ position: "absolute", right: 8, top: 5, color: subtext, pointerEvents: "none" }}>
          <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </label>
      <button
        className="mango-elevated-action"
        type="button"
        onClick={onToggleAllBoards}
        style={{ height: 25, display: "flex", alignItems: "center", gap: 6, border: allBoardsOpen && !isDark ? "1px solid transparent" : `1px solid ${allBoardsOpen ? accent : (isDark ? line : KANBAN_SOFT_BORDER)}`, background: allBoardsOpen && !isDark ? `${KANBAN_ACTIVE_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box` : (isDark ? (allBoardsOpen ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)") : KANBAN_SURFACE), color: text, fontSize: 10, fontWeight: 700, letterSpacing: 0, padding: "0 9px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", boxShadow: isDark ? "none" : KANBAN_SHADOW }}
      >
        <span aria-hidden="true" style={{ width: 12, display: "grid", gap: 2 }}>
          <span style={{ height: 2, background: text }} />
          <span style={{ height: 2, background: text }} />
          <span style={{ height: 2, background: text }} />
        </span>
        All boards
      </button>
      {onOpenInNewTab && (
        <button
          className="mango-elevated-action"
          type="button"
          title="Open Logic Gate in new browser tab"
          aria-label="Open Logic Gate in new browser tab"
          data-frame-interactive="true"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onOpenInNewTab}
          style={headerButtonStyle}
        >
          <OpenInNewTabIcon />
        </button>
      )}
      {onCollapseToTab && (
        <button
          className="mango-elevated-action"
          type="button"
          title="Minimize Logic Gate Arena to app tab"
          aria-label="Minimize Logic Gate Arena to app tab"
          data-frame-interactive="true"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onCollapseToTab}
          style={headerButtonStyle}
        >
          <MinimizeToLineIcon />
        </button>
      )}
    </div>
    {boardPickerOpen && (
      <section ref={popoverRef} data-frame-interactive="true" style={{ position: "absolute", top: topClearancePx + 2, right: 12, width: "min(360px, calc(100% - 24px))", maxHeight: "min(360px, calc(100% - 52px))", display: "grid", gridTemplateRows: "minmax(0, 1fr)", border: isDark ? "1px solid rgba(255,255,255,0.16)" : `1px solid ${KANBAN_SOFT_BORDER}`, borderRadius: 14, background: isDark ? "rgba(17,22,27,0.98)" : KANBAN_PANEL_BACKGROUND, boxShadow: isDark ? "0 12px 28px rgba(0,0,0,0.42)" : KANBAN_PANEL_SHADOW, padding: "5px 0", zIndex: 34, overflow: "hidden" }}>
        <div className="company-explorer-scroll" style={{ overflowY: "auto", overflowX: "hidden", minHeight: 0, ["--company-explorer-scroll-accent" as string]: theme === "light" ? "rgb(71, 85, 105)" : accent, ["--company-explorer-scroll-track" as string]: "transparent" }}>
          {!boardsLoading && filteredBoardRowsLength === 0 && <div style={{ padding: "8px 10px", color: subtext, fontSize: 11 }}>No saved boards</div>}
          {filteredBoardGroups.map((group) => (
            <div key={group.folderLabel}>
              <div style={{ padding: "8px 12px 4px", color: subtext, fontSize: 10, fontWeight: 500, letterSpacing: 0 }}>
                {group.folderLabel}
              </div>
              {group.items.map((board) => {
                const selected = board.board_id === boardID;
                return (
                  <button
                    key={board.board_id}
                    type="button"
                    title={board.board_id}
                    onClick={() => onSelectBoard(board.board_id)}
                    style={{ width: "calc(100% - 10px)", margin: "2px 5px", display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", alignItems: "center", gap: 8, minHeight: 30, padding: "5px 12px 5px 19px", border: "1px solid transparent", borderRadius: 10, background: selected ? (isDark ? "rgba(100,116,139,0.2)" : `${KANBAN_ACTIVE_SURFACE} padding-box, ${KANBAN_EDGE_FRAME} border-box`) : "transparent", color: text, cursor: "pointer", textAlign: "left", boxShadow: selected && !isDark ? "0 9px 24px rgba(15, 23, 42, 0.12), 0 0 14px rgba(183, 124, 255, 0.18), inset 1px 1px 0 rgba(255,255,255,0.86)" : undefined, transition: "background 150ms ease, border-color 150ms ease, box-shadow 170ms ease, transform 170ms ease" }}
                    {...(!selected ? contextMenuHoverHandlers : {})}
                  >
                    <KanbanBoardIcon />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 600 : 500 }}>
                      {getKanbanBoardDisplayTitle(board)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    )}
  </>
  );
};

function compactHeaderButtonStyle(isDark: boolean, line: string, text: string): React.CSSProperties {
  return {
    width: 25,
    height: 25,
    position: "relative",
    zIndex: 33,
    display: "grid",
    placeItems: "center",
    border: isDark ? `1px solid ${line}` : `1px solid ${KANBAN_SOFT_BORDER}`,
    borderRadius: 8,
    background: isDark ? "rgba(255,255,255,0.08)" : KANBAN_SURFACE,
    color: text,
    padding: 0,
    cursor: "pointer",
    boxShadow: isDark ? "none" : KANBAN_SHADOW,
  };
}
