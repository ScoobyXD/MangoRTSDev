import React, { useId } from "react";

export const KPIIcon: React.FC<{ size?: number }> = ({ size = 22 }) => {
  const gradientID = useId().replace(/:/g, "");
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flex: "0 0 auto" }}>
      <defs>
        <linearGradient id={gradientID} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f97316" />
          <stop offset=".52" stopColor="#ef4444" />
          <stop offset="1" stopColor="#facc15" />
        </linearGradient>
      </defs>
      <path d="M4 20v-6h3v6H4Zm6 0V10h3v10h-3Zm6 0V7h3v13h-3Z" fill="none" stroke={`url(#${gradientID})`} strokeWidth="1.65" strokeLinejoin="round" />
      <path d="m5.4 10.7 4.2-4.1 3.2 2.5 5.7-5.2" fill="none" stroke={`url(#${gradientID})`} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="5.4" cy="10.7" r="1.25" fill="#fff" stroke={`url(#${gradientID})`} strokeWidth="1.45" />
      <circle cx="9.6" cy="6.6" r="1.25" fill="#fff" stroke={`url(#${gradientID})`} strokeWidth="1.45" />
      <circle cx="12.8" cy="9.1" r="1.25" fill="#fff" stroke={`url(#${gradientID})`} strokeWidth="1.45" />
      <circle cx="18.5" cy="3.9" r="1.25" fill="#fff" stroke={`url(#${gradientID})`} strokeWidth="1.45" />
    </svg>
  );
};
