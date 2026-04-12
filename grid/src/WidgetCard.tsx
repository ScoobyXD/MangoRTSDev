import React from "react";
import type { WidgetConfig } from "./types";
import {
  RevenueContent,
  UsersContent,
  AlertsContent,
  TasksContent,
  ChartContent,
  OrdersContent,
  NotificationsContent,
  MapContent,
} from "./WidgetContent";

const CONTENT_MAP: Record<string, React.FC<{ accent: string }>> = {
  revenue: RevenueContent,
  users: UsersContent,
  alerts: AlertsContent,
  tasks: TasksContent,
  chart: ChartContent,
  orders: OrdersContent,
  notifications: NotificationsContent,
  map: MapContent,
};

interface WidgetCardProps {
  config: WidgetConfig;
  gridW: number;
  gridH: number;
}

const WidgetCard: React.FC<WidgetCardProps> = ({ config, gridW, gridH }) => {
  const ContentComponent = CONTENT_MAP[config.id];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: config.color,
        borderRadius: 14,
        border: `1.5px solid ${config.accent}18`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px 4px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: config.accent,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {config.title}
        </span>

        {/* Grid size badge */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: config.accent,
            background: `${config.accent}15`,
            border: `1px solid ${config.accent}30`,
            borderRadius: 6,
            padding: "2px 8px",
            fontFamily: "'DM Sans', monospace",
            letterSpacing: "0.03em",
          }}
        >
          {gridW}×{gridH}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: "4px 14px 12px", overflow: "hidden" }}>
        {ContentComponent ? <ContentComponent accent={config.accent} /> : null}
      </div>
    </div>
  );
};

export default WidgetCard;
