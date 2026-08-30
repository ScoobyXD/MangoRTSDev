import type { BoundRequestJSON } from "../api/requestJSON.js";

export const MY_WORK_SECTIONS = ["action_items", "nodes", "processes", "projects"] as const;
export type MyWorkSection = (typeof MY_WORK_SECTIONS)[number];

export const MY_WORK_PROCESS_ROLES = ["responsible", "accountable", "consulted", "informed"] as const;
export type MyWorkProcessRole = (typeof MY_WORK_PROCESS_ROLES)[number];

export const MY_WORK_ACTION_ITEM_PERSPECTIVES = ["mine", "delegated"] as const;
export type MyWorkActionItemPerspective = (typeof MY_WORK_ACTION_ITEM_PERSPECTIVES)[number];

export type MyWorkGroupingField = "color" | "completion_due_date" | "person_in_charge" | "priority" | "due_date";
export type MyWorkGroupingSetting = {
  field: MyWorkGroupingField;
  direction: "asc" | "desc";
};

export type MyWorkPage<Item> = {
  items: Item[];
  next_cursor?: string;
  has_more: boolean;
};

export type MyWorkActionItem = {
  entity_id: string;
  name: string;
  color?: string | null;
  completion_due_date?: string | null;
  completion_due_date_field_id: string;
  person_in_charge_user_id: string;
  person_in_charge_name: string;
  completed_timestamp?: string;
};

export type MyWorkInlineProcess = {
  logic_gate_id: string;
  name: string;
};

export type MyWorkInlineProject = {
  project_id: string;
  name: string;
};

export type MyWorkNode = {
  node_id: string;
  name: string;
  priority?: number | null;
  due_date?: string | null;
  completed_timestamp?: string;
  process?: MyWorkInlineProcess;
  project?: MyWorkInlineProject;
};

export type MyWorkProcess = {
  logic_gate_id: string;
  name: string;
  status_counts: {
    request: number;
    pending: number;
    in_progress: number;
    review: number;
  };
};

export type MyWorkProject = {
  project_id: string;
  name: string;
};

export type MyWorkProcessesPage = MyWorkPage<MyWorkProcess> & {
  role: MyWorkProcessRole;
};

export type MyWorkNodesPage = MyWorkPage<MyWorkNode> & {
  role: MyWorkProcessRole;
};

export type MyWorkActionItemsPage = MyWorkPage<MyWorkActionItem> & {
  perspective: MyWorkActionItemPerspective;
};

export type MyWorkResponse = {
  company_id: string;
  user_id: string;
  action_items?: MyWorkActionItemsPage;
  nodes?: MyWorkNodesPage;
  processes?: MyWorkProcessesPage;
  projects?: MyWorkPage<MyWorkProject>;
};

export type FetchMyWorkInput = {
  companyID: string;
  section?: MyWorkSection;
  role?: MyWorkProcessRole;
  perspective?: MyWorkActionItemPerspective;
  grouping?: ReadonlyArray<MyWorkGroupingSetting>;
  limit?: number;
  cursor?: string;
  history?: boolean;
  signal?: AbortSignal;
};

export const MY_WORK_PAGE_LIMIT = 40;
export const MY_WORK_HISTORY_PAGE_LIMIT = 12;

export async function fetchMyWork(
  requestJSON: BoundRequestJSON,
  input: FetchMyWorkInput,
): Promise<MyWorkResponse> {
  if (input.history && input.section !== "action_items" && input.section !== "nodes") {
    throw new Error("My Work history is valid only for Action Items or Nodes section reads.");
  }
  if (input.history && input.grouping !== undefined) {
    throw new Error("My Work history cannot be grouped.");
  }
  const params = new URLSearchParams({ company_id: input.companyID.trim() });
  if (input.section) params.set("section", input.section);
  if ((input.section === "nodes" || input.section === "processes") && input.role) params.set("role", input.role);
  if (input.section === "action_items" && input.perspective) params.set("perspective", input.perspective);
  if (input.grouping !== undefined) params.set("grouping", serializeMyWorkGrouping(input.section, input.grouping));
  if (input.history) params.set("history", "true");
  params.set("limit", String(boundedMyWorkLimit(input.limit)));
  if (input.cursor?.trim()) params.set("cursor", input.cursor.trim());
  return requestJSON<MyWorkResponse>(`/v1/my-work?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  });
}

export function serializeMyWorkGrouping(
  section: MyWorkSection | undefined,
  groupings: ReadonlyArray<MyWorkGroupingSetting>,
): string {
  const supportedFields = section === "action_items"
    ? new Set<MyWorkGroupingField>(["color", "completion_due_date", "person_in_charge"])
    : section === "nodes"
      ? new Set<MyWorkGroupingField>(["priority", "due_date"])
      : null;
  if (!supportedFields) throw new Error("My Work grouping is valid only for Action Items or Nodes section reads.");
  if (groupings.length === 0) return "none";
  const seen = new Set<MyWorkGroupingField>();
  return groupings.map((grouping) => {
    if (!supportedFields.has(grouping.field) || seen.has(grouping.field) || (grouping.direction !== "asc" && grouping.direction !== "desc")) {
      throw new Error(`Invalid ${section} grouping field: ${grouping.field}.`);
    }
    seen.add(grouping.field);
    return `${grouping.field}:${grouping.direction}`;
  }).join(",");
}

function boundedMyWorkLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return MY_WORK_PAGE_LIMIT;
  return Math.min(100, Math.max(1, Math.floor(value ?? MY_WORK_PAGE_LIMIT)));
}
