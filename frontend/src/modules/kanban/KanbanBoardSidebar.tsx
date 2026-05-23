import { useEffect, useRef } from "react";
import type React from "react";
import {
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  getKanbanBoardDisplayTitle,
  type KanbanBoard,
} from "./shared";
import { KanbanBoardIcon } from "./KanbanBoardIcon";

type KanbanBoardGroup = {
  folderLabel: string;
  items: KanbanBoard[];
};

type KanbanBoardSidebarProps = {
  activeBoardTitle: string;
  boardID: string;
  boardTitleDraft: string;
  boardSearchQuery: string;
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
  onSetBoardTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  onSetBoardSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onSetEditingBoardTitle: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleAllBoards: () => void;
  onCloseAllBoards: () => void;
  onCommitBoardTitle: (title: string) => void;
  onRefreshBoards: () => void;
  onSaveCurrentBoardView: () => void;
  onCreateNewBoardView: () => void;
  onSelectBoard: (boardID: string) => void;
  onCollapseToTab?: () => void;
};

export const KanbanBoardSidebar: React.FC<KanbanBoardSidebarProps> = ({
  activeBoardTitle,
  boardID,
  boardTitleDraft,
  boardSearchQuery,
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
  onSetBoardTitleDraft,
  onSetBoardSearchQuery,
  onSetEditingBoardTitle,
  onToggleAllBoards,
  onCloseAllBoards,
  onCommitBoardTitle,
  onRefreshBoards,
  onSaveCurrentBoardView: _onSaveCurrentBoardView,
  onCreateNewBoardView: _onCreateNewBoardView,
  onSelectBoard,
  onCollapseToTab,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const boardPickerOpen = allBoardsOpen || boardSearchQuery.trim().length > 0;

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

  return (
  <>
    <div ref={headerRef} data-frame-interactive="true" style={{ position: "absolute", top: 4, left: 12, right: 12, display: "grid", gridTemplateColumns: onCollapseToTab ? "minmax(150px, 270px) minmax(140px, 1fr) auto 25px" : "minmax(150px, 270px) minmax(140px, 1fr) auto", alignItems: "center", gap: 8, paddingLeft: headerLeftPaddingPx, zIndex: 6, pointerEvents: "auto" }}>
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
          aria-label="Search Kanban boards"
          value={boardSearchQuery}
          onChange={(event) => onSetBoardSearchQuery(event.target.value)}
          placeholder="Search boards"
          style={{ width: "100%", height: "100%", boxSizing: "border-box", border: `1px solid ${line}`, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.92)", color: text, fontSize: 11, fontWeight: 500, padding: "0 28px 0 8px", outline: "none" }}
        />
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ position: "absolute", right: 8, top: 5, color: subtext, pointerEvents: "none" }}>
          <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </label>
      <button
        type="button"
        onClick={onToggleAllBoards}
        style={{ height: 25, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${allBoardsOpen ? accent : line}`, background: allBoardsOpen ? (isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)"), color: text, fontSize: 10, fontWeight: 500, letterSpacing: 0, padding: "0 9px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <span aria-hidden="true" style={{ width: 12, display: "grid", gap: 2 }}>
          <span style={{ height: 2, background: text }} />
          <span style={{ height: 2, background: text }} />
          <span style={{ height: 2, background: text }} />
        </span>
        All boards
      </button>
      {onCollapseToTab && (
        <button
          type="button"
          title="Collapse Logic Gate Arena to app tab"
          aria-label="Collapse Logic Gate Arena to app tab"
          onClick={onCollapseToTab}
          style={{ width: 25, height: 25, display: "grid", placeItems: "center", border: `1px solid ${line}`, borderRadius: 4, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.9)", color: text, padding: 0, cursor: "pointer" }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
            <rect x="2.3" y="3" width="11.4" height="7.6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.35" />
            <path d="M4.25 13h7.5M8 7.15v5.1M6.15 10.35 8 12.25l1.85-1.9" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
    {boardPickerOpen && (
      <section ref={popoverRef} data-frame-interactive="true" style={{ position: "absolute", top: topClearancePx + 2, right: 12, width: "min(360px, calc(100% - 24px))", maxHeight: "min(360px, calc(100% - 52px))", display: "grid", gridTemplateRows: "minmax(0, 1fr)", border: isDark ? "1px solid rgba(255,255,255,0.16)" : "1px solid #e0e0e0", borderRadius: 10, background: isDark ? "rgba(17,22,27,0.98)" : "#ffffff", boxShadow: isDark ? "0 12px 28px rgba(0,0,0,0.42)" : "0 6px 24px rgba(0,0,0,0.12)", padding: "4px 0", zIndex: 8, overflow: "hidden" }}>
        <div className="company-explorer-scroll" style={{ overflowY: "auto", overflowX: "hidden", minHeight: 0, ["--company-explorer-scroll-accent" as string]: theme === "light" ? "rgb(0, 233, 255)" : accent, ["--company-explorer-scroll-track" as string]: "transparent" }}>
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
                    style={{ width: "100%", display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", alignItems: "center", gap: 8, minHeight: 30, padding: "5px 12px 5px 24px", border: "none", background: selected ? (isDark ? "rgba(0,188,212,0.2)" : "rgba(0, 188, 212, 0.22)") : "transparent", color: text, cursor: "pointer", textAlign: "left" }}
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
