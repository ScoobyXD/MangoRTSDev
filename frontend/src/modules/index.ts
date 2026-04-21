import React from "react";
import {
  AlertsContent,
  ChartContent,
  MapContent,
  NotificationsContent,
  OrdersContent,
  RevenueContent,
  TasksContent,
  UsersContent,
} from "../WidgetContent";
import { NodesContent } from "./node/canvas";
import { EditorContent } from "./editor";
import { CompanyExplorerContent } from "./company-explorer";

export interface ModuleTemplate {
  kind: string;
  label: string;
  defaultW: number;
  defaultH: number;
  render: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }>;
}

export const MODULE_LIBRARY: ModuleTemplate[] = [
  { kind: "revenue", label: "Revenue", defaultW: 12, defaultH: 9, render: RevenueContent },
  { kind: "users", label: "Active Users", defaultW: 10, defaultH: 12, render: UsersContent },
  { kind: "alerts", label: "Alerts", defaultW: 8, defaultH: 8, render: AlertsContent },
  { kind: "tasks", label: "Tasks", defaultW: 10, defaultH: 8, render: TasksContent },
  { kind: "chart", label: "Analytics", defaultW: 9, defaultH: 12, render: ChartContent },
  { kind: "orders", label: "Recent Orders", defaultW: 10, defaultH: 9, render: OrdersContent },
  { kind: "notifications", label: "Notifications", defaultW: 12, defaultH: 8, render: NotificationsContent },
  { kind: "map", label: "Map View", defaultW: 10, defaultH: 15, render: MapContent },
  { kind: "nodes-canvas", label: "Node Canvas", defaultW: 16, defaultH: 14, render: NodesContent },
  { kind: "editor", label: "Editor", defaultW: 16, defaultH: 14, render: EditorContent },
  { kind: "company-explorer", label: "Company Explorer", defaultW: 18, defaultH: 14, render: CompanyExplorerContent },
];

export const MODULE_CONTENT_MAP: Record<string, React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }>> = Object.fromEntries(
  MODULE_LIBRARY.map((module) => [module.kind, module.render])
);
MODULE_CONTENT_MAP.nodes = NodesContent;

MODULE_CONTENT_MAP["node-doc"] = EditorContent;
