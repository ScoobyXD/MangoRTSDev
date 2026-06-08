import type React from "react";
import {
  getKanbanCardColorRailStyle,
  hexToRgba,
  type KanbanCard,
} from "./shared";
import { KANBAN_EDGE_FRAME } from "./KanbanContentModel";

const NodeDocumentIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="19" height="19" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <path d="M4 1.75h5.25L12 4.5v9.75H4z" fill="rgba(255,255,255,0.58)" stroke={color} strokeWidth="1.45" />
    <path d="M9.25 1.75V4.5H12M5.75 7.25h4.5M5.75 9.5h4.5M5.75 11.75h3" fill="none" stroke={color} strokeWidth="1.18" />
  </svg>
);

type KanbanCardViewProps = {
  card: KanbanCard;
  color: string;
  highlighted: boolean;
  selected: boolean;
  dragBefore: boolean;
  dragAfter: boolean;
  line: string;
  text: string;
  subtext: string;
  accent: string;
  editingTitle: boolean;
  renameTitleDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onMouseDown: React.MouseEventHandler<HTMLElement>;
  onClick: React.MouseEventHandler<HTMLElement>;
  onDoubleClick: React.MouseEventHandler<HTMLElement>;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
  onSetRenameTitleDraft: (title: string) => void;
  onCommitRenameTitle: (title: string) => void;
  onCancelRenameTitle: () => void;
  onDragStart: React.DragEventHandler<HTMLElement>;
  onDragEnd: React.DragEventHandler<HTMLElement>;
  onDragOver: React.DragEventHandler<HTMLElement>;
  onDragLeave: React.DragEventHandler<HTMLElement>;
  onDrop: React.DragEventHandler<HTMLElement>;
};

export const KanbanCardView: React.FC<KanbanCardViewProps> = ({
  card,
  color,
  highlighted,
  selected,
  dragBefore,
  dragAfter,
  line: _line,
  text,
  subtext,
  accent,
  editingTitle,
  renameTitleDraft,
  renameInputRef,
  onMouseDown,
  onClick,
  onDoubleClick,
  onContextMenu,
  onSetRenameTitleDraft,
  onCommitRenameTitle,
  onCancelRenameTitle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const description = (card.description_snapshot ?? "").trim();
  const isIssue = card.is_issue === true;
  const cardFrame = `linear-gradient(135deg, ${hexToRgba(color, selected || highlighted ? 0.88 : 0.62)}, rgba(255,255,255,0.84) 72%)`;
  const accounts = (card.accounts ?? []).filter((account) => account.account_id.trim()).slice(0, 4);

  return (
    <article
      draggable={!editingTitle}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "relative",
        display: "block",
        gridColumn: "auto",
        gridRow: "auto",
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid transparent",
        borderRadius: 11,
        background: isIssue
          ? `linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,241,242,0.74) 48%, rgba(254,249,195,0.60)) padding-box, ${KANBAN_EDGE_FRAME} border-box`
          : `linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,255,255,0.94) 42%, ${hexToRgba(color, 0.09)} 100%) padding-box, ${cardFrame} border-box`,
        color: isIssue ? "#111111" : text,
        padding: "9px 10px 9px 15px",
        minHeight: 60,
        cursor: editingTitle ? "text" : "grab",
        outline: "none",
        overflow: "hidden",
        boxShadow: [
          `4px 4px 12px rgba(174, 174, 192, 0.18), -4px -4px 12px rgba(255, 255, 255, 0.84), 0 8px 18px ${hexToRgba(color, 0.10)}, inset 1px 1px 0 rgba(255,255,255,0.88)`,
          selected ? `0 0 0 1px ${color}, 0 0 12px ${hexToRgba(color, 0.28)}, inset 0 0 0 1px ${hexToRgba(color, 0.16)}` : "",
          highlighted && !selected ? `0 0 0 1px ${color} inset, 0 0 10px ${hexToRgba(color, 0.22)}` : "",
          dragBefore ? `0 -3px 0 ${accent}` : "",
          dragAfter ? `0 3px 0 ${accent}` : "",
        ].filter(Boolean).join(", ") || undefined,
        transition: "box-shadow 150ms ease, transform 150ms ease, background 150ms ease",
      }}
      >
      {/* The color rail is a separate layer so selection border changes cannot erase it. */}
      <span aria-hidden="true" style={getKanbanCardColorRailStyle(color)} />
      <div style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr)", gap: 7, alignItems: "start" }}>
        <span title="Node" style={{ width: 20, height: 20, marginTop: 0, display: "grid", placeItems: "center" }}>
          <NodeDocumentIcon color={color} />
        </span>
        {editingTitle ? (
          <input
            ref={renameInputRef}
            value={renameTitleDraft}
            onChange={(event) => onSetRenameTitleDraft(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.currentTarget.select();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                onCommitRenameTitle(event.currentTarget.value);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRenameTitle();
                return;
              }
            }}
            onBlur={(event) => onCommitRenameTitle(event.currentTarget.value)}
            style={{
              minWidth: 0,
              width: "100%",
              border: "none",
              background: "transparent",
              color: isIssue ? "#334155" : subtext,
              caretColor: isIssue ? "#111111" : text,
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.25,
              padding: 0,
              outline: "none",
              boxShadow: "none",
              appearance: "none",
            }}
          />
        ) : (
          <div style={{ fontSize: 12, fontWeight: 760, lineHeight: 1.25, overflowWrap: "anywhere" }}>{card.node_title}</div>
        )}
      </div>
      {description && (
        <div style={{ marginTop: 7, color: isIssue ? "#334155" : subtext, fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
          {description}
        </div>
      )}
      {accounts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {accounts.map((account) => (
            <span key={account.account_id} title={account.name || account.account_id} style={{
              maxWidth: "100%",
              border: `1px solid ${hexToRgba(color, 0.22)}`,
              borderRadius: 7,
              background: `linear-gradient(135deg, rgba(255,255,255,0.92), ${hexToRgba(color, 0.10)})`,
              color: isIssue ? "#334155" : subtext,
              fontSize: 9.5,
              fontWeight: 820,
              lineHeight: 1.2,
              padding: "2px 6px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {account.name || account.account_id}
            </span>
          ))}
        </div>
      )}
    </article>
  );
};
