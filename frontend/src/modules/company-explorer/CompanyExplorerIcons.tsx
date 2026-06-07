import React from "react";
import { KanbanBoardIcon } from "../kanban/KanbanBoardIcon";
import type { ExplorerTreeNode } from "./companyExplorerTypes";

type ExplorerRowIconTone = "default" | "inverse" | "orange";

export const ExplorerRowIcon: React.FC<{
  kind: ExplorerTreeNode["kind"];
  systemKey?: ExplorerTreeNode["systemKey"];
  mangoDefaultFolder?: boolean;
  tone?: ExplorerRowIconTone;
}> = ({ kind, systemKey, mangoDefaultFolder = false, tone = "default" }) => {
  const gradientBaseID = React.useId().replace(/:/g, "");
  const mangoFolderBodyGradientID = `mango-folder-body-${gradientBaseID}`;
  const mangoFolderTopGradientID = `mango-folder-top-${gradientBaseID}`;
  const mangoFolderStrokeGradientID = `mango-folder-stroke-${gradientBaseID}`;
  const inverse = tone === "inverse";
  const orange = tone === "orange";
  if (kind === "folder") {
    if ((mangoDefaultFolder || systemKey) && !inverse && !orange) {
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 1px 1px rgba(170, 60, 130, 0.24))" }}>
          <defs>
            <linearGradient id={mangoFolderBodyGradientID} x1="1.2" y1="3.3" x2="14.8" y2="13.7" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffd18a" />
              <stop offset="0.32" stopColor="#ff8bbd" />
              <stop offset="0.68" stopColor="#d946ef" />
              <stop offset="1" stopColor="#7c3aed" />
            </linearGradient>
            <linearGradient id={mangoFolderTopGradientID} x1="2" y1="3.2" x2="13.7" y2="7.3" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffe2aa" />
              <stop offset="0.42" stopColor="#ffa3c7" />
              <stop offset="1" stopColor="#c084fc" />
            </linearGradient>
            <linearGradient id={mangoFolderStrokeGradientID} x1="1.4" y1="4" x2="14.6" y2="13" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffb86b" />
              <stop offset="0.46" stopColor="#f43f9f" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <path d="M1.7 4.55c0-.83.67-1.5 1.5-1.5h3.45c.44 0 .85.19 1.13.52l.78.91h4.24c.83 0 1.5.67 1.5 1.5v.93H1.7z" fill={`url(#${mangoFolderTopGradientID})`} />
          <path d="M2.05 5.95h11.9c.64 0 1.12.57 1.01 1.2l-.86 5.12c-.12.72-.75 1.25-1.48 1.25H3.38c-.73 0-1.36-.53-1.48-1.25l-.86-5.12c-.11-.63.37-1.2 1.01-1.2z" fill={`url(#${mangoFolderBodyGradientID})`} />
          <path d="M2.15 6.08h11.7c.53 0 .93.48.84 1l-.15.87H1.46l-.15-.87c-.09-.52.31-1 .84-1z" fill="#ffd3a3" opacity="0.58" />
          <path d="M2.06 4.75c.06-.67.59-1.2 1.24-1.2h3.22c.31 0 .61.13.82.37l.79.9h4.62c.61 0 1.12.44 1.23 1.02H8.03l-.9-1.02c-.2-.23-.49-.36-.8-.36H3.2c-.46 0-.87.17-1.14.29z" fill="#ffe6ba" opacity="0.62" />
          <path d="M2.3 12.04c.16.57.68.98 1.29.98h8.82c.61 0 1.13-.41 1.29-.98l.42-2.53c-1.78 2.25-4.86 3.06-11.82 2.53z" fill="#7c3aed" opacity="0.22" />
          <path d="M2.32 6.26h11.36c.46 0 .81.41.73.86l-.84 4.98c-.09.53-.55.92-1.09.92H3.52c-.54 0-1-.39-1.09-.92l-.84-4.98c-.08-.45.27-.86.73-.86z" fill="none" stroke={`url(#${mangoFolderStrokeGradientID})`} strokeWidth="0.55" />
          <path d="M2.95 6.52h10.5" fill="none" stroke="rgba(255, 245, 225, 0.72)" strokeWidth="0.7" strokeLinecap="round" />
        </svg>
      );
    }
    if (inverse || orange) {
      const fill = inverse ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 151, 8, 0.10)";
      const tabFill = inverse ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 151, 8, 0.18)";
      const stroke = inverse ? "#ffffff" : "#ff9708";
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
          <path d="M1.4 4.3h4.8l1.1 1.35h7.1v6.35a1.45 1.45 0 0 1-1.45 1.45H2.85A1.45 1.45 0 0 1 1.4 12z" fill={fill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
          <path d="M1.4 5.65V3.9c0-.8.65-1.45 1.45-1.45h3.1L7.2 4.3" fill={tabFill} stroke={stroke} strokeWidth="1.15" strokeLinejoin="round" />
        </svg>
      );
    }
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 1px 1px rgba(180, 84, 0, 0.28))" }}>
        <path d="M1.7 4.55c0-.83.67-1.5 1.5-1.5h3.45c.44 0 .85.19 1.13.52l.78.91h4.24c.83 0 1.5.67 1.5 1.5v.93H1.7z" fill="#f28a13" />
        <path d="M2.05 5.95h11.9c.64 0 1.12.57 1.01 1.2l-.86 5.12c-.12.72-.75 1.25-1.48 1.25H3.38c-.73 0-1.36-.53-1.48-1.25l-.86-5.12c-.11-.63.37-1.2 1.01-1.2z" fill="#ff9f1a" />
        <path d="M2.15 6.08h11.7c.53 0 .93.48.84 1l-.15.87H1.46l-.15-.87c-.09-.52.31-1 .84-1z" fill="#ffb33a" opacity="0.96" />
        <path d="M2.06 4.75c.06-.67.59-1.2 1.24-1.2h3.22c.31 0 .61.13.82.37l.79.9h4.62c.61 0 1.12.44 1.23 1.02H8.03l-.9-1.02c-.2-.23-.49-.36-.8-.36H3.2c-.46 0-.87.17-1.14.29z" fill="#ffc45d" opacity="0.85" />
        <path d="M2.3 12.04c.16.57.68.98 1.29.98h8.82c.61 0 1.13-.41 1.29-.98l.42-2.53c-1.78 2.25-4.86 3.06-11.82 2.53z" fill="#f28b10" opacity="0.48" />
        <path d="M2.32 6.26h11.36c.46 0 .81.41.73.86l-.84 4.98c-.09.53-.55.92-1.09.92H3.52c-.54 0-1-.39-1.09-.92l-.84-4.98c-.08-.45.27-.86.73-.86z" fill="none" stroke="rgba(180, 84, 0, 0.34)" strokeWidth="0.55" />
        <path d="M2.95 6.52h10.5" fill="none" stroke="rgba(255, 235, 198, 0.75)" strokeWidth="0.7" strokeLinecap="round" />
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
