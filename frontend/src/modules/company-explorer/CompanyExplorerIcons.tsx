import type React from "react";
import type { ExplorerTreeNode } from "./companyExplorerTypes";

export const ExplorerRowIcon: React.FC<{ kind: ExplorerTreeNode["kind"] }> = ({ kind }) => {
  if (kind === "folder") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <path d="M1.4 4.3h4.8l1.1 1.35h7.1v6.35a1.45 1.45 0 0 1-1.45 1.45H2.85A1.45 1.45 0 0 1 1.4 12z" fill="#f6c944" stroke="#9d7412" strokeWidth="1.15" strokeLinejoin="round" />
        <path d="M1.4 5.65V3.9c0-.8.65-1.45 1.45-1.45h3.1L7.2 4.3" fill="#ffd85a" stroke="#9d7412" strokeWidth="1.15" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "node") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <path d="M3.7 1.7h5.45l3.15 3.15v9.45H3.7z" fill="#ffffff" stroke="#101010" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25" fill="none" stroke="#101010" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "kanban") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
        <rect x="1.45" y="2.1" width="13.1" height="11.8" rx="1.15" fill="#ffffff" stroke="#050505" strokeWidth="1.1" />
        <path d="M5.6 2.75v10.5M10.4 2.75v10.5" stroke="#050505" strokeOpacity="0.36" strokeWidth="0.8" />
        <rect x="2.65" y="3.75" width="2" height="8.45" rx="0.35" fill="#ff1744" />
        <rect x="7" y="3.75" width="2" height="8.45" rx="0.35" fill="#ffea00" />
        <rect x="11.35" y="3.75" width="2" height="8.45" rx="0.35" fill="rgb(0, 233, 255)" />
      </svg>
    );
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
