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

export const OpenInNewTabIcon: React.FC = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" style={{ display: "block" }}>
    <path d="M5.2 3.2H3.6a1.4 1.4 0 0 0-1.4 1.4v5.8a1.4 1.4 0 0 0 1.4 1.4h5.8a1.4 1.4 0 0 0 1.4-1.4V8.8" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7.4 2.2h4.4v4.4M11.6 2.4 6.4 7.6" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
