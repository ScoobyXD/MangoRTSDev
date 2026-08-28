import React from "react";
import { EntitiesContent } from "../../modules/entities/EntitiesContent.js";

export function EntitiesPage() {
  return (
    <div style={pageShellStyle}>
      <EntitiesContent />
    </div>
  );
}

const pageShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};
