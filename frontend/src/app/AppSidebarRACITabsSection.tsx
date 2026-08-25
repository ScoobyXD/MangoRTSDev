import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../icons/index.js";
import { getExplorerDropIntent } from "../modules/company-explorer/companyExplorerDragDrop.js";
import { logicGateRACIRaisedSurfaceStyle } from "../modules/logic-gates/raciPresentation.js";
import { subscribeCommittedEntityTitleUpdates } from "../modules/realtime/committedEntityTitleUpdates.js";
import { subscribeRealtimeScope } from "../modules/realtime/realtimeWebSocket.js";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  logicGateIDFromKanbanBoardID,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
} from "../modules/kanban/shared.js";
import { SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS } from "./sidebarLogicGateStatusCounts.js";
import {
  addRACITabStatusCounts,
  buildVisibleRACITabRows,
  planRACITabDrop,
  raciTabBranchKey,
  raciTabRowKey,
  raciTabRowRef,
  RACI_TAB_LABELS,
  RACI_TAB_ROLES,
  resolveRACITabSelection,
  subtractRACITabStatusCounts,
  type RACITabBranch,
  type RACITabEntryRef,
  type RACITabFolder,
  type RACITabRole,
  type RACITabRow,
  type RACITabStatusCounts,
} from "./raciTabs.js";
import {
  applyRACITabLayout,
  createRACITabFolder,
  deleteRACITabFolder,
  fetchRACITabBranch,
  fetchRACITabLogicGateCounts,
  renameRACITabFolder,
} from "./raciTabsApi.js";

type Props = {
  apiBase: string;
  companyID: string;
  onOpenLogicGate: (logicGateID: string, name: string) => void;
};

type ActiveDrag = { role: RACITabRole; entries: RACITabEntryRef[] };
type DropTarget = { key: string; placement: "inside" | "before" | "after" };
type BranchRef = { role: RACITabRole; parentFolderID: string };

export function AppSidebarRACITabsSection({ apiBase, companyID, onOpenLogicGate }: Props): React.ReactElement {
  const [expandedRoles, setExpandedRoles] = useState<Set<RACITabRole>>(new Set());
  const [expandedFolderIDs, setExpandedFolderIDs] = useState<Set<string>>(new Set());
  const [branches, setBranches] = useState<Record<string, RACITabBranch | undefined>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectionAnchorKey, setSelectionAnchorKey] = useState("");
  const [raisedRowKey, setRaisedRowKey] = useState("");
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder: RACITabFolder } | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const branchesRef = useRef(branches);
  const expandedRolesRef = useRef(expandedRoles);
  const expandedFolderIDsRef = useRef(expandedFolderIDs);
  const loadingKeysRef = useRef(loadingKeys);
  const boardSubscriptionByLogicGateIDRef = useRef(new Map<string, () => void>());
  const trackedLogicGateIDsRef = useRef(new Set<string>());
  const refreshLogicGateCountsRef = useRef<(logicGateID: string) => void>(() => undefined);
  branchesRef.current = branches;
  expandedRolesRef.current = expandedRoles;
  expandedFolderIDsRef.current = expandedFolderIDs;
  loadingKeysRef.current = loadingKeys;

  useEffect(() => {
    expandedRolesRef.current = new Set();
    expandedFolderIDsRef.current = new Set();
    branchesRef.current = {};
    loadingKeysRef.current = new Set();
    setExpandedRoles(new Set());
    setExpandedFolderIDs(new Set());
    setBranches({});
    setLoadingKeys(new Set());
    setErrors({});
    setSelectedKeys(new Set());
    setSelectionAnchorKey("");
    setRaisedRowKey("");
  }, [companyID]);

  const loadedLogicGateIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const branch of Object.values(branches)) {
      for (const row of branch?.rows ?? []) if (row.rowKind === "item") ids.add(row.item.logicGateID);
    }
    return [...ids].sort();
  }, [branches]);
  const loadedLogicGateIDKey = loadedLogicGateIDs.join("\u0000");

  const updateBranches = (updater: (current: Record<string, RACITabBranch | undefined>) => Record<string, RACITabBranch | undefined>) => {
    setBranches((current) => {
      const next = updater(current);
      branchesRef.current = next;
      return next;
    });
  };

  const branchIsVisible = (role: RACITabRole, parentFolderID: string, current = branchesRef.current): boolean => {
    if (!expandedRolesRef.current.has(role)) return false;
    if (!parentFolderID) return true;
    if (!expandedFolderIDsRef.current.has(parentFolderID)) return false;
    return buildVisibleRACITabRows(role, current, expandedFolderIDsRef.current)
      .some(({ row }) => row.rowKind === "folder" && row.folder.folderID === parentFolderID);
  };

  const visibleBranchRefs = (role?: RACITabRole): BranchRef[] => {
    const refs: BranchRef[] = [];
    for (const currentRole of RACI_TAB_ROLES) {
      if (role && currentRole !== role) continue;
      if (!expandedRolesRef.current.has(currentRole)) continue;
      refs.push({ role: currentRole, parentFolderID: "" });
      for (const { row } of buildVisibleRACITabRows(currentRole, branchesRef.current, expandedFolderIDsRef.current)) {
        if (row.rowKind === "folder" && expandedFolderIDsRef.current.has(row.folder.folderID)) {
          refs.push({ role: currentRole, parentFolderID: row.folder.folderID });
        }
      }
    }
    return refs;
  };

  const refreshBranches = async (refs: BranchRef[]): Promise<void> => {
    const unique = [...new Map(refs.map((ref) => [raciTabBranchKey(ref.role, ref.parentFolderID), ref])).values()]
      .filter((ref) => branchIsVisible(ref.role, ref.parentFolderID));
    const pages = await Promise.all(unique.map(async (ref) => ({
      ref,
      page: await fetchRACITabBranch(apiBase, companyID, ref.role, ref.parentFolderID).catch(() => null),
    })));
    updateBranches((current) => {
      const next = { ...current };
      for (const { ref, page } of pages) {
        if (page && branchIsVisible(ref.role, ref.parentFolderID, current)) next[raciTabBranchKey(ref.role, ref.parentFolderID)] = page;
      }
      return next;
    });
  };

  const refreshVisibleBranches = async (): Promise<void> => {
    const refs = visibleBranchRefs();
    const visibleKeys = new Set(refs.map((ref) => raciTabBranchKey(ref.role, ref.parentFolderID)));
    updateBranches((current) => Object.fromEntries(Object.entries(current).filter(([key]) => visibleKeys.has(key))));
    await refreshBranches(refs);
  };

  const loadBranch = async (role: RACITabRole, parentFolderID: string, append = false): Promise<void> => {
    const key = raciTabBranchKey(role, parentFolderID);
    if (loadingKeysRef.current.has(key)) return;
    const cursor = append ? branchesRef.current[key]?.nextCursor ?? "" : "";
    if (append && !cursor) return;
    loadingKeysRef.current = new Set(loadingKeysRef.current).add(key);
    setLoadingKeys((current) => new Set(current).add(key));
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      const page = await fetchRACITabBranch(apiBase, companyID, role, parentFolderID, cursor);
      updateBranches((current) => {
        if (!branchIsVisible(role, parentFolderID, current)) return current;
        const previous = current[key];
        return {
          ...current,
          [key]: append && previous ? { ...page, rows: dedupeRows([...previous.rows, ...page.rows]) } : page,
        };
      });
    } catch (cause) {
      setErrors((current) => ({ ...current, [key]: cause instanceof Error ? cause.message : "Unable to load" }));
    } finally {
      const nextLoading = new Set(loadingKeysRef.current);
      nextLoading.delete(key);
      loadingKeysRef.current = nextLoading;
      setLoadingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleRole = (role: RACITabRole) => {
    const opening = !expandedRolesRef.current.has(role);
    const nextRoles = new Set(expandedRolesRef.current);
    if (opening) nextRoles.add(role);
    else nextRoles.delete(role);
    expandedRolesRef.current = nextRoles;
    setExpandedRoles(nextRoles);
    if (opening) {
      void loadBranch(role, "");
      return;
    }
    const roleFolderIDs = new Set<string>();
    for (const branch of Object.values(branchesRef.current)) {
      if (branch?.role !== role) continue;
      for (const row of branch.rows) if (row.rowKind === "folder") roleFolderIDs.add(row.folder.folderID);
    }
    setExpandedFolderIDs((current) => {
      const next = new Set([...current].filter((folderID) => !roleFolderIDs.has(folderID)));
      expandedFolderIDsRef.current = next;
      return next;
    });
    updateBranches((current) => Object.fromEntries(Object.entries(current).filter(([, branch]) => branch?.role !== role)));
  };

  const toggleFolder = (folder: RACITabFolder) => {
    const opening = !expandedFolderIDsRef.current.has(folder.folderID);
    const nextFolders = new Set(expandedFolderIDsRef.current);
    if (opening) nextFolders.add(folder.folderID);
    else nextFolders.delete(folder.folderID);
    expandedFolderIDsRef.current = nextFolders;
    setExpandedFolderIDs(nextFolders);
    if (opening) {
      void loadBranch(folder.role, folder.folderID);
      return;
    }
    const closing = new Set([folder.folderID]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const branch of Object.values(branchesRef.current)) {
        if (!branch || !closing.has(branch.parentFolderID)) continue;
        for (const row of branch.rows) if (row.rowKind === "folder" && !closing.has(row.folder.folderID)) {
          closing.add(row.folder.folderID);
          changed = true;
        }
      }
    }
    setExpandedFolderIDs((current) => {
      const next = new Set([...current].filter((folderID) => !closing.has(folderID)));
      expandedFolderIDsRef.current = next;
      return next;
    });
    updateBranches((current) => Object.fromEntries(Object.entries(current).filter(([, branch]) => !branch || !closing.has(branch.parentFolderID))));
  };

  const patchLogicGateCounts = (logicGateID: string, nextCounts: RACITabStatusCounts) => {
    setBranches((current) => {
      let oldCounts: RACITabStatusCounts | null = null;
      let role: RACITabRole | null = null;
      let folderID = "";
      const parentByFolderID = new Map<string, string>();
      for (const branch of Object.values(current)) {
        for (const row of branch?.rows ?? []) {
          if (row.rowKind === "folder") parentByFolderID.set(row.folder.folderID, row.folder.parentFolderID);
          if (row.rowKind === "item" && row.item.logicGateID === logicGateID) {
            oldCounts = row.item.statusCounts;
            role = row.item.role;
            folderID = row.item.folderID;
          }
        }
      }
      if (!oldCounts || !role) return current;
      const delta = subtractRACITabStatusCounts(nextCounts, oldCounts);
      const ancestors = new Set<string>();
      for (let currentFolderID = folderID; currentFolderID && !ancestors.has(currentFolderID); currentFolderID = parentByFolderID.get(currentFolderID) ?? "") {
        ancestors.add(currentFolderID);
      }
      const next = { ...current };
      for (const [key, branch] of Object.entries(current)) {
        if (!branch || branch.role !== role) continue;
        next[key] = {
          ...branch,
          statusCounts: branch.parentFolderID === "" ? addRACITabStatusCounts(branch.statusCounts, delta) : branch.statusCounts,
          rows: branch.rows.map((row) => {
            if (row.rowKind === "item" && row.item.logicGateID === logicGateID) return { ...row, item: { ...row.item, statusCounts: nextCounts } };
            if (row.rowKind === "folder" && ancestors.has(row.folder.folderID)) {
              return { ...row, folder: { ...row.folder, statusCounts: addRACITabStatusCounts(row.folder.statusCounts, delta) } };
            }
            return row;
          }),
        };
      }
      return next;
    });
  };

  refreshLogicGateCountsRef.current = (logicGateID: string) => {
    if (!trackedLogicGateIDsRef.current.has(logicGateID)) return;
    void fetchRACITabLogicGateCounts(apiBase, companyID, logicGateID).then(
      (counts) => patchLogicGateCounts(logicGateID, counts),
      () => undefined,
    );
  };

  useEffect(() => {
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<KanbanBoardContentsUpdatedDetail>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      const boardID = detail?.boardID?.trim() ?? "";
      const logicGateID = detail?.logicGateID?.trim() || logicGateIDFromKanbanBoardID(boardID);
      if (logicGateID) refreshLogicGateCountsRef.current(logicGateID);
    };
    window.addEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, onLocalChange);
    return () => {
      window.removeEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, onLocalChange);
      for (const unsubscribe of boardSubscriptionByLogicGateIDRef.current.values()) unsubscribe();
      boardSubscriptionByLogicGateIDRef.current.clear();
      trackedLogicGateIDsRef.current.clear();
    };
  }, [apiBase, companyID]);

  useEffect(() => {
    const nextLogicGateIDs = new Set(loadedLogicGateIDs);
    trackedLogicGateIDsRef.current = nextLogicGateIDs;
    for (const [logicGateID, unsubscribe] of boardSubscriptionByLogicGateIDRef.current) {
      if (nextLogicGateIDs.has(logicGateID)) continue;
      unsubscribe();
      boardSubscriptionByLogicGateIDRef.current.delete(logicGateID);
    }
    if (!companyID) return;
    for (const logicGateID of loadedLogicGateIDs) {
      if (boardSubscriptionByLogicGateIDRef.current.has(logicGateID)) continue;
      const boardID = logicGateKanbanBoardID(logicGateID);
      const unsubscribe = subscribeRealtimeScope(apiBase, companyID, `board:${boardID}`, {
        onRecover: () => refreshLogicGateCountsRef.current(logicGateID),
        onKanbanChanged: (message) => {
          if (message.company_id === companyID && message.board_id === boardID) refreshLogicGateCountsRef.current(logicGateID);
        },
      });
      boardSubscriptionByLogicGateIDRef.current.set(logicGateID, unsubscribe);
    }
  }, [apiBase, companyID, loadedLogicGateIDKey]);

  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID || update.entityType !== "logic_gate" || !update.title.trim()) return;
    setBranches((current) => Object.fromEntries(Object.entries(current).map(([key, branch]) => [key, branch ? {
      ...branch,
      rows: branch.rows.map((row) => row.rowKind === "item" && row.item.logicGateID === update.resourceID
        ? { ...row, item: { ...row.item, name: update.title.trim() } }
        : row),
    } : branch])));
  }), [companyID]);

  useEffect(() => {
    if (!companyID) return;
    return subscribeRealtimeScope(apiBase, companyID, "raci-tabs:company", {
      onRecover: refreshVisibleBranches,
      onRACITabsChanged: (message) => {
        if (message.company_id === companyID) void refreshVisibleBranches();
      },
    });
  }, [apiBase, companyID]);

  const reportMutationError = (role: RACITabRole, cause: unknown) => {
    const key = raciTabBranchKey(role, "");
    setErrors((current) => ({ ...current, [key]: cause instanceof Error ? cause.message : "Unable to update RACI Tabs" }));
  };

  const executeDrop = async (role: RACITabRole, target: RACITabEntryRef | null, placement: "inside" | "before" | "after") => {
    const active = activeDragRef.current;
    if (!active || active.role !== role || busy) return;
    setBusy(true);
    const sourceParents = new Set<string>();
    try {
      const workingBranches = { ...branchesRef.current };
      const parentForEntry = (entry: RACITabEntryRef): string => {
        const key = `${entry.entryType}:${entry.entryID}`;
        for (const branch of Object.values(workingBranches)) {
          if (branch?.role === role && branch.rows.some((row) => raciTabRowKey(row) === key)) return branch.parentFolderID;
        }
        return "";
      };
      active.entries.forEach((entry) => sourceParents.add(parentForEntry(entry)));
      const updates = planRACITabDrop(role, workingBranches, active.entries, target, placement);
      if (updates.length === 0) return;
      const movingKeys = new Set(active.entries.map((entry) => `${entry.entryType}:${entry.entryID}`));
      updateBranches((current) => Object.fromEntries(Object.entries(current).map(([key, branch]) => [key, branch ? {
        ...branch,
        rows: branch.rows.filter((row) => !movingKeys.has(raciTabRowKey(row))),
      } : branch])));
      await applyRACITabLayout(apiBase, companyID, role, updates);
      await refreshBranches(visibleBranchRefs(role));
      setSelectedKeys(new Set(active.entries.map((entry) => `${entry.entryType}:${entry.entryID}`)));
    } catch (cause) {
      reportMutationError(role, cause);
      await refreshBranches([...sourceParents].map((parentFolderID) => ({ role, parentFolderID })));
    } finally {
      activeDragRef.current = null;
      setDropTarget(null);
      setBusy(false);
    }
  };

  const createFolder = async (role: RACITabRole, parentFolderID: string) => {
    const name = window.prompt("Folder name", "New Folder")?.trim() ?? "";
    if (!name) return;
    setBusy(true);
    try {
      const folder = await createRACITabFolder(apiBase, companyID, role, parentFolderID, name);
      const key = raciTabBranchKey(role, parentFolderID);
      setBranches((current) => ({ ...current, [key]: current[key] ? { ...current[key]!, rows: sortRows([...current[key]!.rows, { rowKind: "folder", folder }]) } : current[key] }));
    } catch (cause) {
      reportMutationError(role, cause);
    } finally {
      setBusy(false);
    }
  };

  const renameFolder = async (folder: RACITabFolder) => {
    const name = window.prompt("Folder name", folder.name)?.trim() ?? "";
    if (!name || name === folder.name) return;
    setBusy(true);
    try {
      const updated = await renameRACITabFolder(apiBase, companyID, folder.folderID, name);
      setBranches((current) => Object.fromEntries(Object.entries(current).map(([key, branch]) => [key, branch ? {
        ...branch,
        rows: branch.rows.map((row) => row.rowKind === "folder" && row.folder.folderID === folder.folderID ? { ...row, folder: updated } : row),
      } : branch])));
    } catch (cause) {
      reportMutationError(folder.role, cause);
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (folder: RACITabFolder) => {
    if (!window.confirm(`Delete ${folder.name}? Its Processes will move to the ${RACI_TAB_LABELS[folder.role]} root.`)) return;
    setBusy(true);
    try {
      await deleteRACITabFolder(apiBase, companyID, folder.folderID);
      setExpandedFolderIDs((current) => {
        const next = new Set(current);
        next.delete(folder.folderID);
        expandedFolderIDsRef.current = next;
        return next;
      });
      updateBranches((current) => Object.fromEntries(Object.entries(current).filter(([, branch]) => branch?.parentFolderID !== folder.folderID)));
      await refreshBranches(visibleBranchRefs(folder.role));
    } catch (cause) {
      reportMutationError(folder.role, cause);
    } finally {
      setBusy(false);
    }
  };

  const startDrag = (role: RACITabRole, row: RACITabRow, event: React.DragEvent<HTMLElement>) => {
    const rowRef = raciTabRowRef(row);
    let entries = [rowRef];
    if (row.rowKind === "item" && selectedKeys.has(raciTabRowKey(row))) {
      entries = buildVisibleRACITabRows(role, branches, expandedFolderIDs)
        .filter((visible) => visible.row.rowKind === "item" && selectedKeys.has(visible.key))
        .map((visible) => raciTabRowRef(visible.row));
    }
    activeDragRef.current = { role, entries };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-mangorts-raci-tab-entry", JSON.stringify({ role, entries }));
  };

  const selectRow = (role: RACITabRole, row: RACITabRow, event: React.MouseEvent) => {
    const visibleKeys = buildVisibleRACITabRows(role, branches, expandedFolderIDs).map((visible) => visible.key);
    const result = resolveRACITabSelection(visibleKeys, selectedKeys, selectionAnchorKey, raciTabRowKey(row), {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
    setSelectedKeys(result.selectedKeys);
    setSelectionAnchorKey(result.anchorKey);
    if (row.rowKind === "item" && !event.ctrlKey && !event.metaKey && !event.shiftKey) onOpenLogicGate(row.item.logicGateID, row.item.name);
  };

  const renderRows = (role: RACITabRole, parentFolderID: string, depth: number): React.ReactNode => {
    const key = raciTabBranchKey(role, parentFolderID);
    const branch = branches[key];
    if (!branch) return loadingKeys.has(key) ? <div style={messageStyle}>Loading…</div> : null;
    return (
      <>
        {branch.rows.map((row) => {
          const rowKey = raciTabRowKey(row);
          const selected = selectedKeys.has(rowKey);
          const raised = selected || raisedRowKey === rowKey;
          const placement = dropTarget?.key === rowKey ? dropTarget.placement : null;
          const folder = row.rowKind === "folder" ? row.folder : null;
          const expanded = !!folder && expandedFolderIDs.has(folder.folderID);
          const targetRef = raciTabRowRef(row);
          return (
            <React.Fragment key={rowKey}>
              <div
                data-raci-tab-row={rowKey}
                data-selected={selected ? "true" : undefined}
                draggable={!busy}
                style={rowContainerStyle(depth, selected, raised, placement)}
                onMouseEnter={() => setRaisedRowKey(rowKey)}
                onMouseLeave={() => setRaisedRowKey((current) => current === rowKey ? "" : current)}
                onFocus={() => setRaisedRowKey(rowKey)}
                onBlur={() => setRaisedRowKey((current) => current === rowKey ? "" : current)}
                onClick={(event) => selectRow(role, row, event)}
                onContextMenu={(event) => {
                  if (!folder) return;
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY, folder });
                }}
                onDragStart={(event) => startDrag(role, row, event)}
                onDragEnd={() => { activeDragRef.current = null; setDropTarget(null); }}
                onDragOver={(event) => {
                  if (!activeDragRef.current || activeDragRef.current.role !== role) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const raw = getExplorerDropIntent(event, event.currentTarget);
                  const nextPlacement = raw === "inside" && row.rowKind === "item" ? "after" : raw;
                  setDropTarget({ key: rowKey, placement: nextPlacement });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void executeDrop(role, targetRef, placement ?? (folder ? "inside" : "after"));
                }}
              >
                <button
                  type="button"
                  aria-label={row.rowKind === "folder" ? (expanded ? `Collapse ${row.folder.name}` : `Expand ${row.folder.name}`) : `Open ${row.item.name}`}
                  style={rowButtonStyle}
                  onClick={() => {
                    if (!folder) return;
                    toggleFolder(folder);
                  }}
                >
                  <span style={disclosureSlotStyle}>{folder ? <ExplorerDisclosureIcon open={expanded} color="#475569" /> : null}</span>
                  <ExplorerRowIcon kind={folder ? "folder" : "logic_gate"} />
                  <span style={rowNameStyle}>{row.rowKind === "folder" ? row.folder.name : row.item.name}</span>
                </button>
                {renderCounts(row.rowKind === "folder" ? row.folder.statusCounts : row.item.statusCounts)}
                <span style={actionSlotStyle}>{folder ? "⋯" : ""}</span>
              </div>
              {folder && expanded && <div>{renderRows(role, folder.folderID, depth + 1)}</div>}
            </React.Fragment>
          );
        })}
        {branch.nextCursor && (
          <button type="button" style={loadMoreStyle} disabled={loadingKeys.has(key)} onClick={() => void loadBranch(role, parentFolderID, true)}>
            {loadingKeys.has(key) ? "Loading…" : "Load more"}
          </button>
        )}
        {errors[key] && <div role="alert" style={errorStyle}>{errors[key]}</div>}
      </>
    );
  };

  return (
    <div data-sidebar-raci-tabs="true" style={towerStyle}>
      {RACI_TAB_ROLES.map((role) => {
        const expanded = expandedRoles.has(role);
        const root = branches[raciTabBranchKey(role, "")];
        return (
          <div key={role} style={roleWrapStyle}>
            <div style={roleHeaderStyle(expanded)}>
              <button type="button" aria-expanded={expanded} style={roleToggleStyle} onClick={() => toggleRole(role)}>
                <ExplorerDisclosureIcon open={expanded} color="#334155" />
                <span data-raci-tab-role-label={role} style={roleLabelStyle(role)}>{RACI_TAB_LABELS[role]}</span>
              </button>
              {root ? renderCounts(root.statusCounts) : <span />}
              <button type="button" aria-label={`Create ${RACI_TAB_LABELS[role]} folder`} disabled={busy} style={addFolderStyle} onClick={() => void createFolder(role, "")}>+</button>
            </div>
            {expanded && (
              <div
                data-raci-tab-surface={role}
                style={roleSurfaceStyle}
                onDragOver={(event) => {
                  if (!activeDragRef.current || activeDragRef.current.role !== role) return;
                  event.preventDefault();
                  setDropTarget({ key: `${role}:root-end`, placement: "after" });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void executeDrop(role, null, "after");
                }}
              >
                {renderRows(role, "", 0)}
                {!root && loadingKeys.has(raciTabBranchKey(role, "")) && <div style={messageStyle}>Loading…</div>}
                {root && root.rows.length === 0 && !loadingKeys.has(raciTabBranchKey(role, "")) && <div style={messageStyle}>No Processes</div>}
              </div>
            )}
          </div>
        );
      })}
      {contextMenu && (
        <div role="menu" aria-label="RACI folder actions" style={contextMenuStyle(contextMenu.x, contextMenu.y)} onMouseLeave={() => setContextMenu(null)}>
          <button type="button" style={menuButtonStyle} onClick={() => { const folder = contextMenu.folder; setContextMenu(null); void createFolder(folder.role, folder.folderID); }}>Create folder inside</button>
          <button type="button" style={menuButtonStyle} onClick={() => { const folder = contextMenu.folder; setContextMenu(null); void renameFolder(folder); }}>Rename</button>
          <button type="button" style={{ ...menuButtonStyle, color: "#dc2626" }} onClick={() => { const folder = contextMenu.folder; setContextMenu(null); void removeFolder(folder); }}>Delete folder</button>
        </div>
      )}
    </div>
  );
}

function dedupeRows(rows: RACITabRow[]): RACITabRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = raciTabRowKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortRows(rows: RACITabRow[]): RACITabRow[] {
  return [...rows].sort((left, right) => {
    const a = left.rowKind === "folder" ? left.folder : left.item;
    const b = right.rowKind === "folder" ? right.folder : right.item;
    return a.position - b.position || a.createdTimestamp.localeCompare(b.createdTimestamp) || a.name.localeCompare(b.name) || left.rowKind.localeCompare(right.rowKind) || raciTabRowKey(left).localeCompare(raciTabRowKey(right));
  });
}

function renderCounts(counts: RACITabStatusCounts): React.ReactElement {
  const values = { request: counts.request, pending: counts.pending, inProgress: counts.inProgress, review: counts.review };
  return (
    <span style={statusGridStyle}>
      {SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS.map((definition) => (
        <span key={definition.key} style={statusSlotStyle}>
          {values[definition.key] > 0 && <span title={`${definition.label}: ${values[definition.key]}`} style={statusSquareStyle(definition)}>{values[definition.key]}</span>}
        </span>
      ))}
    </span>
  );
}

const towerStyle: React.CSSProperties = { display: "grid", gap: 4, minWidth: 0, marginBottom: 8 };
const roleWrapStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 3 };
function roleHeaderStyle(expanded: boolean): React.CSSProperties {
  return { width: "100%", minHeight: 31, display: "grid", gridTemplateColumns: "minmax(0,1fr) 74px 22px", alignItems: "center", gap: 2, boxSizing: "border-box", border: "1px solid rgba(148,163,184,.24)", borderRadius: 8, background: expanded ? "rgba(255,255,255,.88)" : "linear-gradient(145deg,#fff,#f6f7fb)", color: "#111827", padding: "0 5px", fontSize: 11.5, fontWeight: 750 };
}
const roleToggleStyle: React.CSSProperties = { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "15px minmax(0,1fr)", alignItems: "center", gap: 5, border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 0, textAlign: "left", fontSize: "inherit", fontWeight: "inherit" };
function roleLabelStyle(role: RACITabRole): React.CSSProperties {
  return { ...logicGateRACIRaisedSurfaceStyle(role), justifySelf: "start", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRadius: 4, color: "#111827", padding: "2px 6px" };
}
const roleSurfaceStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 3, padding: "6px 5px 7px", border: "1px solid rgba(148,163,184,.24)", borderRadius: 10, background: "linear-gradient(145deg,rgba(255,255,255,.94),rgba(248,250,252,.82))", boxShadow: "4px 5px 14px rgba(148,163,184,.2),-3px -3px 10px rgba(255,255,255,.82),inset 1px 1px 0 rgba(255,255,255,.76)" };
const addFolderStyle: React.CSSProperties = { width: 22, height: 22, border: "1px solid rgba(100,116,139,.25)", borderRadius: 5, background: "rgba(255,255,255,.74)", color: "#334155", cursor: "pointer" };
function rowContainerStyle(depth: number, selected: boolean, raised: boolean, placement: DropTarget["placement"] | null): React.CSSProperties {
  return { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "minmax(0,1fr) 74px 22px", alignItems: "center", gap: 2, marginLeft: depth * 10, borderRadius: 7, background: selected ? "rgba(14,165,233,.09)" : placement === "inside" ? "rgba(14,165,233,.06)" : raised ? "rgba(255,255,255,.72)" : "transparent", boxShadow: placement === "before" ? "inset 0 2px 0 rgba(71,85,105,.66)" : placement === "after" ? "inset 0 -2px 0 rgba(71,85,105,.66)" : raised ? "0 5px 12px rgba(100,116,139,.18),0 1px 3px rgba(15,23,42,.08)" : "none", transform: raised ? "translateY(-2px)" : "translateY(0)", transition: "background 120ms ease,box-shadow 140ms ease,transform 120ms ease", cursor: "grab" };
}
const rowButtonStyle: React.CSSProperties = { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "13px 18px minmax(0,1fr)", alignItems: "center", gap: 3, border: 0, background: "transparent", color: "#111827", cursor: "pointer", padding: "0 3px", textAlign: "left", fontSize: 11.5, fontWeight: 650 };
const disclosureSlotStyle: React.CSSProperties = { width: 13, display: "grid", placeItems: "center" };
const rowNameStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const statusGridStyle: React.CSSProperties = { width: 74, minWidth: 74, display: "grid", gridTemplateColumns: "repeat(4,17px)", gap: 2, alignItems: "center" };
const statusSlotStyle: React.CSSProperties = { width: 17, height: 17, display: "grid", placeItems: "center" };
function statusSquareStyle(definition: typeof SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS[number]): React.CSSProperties {
  return { width: 17, minWidth: 17, height: 17, boxSizing: "border-box", display: "grid", placeItems: "center", border: `1px solid ${definition.borderColor}`, borderRadius: 4, backgroundColor: definition.color, backgroundImage: definition.gradient, color: definition.textColor, boxShadow: `0 3px 8px ${definition.glowColor},inset 0 1px 0 rgba(255,255,255,.68)`, fontSize: 9.5, fontWeight: 850, lineHeight: 1 };
}
const actionSlotStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", color: "#64748b", fontWeight: 800 };
const loadMoreStyle: React.CSSProperties = { minHeight: 24, border: 0, background: "transparent", color: "#0369a1", cursor: "pointer", fontSize: 10.5, fontWeight: 700 };
const messageStyle: React.CSSProperties = { minHeight: 28, display: "grid", placeItems: "center", color: "rgba(15,23,42,.5)", fontSize: 10.5, fontWeight: 600 };
const errorStyle: React.CSSProperties = { padding: "4px 6px", color: "#b91c1c", fontSize: 10.5, fontWeight: 650 };
function contextMenuStyle(x: number, y: number): React.CSSProperties { return { position: "fixed", left: x, top: y, zIndex: 10000, width: 158, padding: "5px 0", border: "1px solid rgba(100,116,139,.28)", borderRadius: 8, background: "rgba(255,255,255,.98)", boxShadow: "0 12px 30px rgba(15,23,42,.2)" }; }
const menuButtonStyle: React.CSSProperties = { width: "100%", minHeight: 31, border: 0, background: "transparent", color: "#111827", cursor: "pointer", textAlign: "left", padding: "0 12px", fontSize: 12, fontWeight: 600 };
