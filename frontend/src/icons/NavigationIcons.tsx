import type React from "react";

export const HeaderRecycleBinIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M5.7 2.1h4.6l.45 1.35h2.05" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.4 4.5h9.2l-.55 8.7a1.2 1.2 0 0 1-1.2 1.1h-5.7a1.2 1.2 0 0 1-1.2-1.1Z" fill="none" stroke={color} strokeWidth="1.15" strokeLinejoin="round" />
    <path d="M6.35 7.2v4.4M9.65 7.2v4.4M6.1 3.45h3.8" stroke={color} strokeWidth="1.15" strokeLinecap="round" />
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

export const HeaderProjectManagementIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <rect x="2.1" y="3" width="11.8" height="9.8" rx="1.45" fill="none" stroke={color} strokeWidth="1.25" />
    <path d="M4.5 1.9v2.2M11.5 1.9v2.2M2.5 5.9h11" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" />
    <path d="M4.4 8.2h3.9M6.1 10.5h5.4" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
  </svg>
);

export const HeaderAccountManagerIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <rect x="2.2" y="4.1" width="5.5" height="9.1" rx="1.1" fill="none" stroke={color} strokeWidth="1.25" />
    <rect x="8.3" y="2.2" width="5.5" height="11" rx="1.1" fill="none" stroke={color} strokeWidth="1.25" />
    <path d="M3.9 6.5h2.1M3.9 8.6h2.1M3.9 10.7h2.1M10.1 5h2.1M10.1 7.1h2.1M10.1 9.2h2.1M10.1 11.3h2.1" fill="none" stroke={color} strokeWidth="1.05" strokeLinecap="round" />
  </svg>
);

export const HeaderTeamsIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <circle cx="8" cy="4.2" r="2" fill="none" stroke={color} strokeWidth="1.25" />
    <circle cx="3.8" cy="6.1" r="1.55" fill="none" stroke={color} strokeWidth="1.15" />
    <circle cx="12.2" cy="6.1" r="1.55" fill="none" stroke={color} strokeWidth="1.15" />
    <path d="M4.8 13.3v-.8c0-1.65 1.35-3 3.2-3s3.2 1.35 3.2 3v.8" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    <path d="M1.7 12.9v-.55c0-1.18.9-2.13 2.15-2.13.62 0 1.14.2 1.53.55M14.3 12.9v-.55c0-1.18-.9-2.13-2.15-2.13-.62 0-1.14.2-1.53.55" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" />
  </svg>
);

export const HeaderFieldsIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M2.2 3.3h6.25l5.25 4.75-5.25 4.65H2.2Z" fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" />
    <circle cx="5.05" cy="8" r="1.15" fill="none" stroke={color} strokeWidth="1.15" />
    <path d="M9.2 5.45 12 8l-2.8 2.5" fill="none" stroke={color} strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const HeaderTriageIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M2.3 3.4h11.4v9.2H2.3Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M3.2 4.4 8 8.1l4.8-3.7" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.1 10.7h5.8" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export const HeaderSharedTriageIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M2.4 4.4h5.2l1.15 1.35h4.85v6.45a1.15 1.15 0 0 1-1.15 1.15H3.55A1.15 1.15 0 0 1 2.4 12.2Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    <circle cx="6.05" cy="9.25" r="1.25" fill="none" stroke={color} strokeWidth="1.15" />
    <circle cx="10.05" cy="9.25" r="1.25" fill="none" stroke={color} strokeWidth="1.15" />
  </svg>
);

export const HeaderUpdatesIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M8 2.2a4.8 4.8 0 0 0-4.8 4.8v2.55l-1 1.55h11.6l-1-1.55V7A4.8 4.8 0 0 0 8 2.2Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M6.55 12.25a1.55 1.55 0 0 0 2.9 0" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    <path d="M11.6 2.1 13.8 4" fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);

export const HeaderExplorerIcon: React.FC<{ color?: string }> = ({ color = "currentColor" }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M2.2 4.6h4.35l1.1 1.3h6.15v6.35a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2Z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M2.65 4.65V3.4h4.1l1 1.25" fill="none" stroke={color} strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
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
