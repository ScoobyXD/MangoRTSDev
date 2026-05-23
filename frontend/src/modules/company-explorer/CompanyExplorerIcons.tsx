import type React from "react";
import { KanbanBoardIcon } from "../kanban/KanbanBoardIcon";
import type { ExplorerTreeNode } from "./companyExplorerTypes";
import { EXPLORER_SYSTEM_FOLDER_COLOR } from "./treePresentation";

type ExplorerRowIconTone = "default" | "inverse" | "orange";

export const ExplorerRowIcon: React.FC<{
  kind: ExplorerTreeNode["kind"];
  systemKey?: ExplorerTreeNode["systemKey"];
  tone?: ExplorerRowIconTone;
}> = ({ kind, systemKey, tone = "default" }) => {
  const inverse = tone === "inverse";
  const orange = tone === "orange";
  if (kind === "folder") {
    const fill = inverse ? "rgba(255, 255, 255, 0.12)" : orange ? "rgba(255, 151, 8, 0.10)" : systemKey ? "rgba(71, 85, 105, 0.14)" : "#f8fafc";
    const tabFill = inverse ? "rgba(255, 255, 255, 0.22)" : orange ? "rgba(255, 151, 8, 0.18)" : systemKey ? "rgba(71, 85, 105, 0.28)" : "#e2e8f0";
    const stroke = inverse ? "#ffffff" : orange ? "#ff9708" : systemKey ? EXPLORER_SYSTEM_FOLDER_COLOR : "#64748b";
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <path d="M1.4 4.3h4.8l1.1 1.35h7.1v6.35a1.45 1.45 0 0 1-1.45 1.45H2.85A1.45 1.45 0 0 1 1.4 12z" fill={fill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
        <path d="M1.4 5.65V3.9c0-.8.65-1.45 1.45-1.45h3.1L7.2 4.3" fill={tabFill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "node") {
    const stroke = inverse ? "#ffffff" : orange ? "#ff9708" : "url(#mango-node-icon-blue)";
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        {!inverse && !orange && (
          <defs>
            <linearGradient id="mango-node-icon-blue" x1="8" y1="1.7" x2="8" y2="14.3" gradientUnits="userSpaceOnUse">
              <stop stopColor="#33ddd5" />
              <stop offset="1" stopColor="#19a8ff" />
            </linearGradient>
          </defs>
        )}
        <path d="M3.7 1.7h5.45l3.15 3.15v9.45H3.7z" fill="none" stroke={stroke} strokeWidth="1.35" strokeLinejoin="round" />
        <path d="M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25" fill="none" stroke={stroke} strokeWidth="1.05" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "kanban") {
    return <KanbanBoardIcon />;
  }
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id="mango-logic-gate-icon-green" x1="1.4" y1="3.55" x2="14.6" y2="12.45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7cff9b" />
          <stop offset="0.58" stopColor="#19f07a" />
          <stop offset="1" stopColor="#00c86f" />
        </linearGradient>
      </defs>
      <path d="M1.4 5.25h3.05M1.4 10.75h3.05M11.7 8h2.9" fill="none" stroke="url(#mango-logic-gate-icon-green)" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z" fill="none" stroke="url(#mango-logic-gate-icon-green)" strokeWidth="1.35" strokeLinejoin="round" />
      <circle cx="4.35" cy="5.25" r="0.85" fill="#19f07a" />
      <circle cx="4.35" cy="10.75" r="0.85" fill="#19f07a" />
      <circle cx="12.15" cy="8" r="0.85" fill="#19f07a" />
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
