import React from "react";

type CompanyExplorerSearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  onEscape?: () => void;
  style?: React.CSSProperties;
};

export function CompanyExplorerSearchBox({
  value,
  onChange,
  placeholder = "Search Explorer",
  ariaLabel = "Search Explorer",
  autoFocus = false,
  onEscape,
  style,
}: CompanyExplorerSearchBoxProps) {
  return (
    <div style={{ ...companyExplorerSearchShellStyle, ...style }}>
      <input
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onEscape?.();
          event.currentTarget.blur();
        }}
        placeholder={placeholder}
        style={companyExplorerSearchInputStyle}
      />
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={companyExplorerSearchIconStyle}>
        <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

const companyExplorerSearchShellStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
  height: 32,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 9,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(246, 247, 251, 0.92) 100%)",
  boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.18), -5px -5px 12px rgba(255, 255, 255, 0.84), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
};

const companyExplorerSearchInputStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  border: "none",
  borderRadius: 9,
  background: "transparent",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
  fontSize: 11,
  fontWeight: 620,
  outline: "none",
  padding: "0 30px 0 10px",
};

const companyExplorerSearchIconStyle: React.CSSProperties = {
  position: "absolute",
  right: 9,
  top: 9,
  color: "rgba(15, 23, 42, 0.72)",
  pointerEvents: "none",
};
