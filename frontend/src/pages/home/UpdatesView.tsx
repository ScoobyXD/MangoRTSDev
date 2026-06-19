import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import { fetchNotifications, markNotificationRead, NOTIFICATION_TYPE_MENTION, NOTIFICATION_TYPE_URGENT_MENTION, type NotificationItem } from "../../modules/notifications/notificationsApi";
import { formatNotificationTimestamp } from "../../modules/notifications/notificationTime";
import { buildUniversalNestedGroups, computeUniversalDefaultExpandedGroupIDs, type UniversalGroupValue, type UniversalNestedGroup } from "./universalGrouping";

type UpdatesViewProps = {
  companyID: string;
  onOpenNode: (nodeID: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
};

type UpdateFilter = "all" | "urgent" | "mention" | "update";
type UpdateGroupingField = "type" | "date" | "entity" | "read_state";
type UpdateGroupingSetting = { field: UpdateGroupingField; direction: "asc" | "desc" };
type UpdateGroup = UniversalNestedGroup<NotificationItem, UpdateGroupingField>;

const UPDATE_GROUPING_FIELDS: ReadonlyArray<{ value: UpdateGroupingField; label: string }> = [
  { value: "type", label: "Type" },
  { value: "date", label: "Date" },
  { value: "entity", label: "Entity" },
  { value: "read_state", label: "Read" },
];

const DEFAULT_UPDATE_GROUPINGS: UpdateGroupingSetting[] = [
  { field: "type", direction: "asc" },
  { field: "date", direction: "desc" },
  { field: "entity", direction: "asc" },
];

const UPDATE_FILTERS: ReadonlyArray<{ value: UpdateFilter; label: string; title: string }> = [
  { value: "urgent", label: "!", title: "Urgent mentions" },
  { value: "mention", label: "@", title: "Mentions" },
  { value: "update", label: "Updates", title: "App updates" },
  { value: "all", label: "All", title: "All updates" },
];

export function UpdatesView({ companyID, onOpenNode, onOpenLogicGate }: UpdatesViewProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<UpdateFilter>("all");
  const [groupings, setGroupings] = useState<UpdateGroupingSetting[]>(DEFAULT_UPDATE_GROUPINGS);
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [loadedBranchIDs, setLoadedBranchIDs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!companyID.trim()) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchNotifications({ companyID, limit: 500 })
      .then((next) => {
        if (cancelled) return;
        setItems(next);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setItems([]);
        setError(nextError instanceof Error ? nextError.message : "Failed to load Updates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID]);

  const visibleItems = useMemo(() => items.filter((item) => updateMatchesFilter(item, filter)), [filter, items]);
  const groups = useMemo(() => buildUpdateGroups(visibleItems, groupings), [groupings, visibleItems]);
  const groupingSignature = useMemo(() => JSON.stringify({
    filter,
    groupings,
    rows: visibleItems.map((item) => item.notification_id).sort(),
  }), [filter, groupings, visibleItems]);

  useEffect(() => {
    const defaultExpanded = computeUniversalDefaultExpandedGroupIDs(groups);
    setExpandedGroupIDs(defaultExpanded);
    setLoadedBranchIDs(defaultExpanded);
  }, [groupingSignature, groups]);

  const toggleGroup = useCallback((groupID: string) => {
    setLoadedBranchIDs((current) => new Set(current).add(groupID));
    setExpandedGroupIDs((current) => {
      const next = new Set(current);
      if (next.has(groupID)) next.delete(groupID);
      else next.add(groupID);
      return next;
    });
  }, []);

  const openItem = useCallback((item: NotificationItem) => {
    if (item.notification_id && !item.read_timestamp) void markNotificationRead(item.notification_id, true).catch(() => undefined);
    if (item.entity_type === "node" && item.entity_id.trim()) {
      onOpenNode(item.entity_id);
      return;
    }
    if (item.entity_type === "logic_gate" && item.entity_id.trim()) {
      onOpenLogicGate(item.entity_id, item.title);
    }
  }, [onOpenLogicGate, onOpenNode]);

  return (
    <section style={updatesShellStyle}>
      <div style={updatesHeaderStyle}>
        <div style={updatesTitleStackStyle}>
          <h2 style={updatesTitleStyle}>Updates</h2>
          <div style={updatesMetaStyle}>
            {visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}
            {loading ? " - Loading" : ""}
            {error ? ` - ${error}` : ""}
          </div>
        </div>
        <div style={updatesControlsStyle}>
          <div style={updatesFilterRowStyle}>
            {UPDATE_FILTERS.map((item) => (
              <button key={item.value} type="button" title={item.title} style={updatesFilterButtonStyle(filter === item.value)} onClick={() => setFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <div style={updatesGroupingRowStyle}>
            {groupings.map((grouping, index) => (
              <button
                key={`${grouping.field}:${index}`}
                type="button"
                style={updatesGroupingButtonStyle}
                onClick={() => setGroupings((current) => current.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, direction: item.direction === "asc" ? "desc" : "asc" } : item
                )))}
              >
                {updateGroupingFieldLabel(grouping.field)} {grouping.direction === "asc" ? "Asc" : "Desc"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mango-home-scroll" style={updatesListStyle}>
        {!loading && !error && visibleItems.length === 0 ? (
          <div style={updatesEmptyStyle}>No updates</div>
        ) : (
          <UpdateGroupList groups={groups} expandedGroupIDs={expandedGroupIDs} loadedBranchIDs={loadedBranchIDs} onToggleGroup={toggleGroup} onOpenItem={openItem} />
        )}
      </div>
    </section>
  );
}

function UpdateGroupList({
  groups,
  expandedGroupIDs,
  loadedBranchIDs,
  onToggleGroup,
  onOpenItem,
}: {
  groups: UpdateGroup[];
  expandedGroupIDs: Set<string>;
  loadedBranchIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenItem: (item: NotificationItem) => void;
}) {
  return (
    <div style={updateGroupListStyle}>
      {groups.map((group) => {
        const open = expandedGroupIDs.has(group.id);
        const loaded = loadedBranchIDs.has(group.id);
        const leafRows = group.groups.length === 0 ? group.rows : [];
        return (
          <div key={group.id} style={updateGroupBlockStyle}>
            <button type="button" style={updateGroupHeaderStyle(group.depth)} onClick={() => onToggleGroup(group.id)}>
              <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              <span style={updateGroupBadgeStyle}>{updateGroupBadge(group.field)}</span>
              <span style={updateGroupLabelStyle}>{group.label}</span>
              <span style={updateGroupCountStyle}>{countUpdateGroupRows(group)}</span>
            </button>
            {open && !loaded && <div style={updatesBranchLoadingStyle}>Loading branch</div>}
            {open && loaded && group.groups.length > 0 && (
              <UpdateGroupList groups={group.groups} expandedGroupIDs={expandedGroupIDs} loadedBranchIDs={loadedBranchIDs} onToggleGroup={onToggleGroup} onOpenItem={onOpenItem} />
            )}
            {open && loaded && leafRows.length > 0 && <UpdateRows rows={leafRows} depth={group.depth + 1} onOpenItem={onOpenItem} />}
          </div>
        );
      })}
    </div>
  );
}

function UpdateRows({ rows, depth, onOpenItem }: { rows: NotificationItem[]; depth: number; onOpenItem: (item: NotificationItem) => void }) {
  return (
    <div style={updateRowsStyle}>
      {rows.map((item) => (
        <button key={item.notification_id || item.source_event_id} type="button" style={updateRowStyle(depth, !item.read_timestamp, item.type === NOTIFICATION_TYPE_URGENT_MENTION)} onClick={() => onOpenItem(item)}>
          <span style={updateRowIconStyle(item.type === NOTIFICATION_TYPE_URGENT_MENTION)}>
            {item.entity_type === "node" || item.entity_type === "logic_gate" ? <ExplorerRowIcon kind={item.entity_type === "node" ? "node" : "logic_gate"} /> : updateTypeLabel(item)}
          </span>
          <span style={updateRowTextStyle}>
            <span style={updateRowTitleStyle}>{item.title}</span>
            {item.body_preview && <span style={updateRowBodyStyle}>{item.body_preview}</span>}
          </span>
          <span style={updateRowTimeStyle}>{formatNotificationTimestamp(item.created_timestamp)}</span>
        </button>
      ))}
    </div>
  );
}

function buildUpdateGroups(items: NotificationItem[], groupings: UpdateGroupingSetting[]): UpdateGroup[] {
  return buildUniversalNestedGroups(items, groupings, {
    rootID: "updates",
    rowKey: (item) => item.notification_id || item.source_event_id,
    getValues: getUpdateGroupValues,
    sortRows: sortUpdateItems,
  });
}

function getUpdateGroupValues(item: NotificationItem, field: UpdateGroupingField): UniversalGroupValue[] {
  if (field === "type") {
    if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) return [{ key: "type:urgent", label: "! Mentions", sortValue: 1 }];
    if (item.type === NOTIFICATION_TYPE_MENTION) return [{ key: "type:mention", label: "@ Mentions", sortValue: 2 }];
    return [{ key: "type:update", label: "Updates", sortValue: 3 }];
  }
  if (field === "date") {
    const day = item.created_timestamp?.slice(0, 10) || "No date";
    return [{ key: `date:${day}`, label: day, sortValue: day }];
  }
  if (field === "entity") {
    const entity = item.entity_type?.trim() || "other";
    const label = entity === "logic_gate" ? "Logic Gates" : entity === "node" ? "Nodes" : "Other";
    return [{ key: `entity:${entity}`, label, sortValue: label }];
  }
  return item.read_timestamp
    ? [{ key: "read:read", label: "Read", sortValue: 2 }]
    : [{ key: "read:unread", label: "Unread", sortValue: 1 }];
}

function sortUpdateItems(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort((left, right) => Date.parse(right.created_timestamp || "") - Date.parse(left.created_timestamp || "")
    || left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" })
    || left.notification_id.localeCompare(right.notification_id));
}

function updateMatchesFilter(item: NotificationItem, filter: UpdateFilter): boolean {
  if (filter === "all") return true;
  if (filter === "urgent") return item.type === NOTIFICATION_TYPE_URGENT_MENTION;
  if (filter === "mention") return item.type === NOTIFICATION_TYPE_MENTION;
  return item.type !== NOTIFICATION_TYPE_MENTION && item.type !== NOTIFICATION_TYPE_URGENT_MENTION;
}

function updateGroupingFieldLabel(field: UpdateGroupingField): string {
  return UPDATE_GROUPING_FIELDS.find((item) => item.value === field)?.label ?? "Group";
}

function updateTypeLabel(item: NotificationItem): string {
  if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) return "!";
  if (item.type === NOTIFICATION_TYPE_MENTION) return "@";
  return "U";
}

function updateGroupBadge(field: UpdateGroupingField): string {
  if (field === "type") return "T";
  if (field === "date") return "D";
  if (field === "entity") return "E";
  return "R";
}

function countUpdateGroupRows(group: UpdateGroup): number {
  if (group.groups.length === 0) return group.rows.length;
  return group.groups.reduce((sum, child) => sum + countUpdateGroupRows(child), 0);
}

const updatesShellStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 14,
  background: "#ffffff",
  color: "#111827",
  overflow: "hidden",
};

const updatesHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 12,
  alignItems: "start",
};

const updatesTitleStackStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 4 };
const updatesTitleStyle: React.CSSProperties = { margin: 0, color: "#111827", fontSize: 16, lineHeight: 1.2, fontWeight: 800, letterSpacing: 0 };
const updatesMetaStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 700 };
const updatesControlsStyle: React.CSSProperties = { display: "grid", justifyItems: "end", gap: 6 };
const updatesFilterRowStyle: React.CSSProperties = { display: "inline-flex", border: "1px solid rgba(15, 23, 42, 0.18)", borderRadius: 6, overflow: "hidden" };

function updatesFilterButtonStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 32,
    minHeight: 28,
    border: "none",
    borderRight: "1px solid rgba(15, 23, 42, 0.12)",
    background: active ? "#e2e8f0" : "#ffffff",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 850 : 700,
    cursor: "pointer",
    padding: "0 9px",
  };
}

const updatesGroupingRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 5 };
const updatesGroupingButtonStyle: React.CSSProperties = { minHeight: 26, border: "1px solid rgba(15, 23, 42, 0.16)", borderRadius: 5, background: "#f8fafc", color: "#334155", font: "inherit", fontSize: 11, fontWeight: 800, cursor: "pointer", padding: "0 7px" };
const updatesListStyle: React.CSSProperties = { minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", padding: "2px 16px 32px 0" };
const updatesEmptyStyle: React.CSSProperties = { minHeight: 160, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 700 };
const updateGroupListStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 4 };
const updateGroupBlockStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 2 };

function updateGroupHeaderStyle(depth: number): React.CSSProperties {
  return {
    width: "max-content",
    maxWidth: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "14px 16px minmax(0, auto) auto",
    alignItems: "center",
    gap: 5,
    marginLeft: depth * 28,
    border: "none",
    background: "transparent",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    padding: "0 2px",
  };
}

const updateGroupBadgeStyle: React.CSSProperties = { width: 16, height: 16, display: "grid", placeItems: "center", color: "#64748b", fontSize: 10, fontWeight: 850 };
const updateGroupLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 };
const updateGroupCountStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 800 };
const updatesBranchLoadingStyle: React.CSSProperties = { marginLeft: 42, color: "#64748b", fontSize: 11, fontWeight: 700, padding: "4px 0" };
const updateRowsStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start" };

function updateRowStyle(depth: number, unread: boolean, urgent: boolean): React.CSSProperties {
  return {
    width: "min(980px, calc(100% - 16px))",
    minHeight: 38,
    display: "grid",
    gridTemplateColumns: "18px minmax(220px, 1fr) 100px",
    alignItems: "center",
    gap: 9,
    marginLeft: depth * 28 + 42,
    border: "none",
    borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
    background: urgent ? "rgba(239, 68, 68, 0.06)" : "#ffffff",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    padding: "0 8px",
    fontWeight: unread ? 800 : 650,
  };
}

function updateRowIconStyle(urgent: boolean): React.CSSProperties {
  return { width: 18, display: "grid", placeItems: "center", color: urgent ? "#b91c1c" : "#475569", fontSize: 12, fontWeight: 900 };
}

const updateRowTextStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 2 };
const updateRowTitleStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 780 };
const updateRowBodyStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 11, fontWeight: 650 };
const updateRowTimeStyle: React.CSSProperties = { color: "#64748b", fontSize: 10, fontWeight: 700, textAlign: "right" };
