import React from "react";
import { NodeMapContent } from "./node-map/NodeMapContent";
import { LogicMapContent } from "./logic-map/LogicMapContent";
import { EditorContent } from "./editor/EditorContent";
import { CompanyExplorerContent } from "./company-explorer";
import { StatsContent } from "./stats/StatsContent";

export interface ModuleTemplate {
  kind: string;
  label: string;
  defaultW: number;
  defaultH: number;
  render: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }>;
}

// Master module library used by add-module flow and module-picker context menu.
export const MODULE_LIBRARY: ModuleTemplate[] = [
  { kind: "company-explorer", label: "Company Explorer", defaultW: 18, defaultH: 14, render: CompanyExplorerContent },
  { kind: "editor", label: "Editor", defaultW: 16, defaultH: 14, render: EditorContent },
  { kind: "nodes-map", label: "Node Map", defaultW: 16, defaultH: 14, render: NodeMapContent },
  { kind: "logic-map", label: "Logic Gate Map", defaultW: 16, defaultH: 14, render: LogicMapContent },
  { kind: "stats", label: "Stats", defaultW: 12, defaultH: 10, render: StatsContent },
];

// Fast lookup map consumed by frame rendering paths in AppLayout.
export const MODULE_CONTENT_MAP: Record<string, React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }>> = Object.fromEntries(
  MODULE_LIBRARY.map((module) => [module.kind, module.render])
);

// Legacy aliases maintained so older persisted layouts still open correctly.
MODULE_CONTENT_MAP.nodes = NodeMapContent;
MODULE_CONTENT_MAP["node-doc"] = EditorContent;
