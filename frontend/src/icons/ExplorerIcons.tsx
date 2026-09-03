import React from "react";
import { ExplorerEntityIcon } from "./EntityIcons.js";
import type { ExplorerTreeNode } from "../modules/company-explorer/companyExplorerTypes.js";

type ExplorerRowIconTone = "default" | "inverse" | "orange";

export const ExplorerRowIcon: React.FC<{
  kind: ExplorerTreeNode["kind"] | "entity";
  systemKey?: ExplorerTreeNode["systemKey"];
  mangoDefaultFolder?: boolean;
  tone?: ExplorerRowIconTone;
}> = ({ kind, systemKey, mangoDefaultFolder = false, tone = "default" }) => {
  const gradientBaseID = React.useId().replace(/:/g, "");
  const mangoFolderBodyGradientID = `mango-folder-body-${gradientBaseID}`;
  const mangoFolderTopGradientID = `mango-folder-top-${gradientBaseID}`;
  const mangoFolderStrokeGradientID = `mango-folder-stroke-${gradientBaseID}`;
  const folderBodyGradientID = `folder-body-${gradientBaseID}`;
  const folderTopGradientID = `folder-top-${gradientBaseID}`;
  const folderStrokeGradientID = `folder-stroke-${gradientBaseID}`;
  const inverse = tone === "inverse";
  const orange = tone === "orange";
  if (kind === "folder") {
    if ((mangoDefaultFolder || systemKey) && !inverse && !orange) {
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 1px 1px rgba(0, 233, 255, 0.22))" }}>
          <defs>
            <linearGradient id={mangoFolderBodyGradientID} x1="1.2" y1="3.3" x2="14.8" y2="13.7" gradientUnits="userSpaceOnUse">
              <stop stopColor="#eaffff" />
              <stop offset="0.34" stopColor="#9bf8ff" />
              <stop offset="0.68" stopColor="#00e9ff" />
              <stop offset="1" stopColor="#0fb7cf" />
            </linearGradient>
            <linearGradient id={mangoFolderTopGradientID} x1="2" y1="3.2" x2="13.7" y2="7.3" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f4ffff" />
              <stop offset="0.46" stopColor="#b9fbff" />
              <stop offset="1" stopColor="#61f2ff" />
            </linearGradient>
            <linearGradient id={mangoFolderStrokeGradientID} x1="1.4" y1="4" x2="14.6" y2="13" gradientUnits="userSpaceOnUse">
              <stop stopColor="#82f7ff" />
              <stop offset="0.5" stopColor="#00e9ff" />
              <stop offset="1" stopColor="#0ea5b7" />
            </linearGradient>
          </defs>
          <path d="M1.7 4.55c0-.83.67-1.5 1.5-1.5h3.45c.44 0 .85.19 1.13.52l.78.91h4.24c.83 0 1.5.67 1.5 1.5v.93H1.7z" fill={`url(#${mangoFolderTopGradientID})`} />
          <path d="M2.05 5.95h11.9c.64 0 1.12.57 1.01 1.2l-.86 5.12c-.12.72-.75 1.25-1.48 1.25H3.38c-.73 0-1.36-.53-1.48-1.25l-.86-5.12c-.11-.63.37-1.2 1.01-1.2z" fill={`url(#${mangoFolderBodyGradientID})`} />
          <path d="M2.15 6.08h11.7c.53 0 .93.48.84 1l-.15.87H1.46l-.15-.87c-.09-.52.31-1 .84-1z" fill="#d9feff" opacity="0.68" />
          <path d="M2.06 4.75c.06-.67.59-1.2 1.24-1.2h3.22c.31 0 .61.13.82.37l.79.9h4.62c.61 0 1.12.44 1.23 1.02H8.03l-.9-1.02c-.2-.23-.49-.36-.8-.36H3.2c-.46 0-.87.17-1.14.29z" fill="#f5ffff" opacity="0.72" />
          <path d="M2.3 12.04c.16.57.68.98 1.29.98h8.82c.61 0 1.13-.41 1.29-.98l.42-2.53c-1.78 2.25-4.86 3.06-11.82 2.53z" fill="#008aa0" opacity="0.18" />
          <path d="M2.32 6.26h11.36c.46 0 .81.41.73.86l-.84 4.98c-.09.53-.55.92-1.09.92H3.52c-.54 0-1-.39-1.09-.92l-.84-4.98c-.08-.45.27-.86.73-.86z" fill="none" stroke={`url(#${mangoFolderStrokeGradientID})`} strokeWidth="0.55" />
          <path d="M2.95 6.52h10.5" fill="none" stroke="rgba(244, 255, 255, 0.8)" strokeWidth="0.7" strokeLinecap="round" />
        </svg>
      );
    }
    if (inverse || orange) {
      const fill = inverse ? "rgba(255, 255, 255, 0.12)" : `url(#${folderBodyGradientID})`;
      const tabFill = inverse ? "rgba(255, 255, 255, 0.22)" : `url(#${folderTopGradientID})`;
      const edge = inverse ? "#ffffff" : `url(#${folderStrokeGradientID})`;
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0, filter: orange ? "drop-shadow(0 1px 1px rgba(255, 90, 31, 0.20))" : undefined }}>
          {orange && (
            <defs>
              <linearGradient id={folderBodyGradientID} x1="1.15" y1="13.8" x2="15" y2="5.05" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF5A1F" />
                <stop offset="0.36" stopColor="#FF8A00" />
                <stop offset="0.72" stopColor="#FFB800" />
                <stop offset="1" stopColor="#FFD600" />
              </linearGradient>
              <linearGradient id={folderTopGradientID} x1="1.35" y1="6.1" x2="14.85" y2="5.15" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF5A1F" />
                <stop offset="0.4" stopColor="#FF8A00" />
                <stop offset="0.78" stopColor="#FFB800" />
                <stop offset="1" stopColor="#FFD600" />
              </linearGradient>
              <linearGradient id={folderStrokeGradientID} x1="1.4" y1="13.2" x2="14.8" y2="5.2" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF4B1F" />
                <stop offset="0.42" stopColor="#FF8A00" />
                <stop offset="0.76" stopColor="#FFB800" />
                <stop offset="1" stopColor="#FFD600" />
              </linearGradient>
            </defs>
          )}
          <path d="M1.35 5.15c0-1.49 1.21-2.7 2.7-2.7h3.04c.52 0 1 .27 1.27.72l.86 1.45c.27.46.77.75 1.31.75h2.1c1.25 0 2.27 1.02 2.27 2.27v4.43c0 1.5-1.22 2.72-2.72 2.72H4.07c-1.5 0-2.72-1.22-2.72-2.72z" fill={tabFill} stroke={edge} strokeOpacity={inverse ? 0.9 : 0.36} strokeWidth="0.5" />
          <path d="M1.35 7.1c0-1.12.91-2.03 2.03-2.03h9.2c1.13 0 2.05.92 2.05 2.05v4.9c0 1.53-1.24 2.77-2.77 2.77H4.12c-1.53 0-2.77-1.24-2.77-2.77z" fill={fill} stroke={edge} strokeOpacity={inverse ? 0.9 : 0.32} strokeWidth="0.5" />
          {orange && <path d="M1.74 7.02c.24-.83 1-1.42 1.91-1.42h8.8c1.04 0 1.89.78 2 1.78-.48-.76-1.14-1.05-2.13-1.05H3.46c-.75 0-1.32.22-1.72.69z" fill="#ffffff" opacity="0.18" />}
          {orange && <path d="M2.1 6.42c.38-.5.93-.78 1.6-.78h8.47c.97 0 1.78.67 1.98 1.56" fill="none" stroke="#FFF3AE" strokeOpacity="0.45" strokeWidth="0.45" strokeLinecap="round" />}
        </svg>
      );
    }
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 1px 1px rgba(255, 90, 31, 0.20))" }}>
        <defs>
          <linearGradient id={folderBodyGradientID} x1="1.15" y1="13.8" x2="15" y2="5.05" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF5A1F" />
            <stop offset="0.36" stopColor="#FF8A00" />
            <stop offset="0.72" stopColor="#FFB800" />
            <stop offset="1" stopColor="#FFD600" />
          </linearGradient>
          <linearGradient id={folderTopGradientID} x1="1.35" y1="6.1" x2="14.85" y2="5.15" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF5A1F" />
            <stop offset="0.4" stopColor="#FF8A00" />
            <stop offset="0.78" stopColor="#FFB800" />
            <stop offset="1" stopColor="#FFD600" />
          </linearGradient>
          <linearGradient id={folderStrokeGradientID} x1="1.4" y1="13.2" x2="14.8" y2="5.2" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF4B1F" />
            <stop offset="0.42" stopColor="#FF8A00" />
            <stop offset="0.76" stopColor="#FFB800" />
            <stop offset="1" stopColor="#FFD600" />
          </linearGradient>
        </defs>
        <path d="M1.35 5.15c0-1.49 1.21-2.7 2.7-2.7h3.04c.52 0 1 .27 1.27.72l.86 1.45c.27.46.77.75 1.31.75h2.1c1.25 0 2.27 1.02 2.27 2.27v4.43c0 1.5-1.22 2.72-2.72 2.72H4.07c-1.5 0-2.72-1.22-2.72-2.72z" fill={`url(#${folderTopGradientID})`} stroke={`url(#${folderStrokeGradientID})`} strokeOpacity="0.36" strokeWidth="0.5" />
        <path d="M1.35 7.1c0-1.12.91-2.03 2.03-2.03h9.2c1.13 0 2.05.92 2.05 2.05v4.9c0 1.53-1.24 2.77-2.77 2.77H4.12c-1.53 0-2.77-1.24-2.77-2.77z" fill={`url(#${folderBodyGradientID})`} stroke={`url(#${folderStrokeGradientID})`} strokeOpacity="0.32" strokeWidth="0.5" />
        <path d="M1.74 7.02c.24-.83 1-1.42 1.91-1.42h8.8c1.04 0 1.89.78 2 1.78-.48-.76-1.14-1.05-2.13-1.05H3.46c-.75 0-1.32.22-1.72.69z" fill="#ffffff" opacity="0.18" />
        <path d="M2.1 6.42c.38-.5.93-.78 1.6-.78h8.47c.97 0 1.78.67 1.98 1.56" fill="none" stroke="#FFF3AE" strokeOpacity="0.45" strokeWidth="0.45" strokeLinecap="round" />
        <path d="M2.02 12.19c.15 1.08 1.07 1.91 2.19 1.91h7.58c1.14 0 2.08-.86 2.2-1.97-2.48 1.02-6.83 1.06-11.97.06z" fill="#FF3D1F" opacity="0.13" />
        <path d="M1.66 5.24c.06-1.33 1.12-2.38 2.43-2.38h2.85c.41 0 .79.21 1 .56l.86 1.44c.36.6 1 .96 1.69.96h2.04c1.08 0 1.97.79 2.13 1.82" fill="none" stroke="#ffffff" strokeOpacity="0.24" strokeWidth="0.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "node") {
    return <ExplorerEntityIcon kind="node" tone={tone} />;
  }
  if (kind === "project") {
    return <ExplorerEntityIcon kind="project" tone={tone} />;
  }
  if (kind === "entity") {
    return <ExplorerEntityIcon kind="entity" tone={tone} />;
  }
  return <ExplorerEntityIcon kind="logic_gate" tone={tone} />;
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
