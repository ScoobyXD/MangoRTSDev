import React from "react";

export type NodeEditorPopupResizeHandle = {
  key: string;
  horizontal: -1 | 0 | 1;
  vertical: -1 | 0 | 1;
  cursor: string;
  style: React.CSSProperties;
};

export const NODE_EDITOR_POPUP_RESIZE_HANDLES: NodeEditorPopupResizeHandle[] = [
  { key: "nw", horizontal: -1, vertical: -1, cursor: "nwse-resize", style: { top: -6, left: -6, width: 12, height: 12 } },
  { key: "ne", horizontal: 1, vertical: -1, cursor: "nesw-resize", style: { top: -6, right: -6, width: 12, height: 12 } },
  { key: "sw", horizontal: -1, vertical: 1, cursor: "nesw-resize", style: { bottom: -6, left: -6, width: 12, height: 12 } },
  { key: "se", horizontal: 1, vertical: 1, cursor: "nwse-resize", style: { right: -6, bottom: -6, width: 12, height: 12 } },
  { key: "n", horizontal: 0, vertical: -1, cursor: "ns-resize", style: { top: -5, left: 18, right: 18, height: 10 } },
  { key: "s", horizontal: 0, vertical: 1, cursor: "ns-resize", style: { bottom: -5, left: 18, right: 18, height: 10 } },
  { key: "w", horizontal: -1, vertical: 0, cursor: "ew-resize", style: { left: -5, top: 18, bottom: 18, width: 10 } },
  { key: "e", horizontal: 1, vertical: 0, cursor: "ew-resize", style: { right: -5, top: 18, bottom: 18, width: 10 } },
];

export const MinimizeToLineIcon: React.FC = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" style={{ display: "block" }}>
    <path d="M3 10.5h8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" />
  </svg>
);
