import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "./framerightclickmenu";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import type { NotificationItem } from "../modules/notifications/notificationsApi";
import { formatNotificationTimestamp } from "../modules/notifications/notificationTime";

type NotificationPopoverProps = {
  x: number;
  y: number;
  title: string;
  loading: boolean;
  error: string;
  items: NotificationItem[];
  seenNotificationIDs?: ReadonlySet<string>;
  width?: number;
  onClose: () => void;
  onOpen: (notification: NotificationItem) => void;
  onClear: () => void;
};

export function NotificationPopover({
  x,
  y,
  title,
  loading,
  error,
  items,
  seenNotificationIDs,
  width = 300,
  onClose,
  onOpen,
  onClear,
}: NotificationPopoverProps): React.ReactElement {
  const controlRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  const [selectedNotificationID, setSelectedNotificationID] = useState("");
  const seenIDs = useMemo(() => seenNotificationIDs ?? new Set<string>(), [seenNotificationIDs]);
  const selectedIndex = items.findIndex((item) => item.notification_id === selectedNotificationID);

  useEffect(() => {
    if (items.length === 0) {
      if (selectedNotificationID) setSelectedNotificationID("");
      return;
    }
    if (selectedNotificationID && selectedIndex < 0) setSelectedNotificationID("");
  }, [items, selectedIndex, selectedNotificationID]);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedNotificationID]);

  const selectNotificationAt = useCallback((index: number) => {
    if (loading || items.length === 0) return;
    const boundedIndex = Math.min(items.length - 1, Math.max(0, index));
    const notification = items[boundedIndex];
    if (!notification) return;
    setSelectedNotificationID(notification.notification_id);
    controlRef.current?.focus();
    onOpen(notification);
  }, [items, loading, onOpen]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const nextIndex = event.key === "ArrowDown"
      ? (selectedIndex < 0 ? 0 : selectedIndex + 1)
      : (selectedIndex < 0 ? items.length - 1 : selectedIndex - 1);
    selectNotificationAt(nextIndex);
  }, [items.length, onClose, selectNotificationAt, selectedIndex]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (loading || items.length === 0 || event.deltaY === 0) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;
    const nextIndex = selectedIndex < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : selectedIndex + direction;
    selectNotificationAt(nextIndex);
  }, [items.length, loading, selectNotificationAt, selectedIndex]);

  return (
    <FrameRightClickMenu x={x} y={y} onClose={onClose} closeOnOutside={false}>
      <div
        ref={controlRef}
        tabIndex={0}
        style={{ ...notificationPopoverStyle, width }}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
      >
        <div style={notificationPopoverHeaderStyle}>
          <span>{title}</span>
          <span style={notificationPopoverHeaderActionsStyle}>
            <button
              type="button"
              style={notificationPopoverClearButtonStyle}
              disabled={loading || items.length === 0}
              onClick={onClear}
            >
              Clear All
            </button>
            <button
              type="button"
              title="Close notifications"
              aria-label="Close notifications"
              style={notificationPopoverCloseButtonStyle}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }}
            >
              X
            </button>
          </span>
        </div>
        {loading ? (
          <div style={notificationPopoverEmptyStyle}>Loading</div>
        ) : error ? (
          <div style={notificationPopoverErrorStyle}>{error}</div>
        ) : items.length === 0 ? (
          <div style={notificationPopoverEmptyStyle}>No unread notifications</div>
        ) : items.map((notification, index) => {
          const notificationID = notification.notification_id;
          const selected = notificationID === selectedNotificationID;
          const seen = seenIDs.has(notificationID) || !!notification.read_timestamp;
          return (
            <div
              key={notificationID || `${notification.source_event_id}:${index}`}
              ref={selected ? selectedItemRef : undefined}
              role="button"
              aria-selected={selected}
              tabIndex={-1}
              style={notificationPopoverItemStyle(selected, seen)}
              onClick={() => selectNotificationAt(index)}
            >
              <button
                type="button"
                title="Select notification"
                aria-label="Select notification"
                style={notificationPopoverSelectorStyle(selected, seen)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectNotificationAt(index);
                }}
              />
              <span style={notificationPopoverItemContentStyle}>
                <NotificationPopoverTitle notification={notification} />
                {notification.body_preview && <span style={notificationPopoverBodyStyle}>{notification.body_preview}</span>}
                <span style={notificationPopoverMetaStyle}>{formatNotificationTimestamp(notification.created_timestamp)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </FrameRightClickMenu>
  );
}

function NotificationPopoverTitle({ notification }: { notification: NotificationItem }): React.ReactElement {
  const showEntityIcon = notification.type === "mention.created"
    && (notification.entity_type === "node" || notification.entity_type === "logic_gate");
  const mentionMarker = " has mentioned you in ";
  const mentionMarkerIndex = showEntityIcon ? notification.title.indexOf(mentionMarker) : -1;
  if (showEntityIcon && mentionMarkerIndex > 0) {
    const prefix = notification.title.slice(0, mentionMarkerIndex + mentionMarker.length);
    const target = notification.title.slice(mentionMarkerIndex + mentionMarker.length);
    return (
      <span style={notificationPopoverTitleStyle}>
        <span style={notificationPopoverTitlePrefixStyle}>{prefix}</span>
        <span style={notificationPopoverTitleIconStyle}>
          <ExplorerRowIcon kind={notification.entity_type === "node" ? "node" : "logic_gate"} />
        </span>
        <span style={notificationPopoverTitleTextStyle}>{target}</span>
      </span>
    );
  }
  return (
    <span style={notificationPopoverTitleStyle}>
      {showEntityIcon && (
        <span style={notificationPopoverTitleIconStyle}>
          <ExplorerRowIcon kind={notification.entity_type === "node" ? "node" : "logic_gate"} />
        </span>
      )}
      <span style={notificationPopoverTitleTextStyle}>{notification.title}</span>
    </span>
  );
}

const notificationPopoverStyle: React.CSSProperties = {
  maxHeight: 360,
  display: "grid",
  alignContent: "start",
  overflowY: "auto",
  padding: "6px 0",
  outline: "none",
};

const notificationPopoverHeaderStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "5px 12px 8px",
  background: "linear-gradient(145deg, rgba(255,255,255,0.86), rgba(245,248,252,0.76))",
  color: "rgba(15, 23, 42, 0.68)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const notificationPopoverHeaderActionsStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flex: "0 0 auto",
};

const notificationPopoverClearButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1,
  padding: "4px 7px",
  textTransform: "none",
};

const notificationPopoverCloseButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 900,
  lineHeight: 1,
  padding: 0,
};

function notificationPopoverItemStyle(selected: boolean, seen: boolean): React.CSSProperties {
  return {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "10px minmax(0, 1fr)",
    gap: 8,
    alignItems: "stretch",
    border: "none",
    background: selected ? "rgba(59, 130, 246, 0.10)" : seen ? "rgba(241, 245, 249, 0.82)" : "transparent",
    color: seen ? "rgba(51, 65, 85, 0.68)" : "#111827",
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
    padding: "8px 12px 8px 8px",
    boxShadow: selected ? "inset 0 0 0 1px rgba(59, 130, 246, 0.28)" : undefined,
  };
}

function notificationPopoverSelectorStyle(selected: boolean, seen: boolean): React.CSSProperties {
  return {
    width: 5,
    minHeight: 42,
    alignSelf: "stretch",
    border: "none",
    borderRadius: 3,
    background: selected ? "#2563eb" : seen ? "rgba(100, 116, 139, 0.32)" : "rgba(15, 23, 42, 0.20)",
    cursor: "pointer",
    padding: 0,
  };
}

const notificationPopoverItemContentStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 3,
};

const notificationPopoverTitleStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 5,
  overflow: "hidden",
  fontSize: 12,
  fontWeight: 750,
};

const notificationPopoverTitlePrefixStyle: React.CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: "58%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const notificationPopoverTitleIconStyle: React.CSSProperties = {
  width: 15,
  height: 15,
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
};

const notificationPopoverTitleTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const notificationPopoverBodyStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 11,
  fontWeight: 500,
};

const notificationPopoverMetaStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.45)",
  fontSize: 10,
  fontWeight: 700,
};

const notificationPopoverEmptyStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "rgba(15, 23, 42, 0.55)",
  fontSize: 12,
  fontWeight: 600,
};

const notificationPopoverErrorStyle: React.CSSProperties = {
  ...notificationPopoverEmptyStyle,
  color: "#8b123f",
};
