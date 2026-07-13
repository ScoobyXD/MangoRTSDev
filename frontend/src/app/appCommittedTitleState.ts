import type { CommittedEntityTitleUpdate } from "../modules/company-explorer/companyExplorerLocalEntityUpdates.js";
import type { AppDockTab } from "./appDockTabs.js";
import type { SidebarPin } from "./sidebarPins.js";
import type { AppTimelineDay, AppTimelineItem, AppTimelineState } from "./timelineState.js";

export type AppNodePopupTitleState = {
  nodeID: string;
  nodeTitle: string;
};

export type AppLogicGateTargetTitleState = {
  logicGateID: string;
  label: string;
};

function cleanCommittedTitle(update: CommittedEntityTitleUpdate): string {
  return update.title.trim();
}

export function isCommittedTitleUpdateForCompany(
  update: CommittedEntityTitleUpdate,
  activeCompanyID: string,
): boolean {
  const companyID = activeCompanyID.trim();
  return Boolean(companyID)
    && update.companyID.trim() === companyID
    && Boolean(update.resourceID.trim())
    && Boolean(cleanCommittedTitle(update));
}

export function reconcileAppDockTabTitles(
  tabs: AppDockTab[],
  update: CommittedEntityTitleUpdate,
): AppDockTab[] {
  const resourceID = update.resourceID.trim();
  const title = cleanCommittedTitle(update);
  if (!resourceID || !title) return tabs;
  const expectedKind = update.entityType === "node" ? "node" : "logic_gate_arena";
  let changed = false;
  const next = tabs.map((tab) => {
    if (tab.kind !== expectedKind || tab.entityID.trim() !== resourceID || tab.label === title) return tab;
    changed = true;
    return { ...tab, label: title };
  });
  return changed ? next : tabs;
}

export function reconcileAppSidebarPinTitles(
  pins: SidebarPin[],
  update: CommittedEntityTitleUpdate,
): SidebarPin[] {
  const resourceID = update.resourceID.trim();
  const title = cleanCommittedTitle(update);
  if (!resourceID || !title) return pins;
  const expectedKind = update.entityType === "node" ? "node" : "logic_gate";
  let changed = false;
  const next = pins.map((pin) => {
    if (pin.kind !== expectedKind || pin.id.trim() !== resourceID || pin.name === title) return pin;
    changed = true;
    return { ...pin, name: title };
  });
  return changed ? next : pins;
}

export function resolveCurrentAppSidebarPin(pins: SidebarPin[], snapshot: SidebarPin): SidebarPin {
  const pinID = snapshot.pinID.trim();
  const current = pins.find((pin) => (
    pinID
      ? pin.pinID.trim() === pinID
      : pin.kind === snapshot.kind && pin.id.trim() === snapshot.id.trim()
  ));
  return current ?? snapshot;
}

function reconcileTimelineItems(
  items: AppTimelineItem[],
  update: CommittedEntityTitleUpdate,
  title: string,
): AppTimelineItem[] {
  const resourceID = update.resourceID.trim();
  let changed = false;
  const next = items.map((item) => {
    if (item.kind !== update.entityType || item.entityID.trim() !== resourceID || item.label === title) return item;
    changed = true;
    return { ...item, label: title };
  });
  return changed ? next : items;
}

export function reconcileAppTimelineTitles(
  state: AppTimelineState,
  update: CommittedEntityTitleUpdate,
): AppTimelineState {
  const title = cleanCommittedTitle(update);
  if (!update.resourceID.trim() || !title) return state;
  const items = reconcileTimelineItems(state.items, update, title);
  let historyChanged = false;
  const history = state.history.map((day): AppTimelineDay => {
    const dayItems = reconcileTimelineItems(day.items, update, title);
    if (dayItems === day.items) return day;
    historyChanged = true;
    return { ...day, items: dayItems };
  });
  return items === state.items && !historyChanged ? state : { ...state, items, history };
}

export function reconcileAppNodePopupTitle<T extends AppNodePopupTitleState>(
  current: T | null,
  update: CommittedEntityTitleUpdate,
): T | null {
  const title = cleanCommittedTitle(update);
  if (
    !current
    || update.entityType !== "node"
    || current.nodeID.trim() !== update.resourceID.trim()
    || !title
    || current.nodeTitle === title
  ) return current;
  return { ...current, nodeTitle: title };
}

export function reconcileAppLogicGateTargetTitle<T extends AppLogicGateTargetTitleState>(
  current: T | null,
  update: CommittedEntityTitleUpdate,
): T | null {
  const title = cleanCommittedTitle(update);
  if (
    !current
    || update.entityType !== "logic_gate"
    || current.logicGateID.trim() !== update.resourceID.trim()
    || !title
    || current.label === title
  ) return current;
  return { ...current, label: title };
}
