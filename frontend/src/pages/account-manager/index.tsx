import React from "react";
import { AccountManagerContent } from "../../modules/accounts/AccountManagerContent.js";

export function AccountManagerPage() {
  return (
    <div style={pageShellStyle}>
      <AccountManagerContent accent="#14b8a6" />
    </div>
  );
}

const pageShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};
