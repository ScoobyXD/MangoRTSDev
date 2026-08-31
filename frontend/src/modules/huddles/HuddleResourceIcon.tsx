import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";

export const HuddlePeopleIcon: React.FC<{ color?: string; size?: number }> = ({ color = "currentColor", size = 15 }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" style={{ display: "block", flex: "0 0 auto" }}>
    <circle cx="9" cy="5" r="2.35" fill="none" stroke={color} strokeWidth="1.45" />
    <circle cx="3.9" cy="7" r="1.7" fill="none" stroke={color} strokeWidth="1.3" />
    <circle cx="14.1" cy="7" r="1.7" fill="none" stroke={color} strokeWidth="1.3" />
    <path d="M4.4 14.7c.3-2.65 1.95-4.15 4.6-4.15s4.3 1.5 4.6 4.15" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
    <path d="M1.6 13.8c.2-1.9 1.2-2.95 3-3.15M16.4 13.8c-.2-1.9-1.2-2.95-3-3.15" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
  </svg>
);

export const HuddleBoardIcon: React.FC<{ color?: string; size?: number }> = ({ color = "currentColor", size = 17 }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" style={{ display: "block", flex: "0 0 auto" }}>
    <rect x="1.75" y="2.25" width="14.5" height="13.5" rx="2" fill="none" stroke={color} strokeWidth="1.35" />
    <path d="M6.45 2.9v12.2M11.55 2.9v12.2" fill="none" stroke={color} strokeWidth="1.2" />
    <path d="M3.3 5.1h1.6M3.3 7.45h1.6M8.2 5.1h1.6M13.1 5.1h1.6M13.1 7.45h1.6M13.1 9.8h1.6" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" />
  </svg>
);

export const HuddleResourceIcon: React.FC<{ type: "huddle_logic_gate" | "huddle_node" }> = ({ type }) => (
  type === "huddle_logic_gate" ? (
    <span aria-hidden="true" style={{ width: 28, height: 20, display: "inline-grid", placeItems: "center", color: "#111827" }}>
      <HuddleBoardIcon color="#6d28d9" size={17} />
    </span>
  ) : (
    <span aria-hidden="true" style={{ width: 28, height: 20, display: "inline-grid", gridTemplateColumns: "12px 15px", alignItems: "center", color: "#111827" }}>
      <HuddlePeopleIcon color="#64748b" size={12} />
      <ExplorerRowIcon kind="node" />
    </span>
  )
);
