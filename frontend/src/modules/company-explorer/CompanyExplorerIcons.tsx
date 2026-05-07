import type React from "react";
import { KanbanBoardIcon } from "../kanban/KanbanBoardIcon";
import type { ExplorerTreeNode } from "./companyExplorerTypes";

const FolderSvg: React.FC<{ fill: string; tabFill: string; stroke: string; children?: React.ReactNode }> = ({ fill, tabFill, stroke, children }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <path d="M1.4 4.3h4.8l1.1 1.35h7.1v6.35a1.45 1.45 0 0 1-1.45 1.45H2.85A1.45 1.45 0 0 1 1.4 12z" fill={fill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
    <path d="M1.4 5.65V3.9c0-.8.65-1.45 1.45-1.45h3.1L7.2 4.3" fill={tabFill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
    {children}
  </svg>
);

const SpecialFolderIcon: React.FC = () => (
  <span aria-hidden="true" style={{ position: "relative", width: 17, height: 16, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
    <FolderSvg fill="#dff8ff" tabFill="#98efff" stroke="#0d7682" />
    <svg width="13" height="9" viewBox="0 0 26 18" style={{ position: "absolute", left: -1, top: -2, display: "block" }}>
      <rect x="1" y="1" width="24" height="16" rx="4" fill="#ffffff" stroke="#0d7682" strokeWidth="2" />
      <text x="13" y="12.4" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9" fontWeight="800" fill="#0d7682">f(x)</text>
    </svg>
  </span>
);

export const ExplorerRowIcon: React.FC<{ row: ExplorerTreeNode }> = ({ row }) => {
  if (row.systemFolderID) return <SpecialFolderIcon />;

  if (row.kind === "folder") {
    if (row.folderKind === "logic_gate") {
      return (
        <FolderSvg fill="#e8fff1" tabFill="#a5f3c2" stroke="#0c8f47">
          <path d="M5.1 8h2.2m2.05 0H11" fill="none" stroke="#0c8f47" strokeWidth="1" strokeLinecap="round" />
          <circle cx="8.35" cy="8" r="1.45" fill="#ffffff" stroke="#0c8f47" strokeWidth="1" />
        </FolderSvg>
      );
    }
    return (
      <FolderSvg fill="#fff0b8" tabFill="#ffd85a" stroke="#9d7412">
        <path d="M4.6 7.7h6.2M4.6 9.75h4.8" fill="none" stroke="#9d7412" strokeWidth="0.95" strokeLinecap="round" />
      </FolderSvg>
    );
  }
  if (row.kind === "node") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <path d="M3.7 1.7h5.45l3.15 3.15v9.45H3.7z" fill="#ffffff" stroke="#101010" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25" fill="none" stroke="#101010" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  if (row.kind === "kanban") {
    return <KanbanBoardIcon />;
  }
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      <path d="M1.4 5.25h3.05M1.4 10.75h3.05M11.7 8h2.9" fill="none" stroke="#0c8f47" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z" fill="#e8fff1" stroke="#0c8f47" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="4.35" cy="5.25" r="0.85" fill="#16b85f" />
      <circle cx="4.35" cy="10.75" r="0.85" fill="#16b85f" />
      <circle cx="12.15" cy="8" r="0.85" fill="#16b85f" />
    </svg>
  );
};

export const ExplorerDisclosureIcon: React.FC<{ open: boolean; color: string }> = ({ open, color }) => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
    <path
      d={open ? "M3.25 4.55 6 7.3l2.75-2.75" : "M4.55 3.25 7.3 6 4.55 8.75"}
      fill="none"
      stroke={color}
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
