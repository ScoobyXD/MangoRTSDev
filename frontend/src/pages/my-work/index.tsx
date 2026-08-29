import React from "react";
import { MyWorkContent, type MyWorkContentProps } from "../../modules/my-work/MyWorkContent.js";

export function MyWorkPage(props: MyWorkContentProps) {
  return (
    <div style={pageShellStyle}>
      <MyWorkContent {...props} />
    </div>
  );
}

const pageShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};
