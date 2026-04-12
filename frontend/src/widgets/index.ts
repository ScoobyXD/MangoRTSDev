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
  CaseHubContent,
} from "../WidgetContent";

export interface WidgetTemplate {
  kind: string;
  label: string;
  defaultW: number;
  defaultH: number;
  render: React.FC<{ accent: string }>;
}

export const WIDGET_LIBRARY: WidgetTemplate[] = [
  { kind: "revenue", label: "Revenue", defaultW: 12, defaultH: 9, render: RevenueContent },
  { kind: "users", label: "Active Users", defaultW: 10, defaultH: 12, render: UsersContent },
  { kind: "alerts", label: "Alerts", defaultW: 8, defaultH: 8, render: AlertsContent },
  { kind: "tasks", label: "Tasks", defaultW: 10, defaultH: 8, render: TasksContent },
  { kind: "chart", label: "Analytics", defaultW: 9, defaultH: 12, render: ChartContent },
  { kind: "orders", label: "Recent Orders", defaultW: 10, defaultH: 9, render: OrdersContent },
  { kind: "notifications", label: "Notifications", defaultW: 12, defaultH: 8, render: NotificationsContent },
  { kind: "map", label: "Map View", defaultW: 10, defaultH: 15, render: MapContent },
  { kind: "case_hub", label: "Case Hub", defaultW: 14, defaultH: 14, render: CaseHubContent },
];

export const CONTENT_MAP: Record<string, React.FC<{ accent: string }>> = Object.fromEntries(
  WIDGET_LIBRARY.map((widget) => [widget.kind, widget.render])
);
