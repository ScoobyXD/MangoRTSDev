import type { BoundRequestJSON } from "../api/requestJSON.js";

export const MY_WORK_SECTIONS = ["action_items", "nodes", "processes", "projects"] as const;
export type MyWorkSection = (typeof MY_WORK_SECTIONS)[number];

export const MY_WORK_PROCESS_ROLES = ["responsible", "accountable", "consulted", "informed"] as const;
export type MyWorkProcessRole = (typeof MY_WORK_PROCESS_ROLES)[number];

export const MY_WORK_ACTION_ITEM_PERSPECTIVES = ["mine", "delegated"] as const;
export type MyWorkActionItemPerspective = (typeof MY_WORK_ACTION_ITEM_PERSPECTIVES)[number];

export type MyWorkActionItemArrangeField = "color" | "huddle_process" | "completion_due_date" | "person_in_charge";
export type MyWorkGroupingField = MyWorkActionItemArrangeField | "priority" | "due_date";
export type MyWorkGroupingSetting = {
  field: MyWorkGroupingField;
  direction: "asc" | "desc";
};
export type MyWorkOrderingSetting = {
  field: MyWorkActionItemArrangeField;
  direction: "asc" | "desc";
};

export const MY_WORK_ACTION_ITEM_DISPLAY_FIELD_IDS = [
  "person_in_charge",
  "assigned_by",
  "created_timestamp",
  "source",
  "color",
  "analysis_due_date",
  "completion_due_date",
  "status",
  "huddle_process",
] as const;
export type MyWorkActionItemDisplayFieldID = (typeof MY_WORK_ACTION_ITEM_DISPLAY_FIELD_IDS)[number];

export const MY_WORK_ACTION_ITEM_SAVED_VIEW_SURFACES = {
  mine: "my_work_action_items_mine",
  delegated: "my_work_action_items_delegated",
} as const;
export type MyWorkActionItemSavedViewSurface = (typeof MY_WORK_ACTION_ITEM_SAVED_VIEW_SURFACES)[MyWorkActionItemPerspective];

export type MyWorkPage<Item> = {
  items: Item[];
  next_cursor?: string;
  has_more: boolean;
};

export type MyWorkActionItem = {
  entity_id: string;
  name: string;
  color?: string | null;
  status?: string | null;
  analysis_due_date?: string | null;
  completion_due_date?: string | null;
  completion_due_date_field_id: string;
  person_in_charge_user_id: string;
  person_in_charge_name: string;
  assigned_by_user_id?: string;
  assigned_by_name?: string;
  created_timestamp?: string;
  source?: MyWorkActionItemSource;
  huddle_process?: MyWorkActionItemHuddleProcess;
  completed_timestamp?: string;
};

export type MyWorkActionItemSource = {
  resource_type: string;
  resource_id: string;
  name: string;
  parent_resource_id?: string;
};

export type MyWorkActionItemHuddleProcess = {
  huddle_logic_gate_id: string;
  name: string;
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
  subjectUserID?: string;
  section?: MyWorkSection;
  role?: MyWorkProcessRole;
  perspective?: MyWorkActionItemPerspective;
  grouping?: ReadonlyArray<MyWorkGroupingSetting>;
  ordering?: ReadonlyArray<MyWorkOrderingSetting>;
  limit?: number;
  cursor?: string;
  history?: boolean;
  signal?: AbortSignal;
};

export const MY_WORK_PAGE_LIMIT = 40;
export const MY_WORK_HISTORY_PAGE_LIMIT = 12;

export type MyWorkActionItemSavedViewSettings = {
  ordering: MyWorkOrderingSetting[];
  displayed_fields: MyWorkActionItemDisplayFieldID[];
};

export type MyWorkActionItemSavedView = {
  company_id: string;
  saved_view_id: string;
  surface: MyWorkActionItemSavedViewSurface;
  principal: "user";
  principal_id: string;
  name: string;
  groupings: MyWorkGroupingSetting[];
  settings: MyWorkActionItemSavedViewSettings;
  position: number;
};

export async function fetchMyWork(
  requestJSON: BoundRequestJSON,
  input: FetchMyWorkInput,
): Promise<MyWorkResponse> {
  if (input.history && input.section !== "action_items" && input.section !== "nodes") {
    throw new Error("My Work history is valid only for Action Items or Nodes section reads.");
  }
  if (input.history && (input.grouping !== undefined || input.ordering !== undefined)) {
    throw new Error("My Work history cannot be grouped or ordered.");
  }
  const params = new URLSearchParams({ company_id: input.companyID.trim() });
  if (input.subjectUserID?.trim()) params.set("subject_user_id", input.subjectUserID.trim());
  if (input.section) params.set("section", input.section);
  if ((input.section === "nodes" || input.section === "processes") && input.role) params.set("role", input.role);
  if (input.section === "action_items" && input.perspective) params.set("perspective", input.perspective);
  if (input.grouping !== undefined) {
    params.set("grouping", serializeMyWorkGrouping(input.section, input.grouping, input.perspective));
  }
  if (input.ordering !== undefined) {
    params.set("ordering", serializeMyWorkOrdering(input.section, input.perspective, input.ordering));
  }
  if (input.section === "action_items" && input.grouping !== undefined && input.ordering !== undefined) {
    const groupedFields = new Set(input.grouping.map((grouping) => grouping.field));
    if (input.ordering.some((ordering) => groupedFields.has(ordering.field))) {
      throw new Error("My Work grouping and ordering fields must be distinct.");
    }
  }
  if (input.history) params.set("history", "true");
  params.set("limit", String(boundedMyWorkLimit(input.limit)));
  if (input.cursor?.trim()) params.set("cursor", input.cursor.trim());
  return requestJSON<MyWorkResponse>(`/v1/my-work?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  });
}

export function serializeMyWorkOrdering(
  section: MyWorkSection | undefined,
  perspective: MyWorkActionItemPerspective | undefined,
  orderings: ReadonlyArray<MyWorkOrderingSetting>,
): string {
  if (section !== "action_items") throw new Error("My Work ordering is valid only for Action Items section reads.");
  const supportedFields = new Set<MyWorkActionItemArrangeField>(["color", "huddle_process", "completion_due_date"]);
  if (perspective === "delegated") supportedFields.add("person_in_charge");
  if (orderings.length === 0) return "none";
  const seen = new Set<MyWorkActionItemArrangeField>();
  return orderings.map((ordering) => {
    if (!supportedFields.has(ordering.field) || seen.has(ordering.field) || (ordering.direction !== "asc" && ordering.direction !== "desc")) {
      throw new Error(`Invalid action_items ordering field: ${ordering.field}.`);
    }
    seen.add(ordering.field);
    return `${ordering.field}:${ordering.direction}`;
  }).join(",");
}

export async function fetchMyWorkActionItemSavedView(
  requestJSON: BoundRequestJSON,
  companyID: string,
  perspective: MyWorkActionItemPerspective,
): Promise<MyWorkActionItemSavedView | null> {
  const surface = MY_WORK_ACTION_ITEM_SAVED_VIEW_SURFACES[perspective];
  const params = new URLSearchParams({ company_id: companyID.trim(), surface });
  const response = await requestJSON<{ saved_views?: MyWorkActionItemSavedView[] }>(`/v1/saved-views?${params.toString()}`, {
    cache: "no-store",
  });
  const savedViews = Array.isArray(response.saved_views) ? response.saved_views : [];
  return savedViews.find((savedView) => savedView?.surface === surface) ?? null;
}

export async function saveMyWorkActionItemSavedView(
  requestJSON: BoundRequestJSON,
  input: {
    companyID: string;
    userID: string;
    perspective: MyWorkActionItemPerspective;
    savedViewID: string;
    groupings: ReadonlyArray<MyWorkGroupingSetting>;
    ordering: ReadonlyArray<MyWorkOrderingSetting>;
    displayedFields: ReadonlyArray<MyWorkActionItemDisplayFieldID>;
  },
): Promise<MyWorkActionItemSavedView> {
  const surface = MY_WORK_ACTION_ITEM_SAVED_VIEW_SURFACES[input.perspective];
  return requestJSON<MyWorkActionItemSavedView>(`/v1/saved-views/${encodeURIComponent(input.savedViewID.trim())}`, {
    method: "PUT",
    json: {
      company_id: input.companyID.trim(),
      saved_view_id: input.savedViewID.trim(),
      surface,
      principal: "user",
      principal_id: input.userID.trim(),
      name: input.perspective === "mine" ? "My Work Mine" : "My Work Delegated",
      groupings: input.groupings,
      settings: {
        ordering: input.ordering,
        displayed_fields: input.displayedFields,
      },
      position: 1000,
    },
  });
}

export function serializeMyWorkGrouping(
  section: MyWorkSection | undefined,
  groupings: ReadonlyArray<MyWorkGroupingSetting>,
  perspective?: MyWorkActionItemPerspective,
): string {
  const supportedFields = section === "action_items"
    ? new Set<MyWorkGroupingField>([
      "color",
      "huddle_process",
      "completion_due_date",
      ...(perspective === "delegated" ? ["person_in_charge" as const] : []),
    ])
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
