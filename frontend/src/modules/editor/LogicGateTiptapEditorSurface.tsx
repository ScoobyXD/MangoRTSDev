import React from "react";
import type { MangoTiptapEditorProps } from "./tiptap/MangoTiptapEditor.js";

const LazyMangoTiptapEditor = React.lazy(async () => {
  const module = await import("./tiptap/MangoTiptapEditor.js");
  return { default: module.MangoTiptapEditor };
});

export type LogicGateTiptapEditorSurfaceProps = Omit<MangoTiptapEditorProps, "resourceType" | "ariaLabel">;

export const LogicGateTiptapEditorSurface: React.FC<LogicGateTiptapEditorSurfaceProps> = (props) => (
  <LazyMangoTiptapEditor
    {...props}
    resourceType="logic_gate"
    ariaLabel="Process editor"
  />
);
