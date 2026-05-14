import type React from "react";

export const HeaderPersonIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <circle cx="8" cy="5.1" r="2.75" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="M3.3 13.15c.72-2.15 2.37-3.35 4.7-3.35s3.98 1.2 4.7 3.35" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
  </svg>
);

export const HeaderSettingsIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M6.9 1.8h2.2l.38 1.45c.34.12.66.26.96.43l1.3-.75 1.55 1.55-.75 1.3c.17.3.31.62.43.96l1.45.38v2.2l-1.45.38c-.12.34-.26.66-.43.96l.75 1.3-1.55 1.55-1.3-.75c-.3.17-.62.31-.96.43l-.38 1.45H6.9l-.38-1.45a5.16 5.16 0 0 1-.96-.43l-1.3.75-1.55-1.55.75-1.3a5.16 5.16 0 0 1-.43-.96l-1.45-.38v-2.2l1.45-.38c.12-.34.26-.66.43-.96l-.75-1.3 1.55-1.55 1.3.75c.3-.17.62-.31.96-.43L6.9 1.8Z" fill="none" stroke={color} strokeWidth="1.15" strokeLinejoin="round" />
    <circle cx="8" cy="8.2" r="1.85" fill="none" stroke={color} strokeWidth="1.15" />
  </svg>
);

export const HeaderMapIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M2.4 4.1 6 2.7l4 1.5 3.6-1.4v9.1l-3.6 1.4-4-1.5-3.6 1.4Z" fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M6 2.9v8.85M10 4.25v8.85" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" />
  </svg>
);

export const HeaderLogicGateArenaIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <rect x="2" y="2.2" width="4.2" height="4.2" rx="1" fill="none" stroke={color} strokeWidth="1.35" />
    <rect x="9.8" y="2.2" width="4.2" height="4.2" rx="1" fill="none" stroke={color} strokeWidth="1.35" />
    <rect x="5.9" y="9.8" width="4.2" height="4.2" rx="1" fill="none" stroke={color} strokeWidth="1.35" />
    <path d="M6.2 4.3h3.6M8 6.4v3.4" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export const HeaderHomeIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.5" fill="none" stroke={color} strokeWidth="1.35" />
    <path d="m3.2 4.8 4.8 3.6 4.8-3.6" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
