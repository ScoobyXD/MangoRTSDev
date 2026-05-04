import type React from "react";
import {
  KANBAN_MODULE_TOP_CLEARANCE_PX,
  getKanbanBoardDisplayTitle,
  type KanbanBoard,
} from "./shared";

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
  theme: "teal" | "light" | "dark";
  editingBoardTitle: boolean;
  onSetBoardTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  onSetBoardSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onSetEditingBoardTitle: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleAllBoards: () => void;
  onCommitBoardTitle: (title: string) => void;
  onRefreshBoards: () => void;
  onSaveCurrentBoardView: () => void;
  onCreateNewBoardView: () => void;
  onSelectBoard: (boardID: string) => void;
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
  onSetBoardTitleDraft,
  onSetBoardSearchQuery,
  onSetEditingBoardTitle,
  onToggleAllBoards,
  onCommitBoardTitle,
  onRefreshBoards,
  onSaveCurrentBoardView,
  onCreateNewBoardView,
  onSelectBoard,
}) => (
  <>
    <div style={{ position: "absolute", top: 4, left: 8, right: 12, display: "grid", gridTemplateColumns: "minmax(120px, 240px) minmax(140px, 1fr) auto", alignItems: "center", gap: 8, paddingLeft: 106, zIndex: 3, pointerEvents: "auto" }}>
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
          style={{ minWidth: 0, height: 25, border: `1px solid ${accent}`, background: isDark ? "#11161b" : "#ffffff", color: text, fontSize: 12, fontWeight: 800, padding: "0 7px", outline: "none" }}
        />
      ) : (
        <button
          type="button"
          title="Rename Kanban board"
          onClick={() => {
            onSetBoardTitleDraft(activeBoardTitle);
            onSetEditingBoardTitle(true);
          }}
          style={{ minWidth: 0, height: 25, border: `1px solid ${line}`, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)", color: text, cursor: "text", fontSize: 12, fontWeight: 800, textAlign: "left", padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
          style={{ width: "100%", height: "100%", boxSizing: "border-box", border: `1px solid ${line}`, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.92)", color: text, fontSize: 11, fontWeight: 700, padding: "0 28px 0 8px", outline: "none" }}
        />
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ position: "absolute", right: 8, top: 5, color: subtext, pointerEvents: "none" }}>
          <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </label>
      <button
        type="button"
        onClick={onToggleAllBoards}
        style={{ height: 25, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${allBoardsOpen ? accent : line}`, background: allBoardsOpen ? (isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)"), color: text, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 9px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <span aria-hidden="true" style={{ width: 12, display: "grid", gap: 2 }}>
          <span style={{ height: 2, background: text }} />
          <span style={{ height: 2, background: text }} />
          <span style={{ height: 2, background: text }} />
        </span>
        All Boards
      </button>
    </div>
    {allBoardsOpen && (
      <section style={{ position: "absolute", top: KANBAN_MODULE_TOP_CLEARANCE_PX + 8, left: 114, width: "min(430px, calc(100% - 126px))", maxHeight: "calc(100% - 58px)", display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", border: `1px solid ${line}`, background: isDark ? "rgba(17,22,27,0.98)" : "rgba(255,255,255,0.98)", boxShadow: isDark ? "0 14px 30px rgba(0,0,0,0.36)" : "0 14px 30px rgba(16,24,40,0.16)", zIndex: 4 }}>
        <div style={{ padding: "9px 10px", borderBottom: `1px solid ${line}`, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>
          Saved Kanban Boards
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8, borderBottom: `1px solid ${line}` }}>
          <button type="button" onClick={onSaveCurrentBoardView} style={{ border: `1px solid ${accent}`, background: "transparent", color: text, cursor: "pointer", fontSize: 11, fontWeight: 800, padding: "6px 8px" }}>
            Save current
          </button>
          <button type="button" onClick={onCreateNewBoardView} style={{ border: `1px solid ${accent}`, background: "transparent", color: text, cursor: "pointer", fontSize: 11, fontWeight: 800, padding: "6px 8px" }}>
            New board
          </button>
        </div>
        <div className="company-explorer-scroll" style={{ overflowY: "auto", overflowX: "hidden", minHeight: 0, ["--company-explorer-scroll-accent" as string]: theme === "light" ? "rgb(0, 233, 255)" : accent, ["--company-explorer-scroll-track" as string]: isDark ? "rgba(255,255,255,0.08)" : "rgba(0, 233, 255, 0.08)" }}>
          {boardsLoading && <div style={{ padding: "8px 10px", color: subtext, fontSize: 11 }}>Loading boards...</div>}
          {!boardsLoading && filteredBoardRowsLength === 0 && <div style={{ padding: "8px 10px", color: subtext, fontSize: 11 }}>No saved boards</div>}
          {filteredBoardGroups.map((group) => (
            <div key={group.folderLabel}>
              <div style={{ padding: "7px 10px 4px", color: subtext, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
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
                    style={{ width: "100%", display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", alignItems: "center", gap: 7, minHeight: 32, padding: "5px 9px 5px 18px", border: "none", borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(3,25,30,0.06)"}`, background: selected ? (isDark ? "rgba(0,233,255,0.2)" : "rgba(0, 233, 255, 0.28)") : "transparent", color: text, cursor: "pointer", textAlign: "left" }}
                  >
                    <span aria-hidden="true" style={{ width: 14, height: 14, border: `1px solid ${accent}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, padding: 2 }}>
                      <span style={{ background: accent, opacity: 0.8 }} />
                      <span style={{ background: subtext, opacity: 0.55 }} />
                      <span style={{ background: accent, opacity: 0.45 }} />
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 800 : 700 }}>
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
