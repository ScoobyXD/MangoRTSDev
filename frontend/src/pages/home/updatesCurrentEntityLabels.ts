import type { NotificationItem } from "../../modules/notifications/notificationsApi.js";

type UpdateLogicGateResourceRef = {
  item: Pick<NotificationItem, "entity_type" | "entity_id" | "logic_gate_id">;
  logicGate?: { id: string; label: string };
};

export type UpdateLogicGateDetails = {
  title?: string;
};

export function resolveUpdateLogicGateID(row: UpdateLogicGateResourceRef): string {
  return row.item.logic_gate_id?.trim()
    || row.logicGate?.id.trim()
    || (row.item.entity_type === "logic_gate" ? row.item.entity_id.trim() : "");
}

export function resolveCurrentUpdateLogicGateLabel(input: {
  currentDetails?: UpdateLogicGateDetails | null;
  groupedLabel?: string;
  historicalEntityLabel?: string;
}): string {
  return input.currentDetails?.title?.trim()
    || input.groupedLabel?.trim()
    || input.historicalEntityLabel?.trim()
    || "Process";
}

export function resolveCurrentUpdateLogicGateGroupValue(input: {
  row: UpdateLogicGateResourceRef;
  currentDetails?: UpdateLogicGateDetails | null;
  historicalEntityLabel?: string;
}): { id: string; label: string; sortValue: string } | null {
  const id = resolveUpdateLogicGateID(input.row);
  if (!id) return null;
  const label = resolveCurrentUpdateLogicGateLabel({
    currentDetails: input.currentDetails,
    groupedLabel: input.row.logicGate?.label,
    historicalEntityLabel: input.historicalEntityLabel,
  });
  return {
    id,
    label,
    sortValue: label.toLowerCase(),
  };
}
