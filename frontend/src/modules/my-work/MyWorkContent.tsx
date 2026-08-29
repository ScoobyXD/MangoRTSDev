import React, { useEffect, useMemo, useState } from "react";
import {
  ActionItemIcon,
  ExplorerEntityIcon,
  HeaderMyWorkIcon,
  StaggeredGroupingIcon,
} from "../../icons/index.js";
import type { BoundRequestJSON } from "../api/requestJSON.js";
import {
  editorEntityLinkAnchorBounds,
  openEditorEntityLink,
} from "../editor/editorEntityLinks.js";
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import {
  buildUniversalNestedGroups,
  type UniversalNestedGroup,
} from "../grouping/universalGrouping.js";
import type {
  MyWorkActionItem,
  MyWorkNode,
  MyWorkProcess,
  MyWorkProcessRole,
  MyWorkProject,
  MyWorkSection,
} from "./myWorkApi.js";
import {
  DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS,
  DEFAULT_MY_WORK_NODE_GROUPINGS,
  MY_WORK_ACTION_ITEM_GROUPING_FIELDS,
  MY_WORK_NODE_GROUPING_FIELDS,
  myWorkActionItemGroupingAdapter,
  myWorkNodeGroupingAdapter,
  normalizeMyWorkActionItemGroupings,
  normalizeMyWorkNodeGroupings,
  sortActionItems,
  sortNodes,
  sortProcesses,
  sortProjects,
  type MyWorkActionItemGrouping,
  type MyWorkNodeGrouping,
} from "./myWorkGrouping.js";
import { useMyWorkData, type MyWorkSectionState } from "./useMyWorkData.js";

export type MyWorkContentProps = {
  companyID: string;
  requestJSON: BoundRequestJSON;
};

const PROCESS_ROLE_OPTIONS: ReadonlyArray<{ role: MyWorkProcessRole; letter: string; label: string }> = [
  { role: "responsible", letter: "R", label: "Responsible" },
  { role: "accountable", letter: "A", label: "Accountable" },
  { role: "consulted", letter: "C", label: "Consulted" },
  { role: "informed", letter: "I", label: "Informed" },
];

export function MyWorkContent({ companyID, requestJSON }: MyWorkContentProps) {
  const {
    state,
    processRole,
    reloadSection,
    nextPage,
    previousPage,
    selectProcessRole,
  } = useMyWorkData(companyID, requestJSON);
  const [actionItemGroupings, setActionItemGroupings] = useState<MyWorkActionItemGrouping[]>(() => (
    DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => ({ ...grouping }))
  ));
  const [nodeGroupings, setNodeGroupings] = useState<MyWorkNodeGrouping[]>(() => (
    DEFAULT_MY_WORK_NODE_GROUPINGS.map((grouping) => ({ ...grouping }))
  ));

  useEffect(() => {
    setActionItemGroupings(DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => ({ ...grouping })));
    setNodeGroupings(DEFAULT_MY_WORK_NODE_GROUPINGS.map((grouping) => ({ ...grouping })));
  }, [companyID]);

  const actionItemGroups = useMemo(() => buildUniversalNestedGroups(
    state.action_items.items,
    actionItemGroupings,
    myWorkActionItemGroupingAdapter,
  ), [actionItemGroupings, state.action_items.items]);
  const nodeGroups = useMemo(() => buildUniversalNestedGroups(
    state.nodes.items,
    nodeGroupings,
    myWorkNodeGroupingAdapter,
  ), [nodeGroupings, state.nodes.items]);

  const changeActionItemGroupings = (next: MyWorkActionItemGrouping[]) => {
    const normalized = normalizeMyWorkActionItemGroupings(next);
    setActionItemGroupings(normalized);
    void reloadSection("action_items", normalized, true);
  };
  const changeNodeGroupings = (next: MyWorkNodeGrouping[]) => {
    const normalized = normalizeMyWorkNodeGroupings(next);
    setNodeGroupings(normalized);
    void reloadSection("nodes", normalized, true);
  };

  return (
    <div data-my-work-page="true" style={pageStyle}>
      <header style={pageHeaderStyle}>
        <span style={pageHeaderIconStyle}><HeaderMyWorkIcon color="#2563eb" /></span>
        <h1 style={pageTitleStyle}>My Work</h1>
      </header>

      <div style={columnsStyle}>
        <div style={leftColumnStyle}>
          <SectionFrame
            section="action_items"
            title="Action Items"
            state={state.action_items}
            actions={(
              <UniversalGroupingControls
                groupings={actionItemGroupings}
                fieldOptions={MY_WORK_ACTION_ITEM_GROUPING_FIELDS}
                onChange={changeActionItemGroupings}
                buttonLabel="Group Action Items"
                popoverLabel="Action Item grouping"
                popoverAlign="start"
                triggerIcon={<StaggeredGroupingIcon />}
                iconOnly
                disabled={state.action_items.loading}
              />
            )}
            onRetry={() => void reloadSection("action_items", actionItemGroupings)}
            onPrevious={() => void previousPage("action_items", actionItemGroupings)}
            onNext={() => void nextPage("action_items", actionItemGroupings)}
          >
            <GroupedRows
              groups={actionItemGroups}
              ungroupedRows={sortActionItems(state.action_items.items)}
              groupings={actionItemGroupings}
              emptyLabel="No Action Items assigned to you."
              renderRow={(item) => <ActionItemRow key={item.entity_id} item={item} />}
            />
          </SectionFrame>

          <SectionFrame
            section="nodes"
            title="Nodes"
            state={state.nodes}
            actions={(
              <UniversalGroupingControls
                groupings={nodeGroupings}
                fieldOptions={MY_WORK_NODE_GROUPING_FIELDS}
                onChange={changeNodeGroupings}
                buttonLabel="Group Nodes"
                popoverLabel="Node grouping"
                popoverAlign="start"
                triggerIcon={<StaggeredGroupingIcon />}
                iconOnly
                disabled={state.nodes.loading}
              />
            )}
            onRetry={() => void reloadSection("nodes", nodeGroupings)}
            onPrevious={() => void previousPage("nodes", nodeGroupings)}
            onNext={() => void nextPage("nodes", nodeGroupings)}
          >
            <GroupedRows
              groups={nodeGroups}
              ungroupedRows={sortNodes(state.nodes.items)}
              groupings={nodeGroupings}
              emptyLabel="No responsible Nodes."
              renderRow={(item) => <NodeRow key={item.node_id} item={item} />}
            />
          </SectionFrame>
        </div>

        <SectionFrame
          section="processes"
          title="Processes"
          state={state.processes}
          actions={(
            <div role="radiogroup" aria-label="Process RACI role" style={roleSelectorStyle}>
              {PROCESS_ROLE_OPTIONS.map((option, index) => (
                <button
                  key={option.role}
                  type="button"
                  role="radio"
                  aria-checked={processRole === option.role}
                  aria-label={option.label}
                  title={option.label}
                  tabIndex={processRole === option.role ? 0 : -1}
                  style={roleButtonStyle(processRole === option.role)}
                  onClick={() => void selectProcessRole(option.role)}
                  onKeyDown={(event) => {
                    const nextIndex = processRoleIndexForKey(event.key, index);
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const nextOption = PROCESS_ROLE_OPTIONS[nextIndex];
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]
                      ?.focus();
                    void selectProcessRole(nextOption.role);
                  }}
                >
                  {option.letter}
                </button>
              ))}
            </div>
          )}
          onRetry={() => void reloadSection("processes")}
          onPrevious={() => void previousPage("processes")}
          onNext={() => void nextPage("processes")}
        >
          <SimpleRows
            rows={sortProcesses(state.processes.items)}
            emptyLabel={`No ${PROCESS_ROLE_OPTIONS.find((option) => option.role === processRole)?.label ?? "matching"} Processes.`}
            renderRow={(process) => <ProcessRow key={process.logic_gate_id} process={process} />}
          />
        </SectionFrame>

        <SectionFrame
          section="projects"
          title="Projects"
          state={state.projects}
          onRetry={() => void reloadSection("projects")}
          onPrevious={() => void previousPage("projects")}
          onNext={() => void nextPage("projects")}
        >
          <SimpleRows
            rows={sortProjects(state.projects.items)}
            emptyLabel="No visible Projects assigned to your Project Teams."
            renderRow={(project) => <ProjectRow key={project.project_id} project={project} />}
          />
        </SectionFrame>
      </div>
    </div>
  );
}

export function processRoleIndexForKey(key: string, currentIndex: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return PROCESS_ROLE_OPTIONS.length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (currentIndex + 1) % PROCESS_ROLE_OPTIONS.length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (currentIndex - 1 + PROCESS_ROLE_OPTIONS.length) % PROCESS_ROLE_OPTIONS.length;
  return null;
}

type SectionFrameProps<Item> = {
  section: MyWorkSection;
  title: string;
  state: MyWorkSectionState<Item>;
  actions?: React.ReactNode;
  onRetry: () => void;
  onPrevious: () => void;
  onNext: () => void;
  children: React.ReactNode;
};

function SectionFrame<Item>({
  section,
  title,
  state,
  actions,
  onRetry,
  onPrevious,
  onNext,
  children,
}: SectionFrameProps<Item>) {
  const titleID = `my-work-${section}-title`;
  return (
    <section aria-labelledby={titleID} aria-busy={state.loading} data-my-work-section={section} style={sectionStyle(Boolean(state.error))}>
      <header style={sectionHeaderStyle}>
        <h2 id={titleID} style={sectionTitleStyle}>{title}</h2>
        {actions}
      </header>
      {state.error && (
        <div role="alert" style={errorStyle}>
          <span>{state.error}</span>
          <button type="button" style={smallButtonStyle} onClick={onRetry}>Retry</button>
        </div>
      )}
      <div style={sectionBodyStyle}>
        {state.loading && state.items.length === 0 ? <LoadingRows /> : children}
      </div>
      <footer style={sectionFooterStyle}>
        <span aria-live="polite" style={pageStatusStyle}>
          {state.loading ? "Loading" : `Page ${state.previousCursors.length + 1}`}
        </span>
        <div style={pagingButtonsStyle}>
          <button
            type="button"
            disabled={state.loading || state.previousCursors.length === 0}
            style={pagingButtonStyle(state.loading || state.previousCursors.length === 0)}
            onClick={onPrevious}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={state.loading || !state.hasMore || !state.nextCursor}
            style={pagingButtonStyle(state.loading || !state.hasMore || !state.nextCursor)}
            onClick={onNext}
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}

type GroupedRowsProps<Item, Field extends string> = {
  groups: Array<UniversalNestedGroup<Item, Field>>;
  ungroupedRows: Item[];
  groupings: ReadonlyArray<{ field: Field; direction: "asc" | "desc" }>;
  emptyLabel: string;
  renderRow: (item: Item) => React.ReactNode;
};

function GroupedRows<Item, Field extends string>({
  groups,
  ungroupedRows,
  groupings,
  emptyLabel,
  renderRow,
}: GroupedRowsProps<Item, Field>) {
  if (ungroupedRows.length === 0) return <EmptyState label={emptyLabel} />;
  if (groupings.length === 0) return <div style={rowListStyle}>{ungroupedRows.map(renderRow)}</div>;
  return <div style={groupListStyle}>{groups.map((group) => renderGroup(group, renderRow))}</div>;
}

function renderGroup<Item, Field extends string>(
  group: UniversalNestedGroup<Item, Field>,
  renderRow: (item: Item) => React.ReactNode,
): React.ReactNode {
  return (
    <div key={group.id} data-my-work-group={group.id} style={groupStyle(group.depth)}>
      <div style={groupHeaderStyle(group.depth)}>
        <span>{group.label}</span>
        <span aria-label={`${group.rows.length || nestedGroupRowCount(group)} items`} style={groupCountStyle}>
          {group.rows.length || nestedGroupRowCount(group)}
        </span>
      </div>
      {group.groups.length > 0
        ? group.groups.map((nested) => renderGroup(nested, renderRow))
        : <div style={rowListStyle}>{group.rows.map(renderRow)}</div>}
    </div>
  );
}

function nestedGroupRowCount<Item, Field extends string>(group: UniversalNestedGroup<Item, Field>): number {
  if (group.rows.length > 0) return group.rows.length;
  return group.groups.reduce((count, nested) => count + nestedGroupRowCount(nested), 0);
}

function SimpleRows<Item>({
  rows,
  emptyLabel,
  renderRow,
}: { rows: Item[]; emptyLabel: string; renderRow: (item: Item) => React.ReactNode }) {
  return rows.length > 0 ? <div style={rowListStyle}>{rows.map(renderRow)}</div> : <EmptyState label={emptyLabel} />;
}

function ActionItemRow({ item }: { item: MyWorkActionItem }) {
  const color = item.color?.trim().toLowerCase();
  return (
    <button
      type="button"
      data-my-work-target="action-item"
      style={resourceButtonStyle}
      onClick={(event) => openEditorEntityLink({
        entityType: "entity",
        entityID: item.entity_id,
        label: item.name,
        isActionItem: true,
      }, undefined, editorEntityLinkAnchorBounds(event.currentTarget))}
    >
      <span style={actionItemIconStyle(color)}><ActionItemIcon size={15} /></span>
      <span style={resourceNameStyle}>{item.name}</span>
    </button>
  );
}

function NodeRow({ item }: { item: MyWorkNode }) {
  return (
    <div data-my-work-row="node" style={nodeRowStyle}>
      <button
        type="button"
        data-my-work-target="node"
        style={nodePrimaryButtonStyle}
        onClick={() => openEditorEntityLink({ entityType: "node", entityID: item.node_id, label: item.name })}
      >
        <ExplorerEntityIcon kind="node" />
        <span style={resourceNameStyle}>{item.name}</span>
      </button>
      <div style={inlineContextStyle}>
        {item.process && (
          <button
            type="button"
            data-my-work-target="process"
            style={inlineContextButtonStyle("#047857")}
            onClick={() => openEditorEntityLink({
              entityType: "logic_gate",
              entityID: item.process!.logic_gate_id,
              label: item.process!.name,
            })}
          >
            <ExplorerEntityIcon kind="logic_gate" />
            <span style={inlineContextLabelStyle}>{item.process.name}</span>
          </button>
        )}
        {item.project && (
          <button
            type="button"
            data-my-work-target="project"
            style={inlineContextButtonStyle("#1d4ed8")}
            onClick={() => openEditorEntityLink({
              entityType: "project",
              entityID: item.project!.project_id,
              label: item.project!.name,
            })}
          >
            <ExplorerEntityIcon kind="project" />
            <span style={inlineContextLabelStyle}>{item.project.name}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ProcessRow({ process }: { process: MyWorkProcess }) {
  return (
    <button
      type="button"
      data-my-work-target="process"
      style={resourceButtonStyle}
      onClick={() => openEditorEntityLink({ entityType: "logic_gate", entityID: process.logic_gate_id, label: process.name })}
    >
      <ExplorerEntityIcon kind="logic_gate" />
      <span style={resourceNameStyle}>{process.name}</span>
    </button>
  );
}

function ProjectRow({ project }: { project: MyWorkProject }) {
  return (
    <button
      type="button"
      data-my-work-target="project"
      style={resourceButtonStyle}
      onClick={() => openEditorEntityLink({ entityType: "project", entityID: project.project_id, label: project.name })}
    >
      <ExplorerEntityIcon kind="project" />
      <span style={resourceNameStyle}>{project.name}</span>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div style={emptyStyle}>{label}</div>;
}

function LoadingRows() {
  return (
    <div aria-label="Loading My Work section" style={loadingStyle}>
      <span style={loadingLineStyle(82)} />
      <span style={loadingLineStyle(66)} />
      <span style={loadingLineStyle(74)} />
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "52px minmax(0, 1fr)",
  overflow: "hidden",
  background: "#f8fafc",
  color: "#0f172a",
};

const pageHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
  background: "rgba(255, 255, 255, 0.96)",
  padding: "0 16px",
};

const pageHeaderIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: 8,
  background: "#eff6ff",
};

const pageTitleStyle: React.CSSProperties = { margin: 0, fontSize: 17, fontWeight: 900, letterSpacing: -0.2 };

const columnsStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(390px, 1.25fr) minmax(270px, 0.9fr) minmax(270px, 0.9fr)",
  gap: 10,
  overflowX: "auto",
  overflowY: "hidden",
  padding: 10,
};

const leftColumnStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 10,
};

function sectionStyle(hasError: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: hasError ? "42px auto minmax(0, 1fr) 38px" : "42px minmax(0, 1fr) 38px",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 12,
    overflow: "hidden",
    background: "#ffffff",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.055)",
  };
}

const sectionHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  borderBottom: "1px solid rgba(148, 163, 184, 0.20)",
  padding: "0 10px 0 12px",
};

const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: 13, fontWeight: 900 };
const sectionBodyStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, overflow: "auto", padding: 8 };

const sectionFooterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  padding: "4px 8px",
};

const pageStatusStyle: React.CSSProperties = { color: "#64748b", fontSize: 10.5, fontWeight: 750 };
const pagingButtonsStyle: React.CSSProperties = { display: "flex", gap: 5 };

function pagingButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 26,
    border: "1px solid rgba(148, 163, 184, 0.3)",
    borderRadius: 6,
    background: "#ffffff",
    color: disabled ? "#cbd5e1" : "#334155",
    font: "inherit",
    fontSize: 10.5,
    fontWeight: 800,
    cursor: disabled ? "default" : "pointer",
    padding: "0 8px",
  };
}

const roleSelectorStyle: React.CSSProperties = {
  display: "inline-flex",
  gap: 3,
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 7,
  background: "#f8fafc",
  padding: 2,
};

function roleButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: 25,
    height: 24,
    border: active ? "1px solid #2563eb" : "1px solid transparent",
    borderRadius: 5,
    background: active ? "#2563eb" : "transparent",
    color: active ? "#ffffff" : "#64748b",
    font: "inherit",
    fontSize: 10.5,
    fontWeight: 900,
    cursor: "pointer",
    padding: 0,
  };
}

const rowListStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 5 };
const groupListStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 7 };

function groupStyle(depth: number): React.CSSProperties {
  return { minWidth: 0, display: "grid", gap: 5, marginLeft: depth === 0 ? 0 : Math.min(depth * 8, 16) };
}

function groupHeaderStyle(depth: number): React.CSSProperties {
  return {
    minWidth: 0,
    height: 27,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 6,
    background: depth === 0 ? "#f1f5f9" : "#f8fafc",
    color: "#475569",
    fontSize: 10.5,
    fontWeight: 850,
    padding: "0 8px",
  };
}

const groupCountStyle: React.CSSProperties = { color: "#94a3b8", fontSize: 9.5, fontWeight: 900 };

const resourceButtonStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1e293b",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "6px 8px",
};

const resourceNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11.5,
  fontWeight: 800,
};

function actionItemIconStyle(color: string | undefined): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    borderRadius: 7,
    background: color === "red" ? "#fef2f2" : color === "yellow" ? "#fefce8" : "#f8fafc",
    color: color === "red" ? "#dc2626" : color === "yellow" ? "#ca8a04" : "#64748b",
    flex: "0 0 auto",
  };
}

const nodeRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  padding: 4,
};

const nodePrimaryButtonStyle: React.CSSProperties = {
  minWidth: 96,
  flex: "1 1 110px",
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  gap: 7,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "#1e293b",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "3px 5px",
};

const inlineContextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 4,
  overflow: "hidden",
};

function inlineContextButtonStyle(color: string): React.CSSProperties {
  return {
    minWidth: 0,
    maxWidth: 118,
    height: 27,
    display: "flex",
    alignItems: "center",
    gap: 4,
    border: `1px solid ${color}22`,
    borderRadius: 6,
    background: `${color}0d`,
    color,
    font: "inherit",
    cursor: "pointer",
    padding: "0 6px",
  };
}

const inlineContextLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 9.5,
  fontWeight: 800,
};

const emptyStyle: React.CSSProperties = {
  minHeight: 74,
  display: "grid",
  placeItems: "center",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 750,
  textAlign: "center",
  padding: 12,
};

const loadingStyle: React.CSSProperties = { display: "grid", gap: 8, padding: 4 };

function loadingLineStyle(width: number): React.CSSProperties {
  return { width: `${width}%`, height: 30, borderRadius: 7, background: "#f1f5f9" };
}

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  borderBottom: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#b91c1c",
  fontSize: 10.5,
  fontWeight: 750,
  padding: "5px 8px",
};

const smallButtonStyle: React.CSSProperties = {
  height: 24,
  border: "1px solid #fecaca",
  borderRadius: 5,
  background: "#ffffff",
  color: "#b91c1c",
  font: "inherit",
  fontSize: 10,
  fontWeight: 850,
  cursor: "pointer",
  padding: "0 7px",
};
