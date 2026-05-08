import React from "react";
import { MapContent } from "./map/MapContent";
import { EditorContent } from "./editor/EditorContent";
import { CompanyExplorerContent } from "./company-explorer";
import { StatsContent } from "./stats/StatsContent";
import { KanbanContent } from "./kanban/KanbanContent";
import { CommunicationsFrameContent } from "../pages/communications/CommunicationsPage";

export interface ModuleTemplate {
  kind: string;
  label: string;
  defaultW: number;
  defaultH: number;
  render: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }>;
}

const LegacyLogicGateMapContent: ModuleTemplate["render"] = (props) => React.createElement(MapContent, { ...props, initialMode: "logic_gate" });

// Master module library used by add-module flow and module-picker context menu.
export const MODULE_LIBRARY: ModuleTemplate[] = [
  { kind: "company-explorer", label: "Company Explorer", defaultW: 18, defaultH: 14, render: CompanyExplorerContent },
  { kind: "editor", label: "Editor", defaultW: 16, defaultH: 14, render: EditorContent },
  { kind: "kanban", label: "Kanban board", defaultW: 18, defaultH: 7, render: KanbanContent },
  { kind: "communications", label: "Communications", defaultW: 24, defaultH: 16, render: CommunicationsFrameContent },
  { kind: "map", label: "Map", defaultW: 16, defaultH: 14, render: MapContent },
  { kind: "stats", label: "Stats", defaultW: 12, defaultH: 10, render: StatsContent },
];

// Fast lookup map consumed by frame rendering paths in AppLayout.
export const MODULE_CONTENT_MAP: Record<string, React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }>> = Object.fromEntries(
  MODULE_LIBRARY.map((module) => [module.kind, module.render])
);

// Legacy aliases maintained so older persisted layouts still open correctly.
MODULE_CONTENT_MAP.nodes = MapContent;
MODULE_CONTENT_MAP["nodes-map"] = MapContent;
MODULE_CONTENT_MAP["logic-map"] = LegacyLogicGateMapContent;
MODULE_CONTENT_MAP["node-doc"] = EditorContent;
