import React, { useId } from "react";

type MangoLogoMarkProps = {
  size?: number;
};

export const MangoLogoMark: React.FC<MangoLogoMarkProps> = ({ size = 28 }) => {
  const gradientID = `mango-gradient-${useId().replace(/:/g, "")}`;
  const clipID = `mango-clip-${useId().replace(/:/g, "")}`;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" style={{ display: "block", flex: "0 0 auto" }}>
      <defs>
        <linearGradient id={gradientID} x1="11" y1="13" x2="52" y2="49" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbb152" />
          <stop offset="0.38" stopColor="#fea94e" />
          <stop offset="0.68" stopColor="#fe9b46" />
          <stop offset="1" stopColor="#ff8820" />
        </linearGradient>
        <clipPath id={clipID}>
          <polygon points="32,11 50,21.5 50,42.5 32,53 14,42.5 14,21.5" />
        </clipPath>
      </defs>
      <polygon points="32,5.5 55,18.75 55,45.25 32,58.5 9,45.25 9,18.75" fill="none" stroke={`url(#${gradientID})`} strokeWidth="7" strokeLinejoin="round" />
      <polygon points="32,11 50,21.5 50,42.5 32,53 14,42.5 14,21.5" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinejoin="round" />
      <g clipPath={`url(#${clipID})`}>
        <polygon points="18,44 25,19 31,16 24,47" fill={`url(#${gradientID})`} />
        <polygon points="27,48 35,15 41,16 33,51" fill={`url(#${gradientID})`} />
        <polygon points="36,50 44,18 49,21 42,47" fill={`url(#${gradientID})`} />
        <polygon points="14,42 20,23 25,20 19,45" fill={`url(#${gradientID})`} />
      </g>
    </svg>
  );
};

type MangoWordmarkProps = {
  size?: number;
  weight?: number;
  showMark?: boolean;
};

export const MangoWordmark: React.FC<MangoWordmarkProps> = ({ size = 22, weight = 500, showMark = true }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: Math.max(7, Math.round(size * 0.36)), minWidth: 0, lineHeight: 1 }}>
    {showMark && <MangoLogoMark size={Math.round(size * 1.35)} />}
    <span
      style={{
        fontFamily: "var(--mango-font-family)",
        fontSize: size,
        fontWeight: weight,
        lineHeight: `${size}px`,
        letterSpacing: 0,
        textTransform: "none",
        background: "var(--mango-brand-gradient)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        whiteSpace: "nowrap",
      }}
    >
      MangoRTS
    </span>
  </span>
);
