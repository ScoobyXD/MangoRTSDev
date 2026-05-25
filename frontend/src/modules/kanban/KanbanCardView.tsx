import type React from "react";
import {
  getKanbanCardColorRailStyle,
  hexToRgba,
  type KanbanCard,
} from "./shared";

const NodeDocumentIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <path d="M4 1.75h5.25L12 4.5v9.75H4z" fill="none" stroke={color} strokeWidth="1.35" />
    <path d="M9.25 1.75V4.5H12M5.75 7.25h4.5M5.75 9.5h4.5M5.75 11.75h3" fill="none" stroke={color} strokeWidth="1.15" />
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
  cardBackground: string;
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
  cardBackground,
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
        border: `1px solid ${selected || highlighted ? color : hexToRgba(color, 0.58)}`,
        background: isIssue ? "#f1f5f9" : `linear-gradient(90deg, ${hexToRgba(color, 0.1)}, ${cardBackground} 42px)`,
        color: isIssue ? "#111111" : text,
        padding: "8px 9px 8px 13px",
        minHeight: 58,
        cursor: editingTitle ? "text" : "grab",
        outline: "none",
        overflow: "hidden",
        boxShadow: [
          selected ? `0 0 0 1px ${color}, 0 0 12px ${hexToRgba(color, 0.28)}, inset 0 0 0 1px ${hexToRgba(color, 0.16)}` : "",
          highlighted && !selected ? `0 0 0 1px ${color} inset, 0 0 10px ${hexToRgba(color, 0.22)}` : "",
          dragBefore ? `0 -3px 0 ${accent}` : "",
          dragAfter ? `0 3px 0 ${accent}` : "",
        ].filter(Boolean).join(", ") || undefined,
      }}
    >
      {/* The color rail is a separate layer so selection border changes cannot erase it. */}
      <span aria-hidden="true" style={getKanbanCardColorRailStyle(color)} />
      <div style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
        <span title="Node" style={{ width: 16, height: 16, marginTop: 1, display: "grid", placeItems: "center" }}>
          <NodeDocumentIcon color={color} />
        </span>
        {editingTitle ? (
          <input
            ref={renameInputRef}
            value={renameTitleDraft}
            onChange={(event) => onSetRenameTitleDraft(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                onCommitRenameTitle(event.currentTarget.value);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancelRenameTitle();
              }
            }}
            onBlur={(event) => onCommitRenameTitle(event.currentTarget.value)}
            style={{
              minWidth: 0,
              width: "100%",
              border: `1px solid ${accent}`,
              background: cardBackground,
              color: isIssue ? "#111111" : text,
              font: "inherit",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1.25,
              padding: "1px 4px",
              outline: "none",
            }}
          />
        ) : (
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.25, overflowWrap: "anywhere" }}>{card.node_title}</div>
        )}
      </div>
      {description && (
        <div style={{ marginTop: 7, color: isIssue ? "#334155" : subtext, fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
          {description}
        </div>
      )}
    </article>
  );
};
