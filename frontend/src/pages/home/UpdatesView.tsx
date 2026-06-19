import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import {
  fetchUpdateBranch,
  fetchUpdateRootGroups,
  markNotificationRead,
  NOTIFICATION_TYPE_MENTION,
  NOTIFICATION_TYPE_URGENT_MENTION,
  type NotificationItem,
  type UpdateFeedFilter,
  type UpdateGroup,
} from "../../modules/notifications/notificationsApi";
import { formatNotificationTimestamp } from "../../modules/notifications/notificationTime";

type UpdatesViewProps = {
  companyID: string;
  onOpenNode: (nodeID: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
};

const UPDATE_FILTERS: ReadonlyArray<{ value: UpdateFeedFilter; label: string; title: string }> = [
  { value: "urgent", label: "!", title: "Urgent mentions" },
  { value: "mention", label: "@", title: "Mentions" },
  { value: "update", label: "Updates", title: "Updates" },
  { value: "all", label: "All", title: "All updates" },
];

export function UpdatesView({ companyID, onOpenNode, onOpenLogicGate, onOpenProject }: UpdatesViewProps) {
  const [rootGroups, setRootGroups] = useState<UpdateGroup[]>([]);
  const [branchByRootID, setBranchByRootID] = useState<Record<string, UpdateGroup>>({});
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [branchLoadingIDs, setBranchLoadingIDs] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<UpdateFeedFilter>("all");
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());

  const loadBranch = useCallback((rootID: string) => {
    const cleanRootID = rootID.trim();
    if (!companyID.trim() || !cleanRootID) return;
    if (branchByRootID[cleanRootID] || branchLoadingIDs.has(cleanRootID)) return;
    setBranchLoadingIDs((current) => new Set(current).add(cleanRootID));
    setError("");
    void fetchUpdateBranch({ companyID, filter, rootID: cleanRootID })
      .then((branch) => {
        setBranchByRootID((current) => ({ ...current, [cleanRootID]: branch }));
        setExpandedGroupIDs((current) => {
          const next = new Set(current);
          for (const groupID of collectUpdateGroupIDs(branch)) next.add(groupID);
          return next;
        });
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to load Updates");
      })
      .finally(() => {
        setBranchLoadingIDs((current) => {
          const next = new Set(current);
          next.delete(cleanRootID);
          return next;
        });
      });
  }, [branchByRootID, branchLoadingIDs, companyID, filter]);

  useEffect(() => {
    if (!companyID.trim()) {
      setRootGroups([]);
      setBranchByRootID({});
      setExpandedGroupIDs(new Set());
      return;
    }
    let cancelled = false;
    setLoadingRoots(true);
    setError("");
    setBranchByRootID({});
    setBranchLoadingIDs(new Set());
    setExpandedGroupIDs(new Set());
    void fetchUpdateRootGroups({ companyID, filter })
      .then((roots) => {
        if (cancelled) return;
        setRootGroups(roots);
        const firstRoot = roots[0];
        if (!firstRoot) return;
        setExpandedGroupIDs(new Set([firstRoot.id]));
        setBranchLoadingIDs(new Set([firstRoot.id]));
        void fetchUpdateBranch({ companyID, filter, rootID: firstRoot.id })
          .then((branch) => {
            if (cancelled) return;
            setBranchByRootID({ [firstRoot.id]: branch });
            setExpandedGroupIDs(new Set(collectUpdateGroupIDs(branch)));
          })
          .catch((nextError) => {
            if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Failed to load Updates");
          })
          .finally(() => {
            if (!cancelled) setBranchLoadingIDs(new Set());
          });
      })
      .catch((nextError) => {
        if (cancelled) return;
        setRootGroups([]);
        setError(nextError instanceof Error ? nextError.message : "Failed to load Updates");
      })
      .finally(() => {
        if (!cancelled) setLoadingRoots(false);
      });
    return () => { cancelled = true; };
  }, [companyID, filter]);

  const displayGroups = useMemo(() => rootGroups.map((root) => branchByRootID[root.id] ?? root), [branchByRootID, rootGroups]);

  const toggleGroup = useCallback((groupID: string) => {
    const isRoot = rootGroups.some((group) => group.id === groupID);
    const willOpen = !expandedGroupIDs.has(groupID);
    if (willOpen && isRoot && !branchByRootID[groupID]) loadBranch(groupID);
    setExpandedGroupIDs((current) => {
      const next = new Set(current);
      if (willOpen) next.add(groupID);
      else next.delete(groupID);
      return next;
    });
  }, [branchByRootID, expandedGroupIDs, loadBranch, rootGroups]);

  const openItem = useCallback((item: NotificationItem) => {
    if (item.notification_id && !item.read_timestamp) void markNotificationRead(item.notification_id, true).catch(() => undefined);
    const nodeID = item.node_id?.trim() || (item.entity_type === "node" ? item.entity_id.trim() : "");
    if (nodeID) {
      onOpenNode(nodeID);
      return;
    }
    const logicGateID = item.logic_gate_id?.trim() || (item.entity_type === "logic_gate" ? item.entity_id.trim() : "");
    if (logicGateID) {
      onOpenLogicGate(logicGateID, item.title);
      return;
    }
    const projectID = item.entity_type === "project" ? item.entity_id.trim() : "";
    if (projectID) onOpenProject(projectID, item.title);
  }, [onOpenLogicGate, onOpenNode, onOpenProject]);

  const openGroupResource = useCallback((group: UpdateGroup) => {
    const resourceID = group.resource_id?.trim() ?? "";
    if (!resourceID) return;
    if (group.resource_type === "node") onOpenNode(resourceID);
    if (group.resource_type === "logic_gate") onOpenLogicGate(resourceID, group.label);
    if (group.resource_type === "project") onOpenProject(resourceID, group.label);
  }, [onOpenLogicGate, onOpenNode, onOpenProject]);

  const meta = loadingRoots ? "Loading" : error;

  return (
    <section style={updatesShellStyle}>
      <div style={updatesHeaderStyle}>
        <div style={updatesTitleStackStyle}>
          <h2 style={updatesTitleStyle}>Updates</h2>
          {meta && <div style={updatesMetaStyle}>{meta}</div>}
        </div>
        <div style={updatesFilterRowStyle}>
          {UPDATE_FILTERS.map((item) => (
            <button key={item.value} type="button" title={item.title} style={updatesFilterButtonStyle(filter === item.value)} onClick={() => setFilter(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mango-home-scroll" style={updatesListStyle}>
        {!loadingRoots && !error && displayGroups.length === 0 ? (
          <div style={updatesEmptyStyle}>No updates</div>
        ) : (
          <UpdateGroupList
            groups={displayGroups}
            expandedGroupIDs={expandedGroupIDs}
            branchLoadingIDs={branchLoadingIDs}
            onToggleGroup={toggleGroup}
            onOpenItem={openItem}
            onOpenGroupResource={openGroupResource}
          />
        )}
      </div>
    </section>
  );
}

function UpdateGroupList({
  groups,
  expandedGroupIDs,
  branchLoadingIDs,
  onToggleGroup,
  onOpenItem,
  onOpenGroupResource,
}: {
  groups: UpdateGroup[];
  expandedGroupIDs: Set<string>;
  branchLoadingIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenItem: (item: NotificationItem) => void;
  onOpenGroupResource: (group: UpdateGroup) => void;
}) {
  return (
    <div style={updateGroupListStyle}>
      {groups.map((group) => {
        const open = expandedGroupIDs.has(group.id);
        const branchLoading = branchLoadingIDs.has(group.id);
        const rows = group.notifications ?? [];
        const canOpenResource = updateGroupCanOpenResource(group);
        return (
          <div key={group.id} style={updateGroupBlockStyle}>
            <div style={updateGroupHeaderStyle(group.depth)}>
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                style={updateDisclosureButtonStyle}
                onClick={() => onToggleGroup(group.id)}
              >
                <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              </button>
              {canOpenResource ? (
                <button type="button" style={updateGroupResourceButtonStyle} onClick={() => onOpenGroupResource(group)}>
                  <UpdateGroupIcon group={group} />
                  <span style={updateGroupLabelStyle}>{group.label}</span>
                </button>
              ) : (
                <span style={updateGroupStaticContentStyle}>
                  <UpdateGroupIcon group={group} />
                  <span style={updateGroupLabelStyle}>{group.label}</span>
                </span>
              )}
            </div>
            {open && branchLoading && <div style={updatesBranchLoadingStyle}>Loading branch</div>}
            {open && group.groups.length > 0 && (
              <UpdateGroupList groups={group.groups} expandedGroupIDs={expandedGroupIDs} branchLoadingIDs={branchLoadingIDs} onToggleGroup={onToggleGroup} onOpenItem={onOpenItem} onOpenGroupResource={onOpenGroupResource} />
            )}
            {open && rows.length > 0 && <UpdateRows rows={rows} depth={group.depth + 1} onOpenItem={onOpenItem} />}
          </div>
        );
      })}
    </div>
  );
}

function updateGroupCanOpenResource(group: UpdateGroup): boolean {
  return Boolean(
    group.resource_id?.trim()
      && (group.resource_type === "project" || group.resource_type === "logic_gate" || group.resource_type === "node"),
  );
}

function UpdateGroupIcon({ group }: { group: UpdateGroup }) {
  if (group.resource_type === "project" || group.resource_type === "logic_gate" || group.resource_type === "node") {
    return <ExplorerRowIcon kind={group.resource_type} />;
  }
  return <span style={updateGroupBadgeStyle}>U</span>;
}

function UpdateRows({ rows, depth, onOpenItem }: { rows: NotificationItem[]; depth: number; onOpenItem: (item: NotificationItem) => void }) {
  return (
    <div style={updateRowsStyle}>
      {rows.map((item) => (
        <button key={item.notification_id || item.source_event_id} type="button" style={updateRowStyle(depth, !item.read_timestamp, item.type === NOTIFICATION_TYPE_URGENT_MENTION)} onClick={() => onOpenItem(item)}>
          <span style={updateRowIconStyle(item.type === NOTIFICATION_TYPE_URGENT_MENTION)}>
            {updateRowIcon(item)}
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

function updateRowIcon(item: NotificationItem): React.ReactNode {
  if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) return "!";
  if (item.type === NOTIFICATION_TYPE_MENTION) return "@";
  if (item.entity_type === "node") return <ExplorerRowIcon kind="node" />;
  if (item.entity_type === "logic_gate") return <ExplorerRowIcon kind="logic_gate" />;
  if (item.entity_type === "project") return <ExplorerRowIcon kind="project" />;
  return "U";
}

function collectUpdateGroupIDs(group: UpdateGroup): string[] {
  const ids = [group.id];
  for (const child of group.groups) ids.push(...collectUpdateGroupIDs(child));
  return ids;
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
    gridTemplateColumns: "14px minmax(0, auto)",
    alignItems: "center",
    gap: 5,
    marginLeft: depth * 28,
    border: "none",
    background: "transparent",
    color: "#111827",
    textAlign: "left",
    padding: "0 2px",
  };
}

const updateDisclosureButtonStyle: React.CSSProperties = {
  width: 14,
  height: 24,
  minWidth: 14,
  border: "none",
  background: "transparent",
  color: "inherit",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
};

const updateGroupResourceButtonStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, auto)",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
};

const updateGroupStaticContentStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, auto)",
  alignItems: "center",
  gap: 5,
};

const updateGroupBadgeStyle: React.CSSProperties = { width: 16, height: 16, display: "grid", placeItems: "center", color: "#64748b", fontSize: 10, fontWeight: 850 };
const updateGroupLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 };
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
