import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError, type BoundRequestJSON } from "../api/requestJSON.js";
import {
  fetchMyWork,
  MY_WORK_PAGE_LIMIT,
  type MyWorkActionItem,
  type MyWorkNode,
  type MyWorkPage,
  type MyWorkProcess,
  type MyWorkProcessRole,
  type MyWorkProject,
  type MyWorkResponse,
  type MyWorkSection,
  type MyWorkGroupingSetting,
} from "./myWorkApi.js";

export type MyWorkSectionState<Item> = {
  items: Item[];
  nextCursor?: string;
  hasMore: boolean;
  loading: boolean;
  error: string;
};

export type MyWorkDataState = {
  action_items: MyWorkSectionState<MyWorkActionItem>;
  nodes: MyWorkSectionState<MyWorkNode>;
  processes: MyWorkSectionState<MyWorkProcess>;
  projects: MyWorkSectionState<MyWorkProject>;
};

type MyWorkItem = MyWorkActionItem | MyWorkNode | MyWorkProcess | MyWorkProject;
type AnySectionState = MyWorkSectionState<MyWorkItem>;

type SectionRequest = {
  cursor?: string;
  role?: MyWorkProcessRole;
  grouping?: ReadonlyArray<MyWorkGroupingSetting>;
  clearItems?: boolean;
  append?: boolean;
};

const EMPTY_SECTION_STATE = {
  items: [],
  hasMore: false,
  loading: false,
  error: "",
};

function createInitialState(): MyWorkDataState {
  return {
    action_items: { ...EMPTY_SECTION_STATE, items: [] },
    nodes: { ...EMPTY_SECTION_STATE, items: [] },
    processes: { ...EMPTY_SECTION_STATE, items: [] },
    projects: { ...EMPTY_SECTION_STATE, items: [] },
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : "My Work could not be loaded.";
}

export function useMyWorkData(companyID: string, requestJSON: BoundRequestJSON) {
  const [state, setState] = useState<MyWorkDataState>(createInitialState);
  const [processRole, setProcessRole] = useState<MyWorkProcessRole>("responsible");
  const stateRef = useRef(state);
  const roleRef = useRef(processRole);
  const initialControllerRef = useRef<AbortController | null>(null);
  const sectionControllersRef = useRef<Partial<Record<MyWorkSection, AbortController>>>({});
  const requestVersionsRef = useRef<Record<MyWorkSection, number>>({
    action_items: 0,
    nodes: 0,
    processes: 0,
    projects: 0,
  });
  const consumedCursorsRef = useRef<Record<MyWorkSection, Set<string>>>(createCursorSets());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    roleRef.current = processRole;
  }, [processRole]);

  const requestSection = useCallback(async (
    section: MyWorkSection,
    request: SectionRequest = {},
  ): Promise<void> => {
    if (!request.append) consumedCursorsRef.current[section] = new Set<string>();
    sectionControllersRef.current[section]?.abort();
    const controller = new AbortController();
    sectionControllersRef.current[section] = controller;
    const version = ++requestVersionsRef.current[section];
    setState((current) => replaceSection(
      current,
      section,
      beginMyWorkSectionRequest(current[section] as AnySectionState, request.clearItems),
    ));
    try {
      const response = await fetchMyWork(requestJSON, {
        companyID,
        section,
        role: section === "processes" ? request.role ?? roleRef.current : undefined,
        grouping: request.grouping,
        limit: MY_WORK_PAGE_LIMIT,
        cursor: request.cursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestVersionsRef.current[section] !== version) return;
      const page = response[section] as MyWorkPage<MyWorkItem> | undefined;
      if (!page) throw new Error(`My Work response omitted ${section}.`);
      const nextCursor = page.next_cursor?.trim() ?? "";
      const consumedCursors = consumedCursorsRef.current[section];
      if (page.has_more && (!nextCursor || (request.append && (
        nextCursor === request.cursor?.trim() || consumedCursors.has(nextCursor)
      )))) {
        throw new Error(`My Work ${section.replace("_", " ")} pagination did not advance.`);
      }
      if (request.append && request.cursor?.trim()) consumedCursors.add(request.cursor.trim());
      setState((current) => replaceSection(current, section, stateFromPage(
        section,
        page,
        request.append ? (current[section] as AnySectionState).items : [],
      )));
    } catch (cause) {
      if (controller.signal.aborted || isAbortError(cause) || requestVersionsRef.current[section] !== version) return;
      setState((current) => replaceSection(current, section, {
        ...current[section],
        loading: false,
        error: errorMessage(cause),
      }));
    } finally {
      if (sectionControllersRef.current[section] === controller) delete sectionControllersRef.current[section];
    }
  }, [companyID, requestJSON]);

  useEffect(() => {
    initialControllerRef.current?.abort();
    Object.values(sectionControllersRef.current).forEach((controller) => controller?.abort());
    sectionControllersRef.current = {};
    consumedCursorsRef.current = createCursorSets();
    const controller = new AbortController();
    initialControllerRef.current = controller;
    const versions = {
      action_items: ++requestVersionsRef.current.action_items,
      nodes: ++requestVersionsRef.current.nodes,
      processes: ++requestVersionsRef.current.processes,
      projects: ++requestVersionsRef.current.projects,
    };
    roleRef.current = "responsible";
    setProcessRole("responsible");
    setState({
      action_items: { ...createInitialState().action_items, loading: true },
      nodes: { ...createInitialState().nodes, loading: true },
      processes: { ...createInitialState().processes, loading: true },
      projects: { ...createInitialState().projects, loading: true },
    });

    void fetchMyWork(requestJSON, {
      companyID,
      role: "responsible",
      limit: MY_WORK_PAGE_LIMIT,
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return;
      setState((current) => applyInitialResponse(current, response, versions, requestVersionsRef.current));
    }).catch((cause) => {
      if (controller.signal.aborted || isAbortError(cause)) return;
      const message = errorMessage(cause);
      setState((current) => applyInitialError(current, message, versions, requestVersionsRef.current));
    });

    return () => {
      controller.abort();
      Object.values(sectionControllersRef.current).forEach((sectionController) => sectionController?.abort());
    };
  }, [companyID, requestJSON]);

  const reloadSection = useCallback((
    section: MyWorkSection,
    grouping?: ReadonlyArray<MyWorkGroupingSetting>,
    clearItems = false,
  ): Promise<void> => requestSection(section, { grouping, clearItems }), [requestSection]);

  const loadMore = useCallback((
    section: MyWorkSection,
    grouping?: ReadonlyArray<MyWorkGroupingSetting>,
  ): Promise<void> => {
    const current = stateRef.current[section];
    const activeController = sectionControllersRef.current[section];
    if (
      current.loading
      || (activeController && !activeController.signal.aborted)
      || !current.hasMore
      || !current.nextCursor
      || consumedCursorsRef.current[section].has(current.nextCursor)
    ) return Promise.resolve();
    return requestSection(section, {
      cursor: current.nextCursor,
      grouping,
      append: true,
    });
  }, [requestSection]);

  const selectProcessRole = useCallback((role: MyWorkProcessRole): Promise<void> => {
    if (roleRef.current === role) return Promise.resolve();
    roleRef.current = role;
    setProcessRole(role);
    return requestSection("processes", { role, clearItems: true });
  }, [requestSection]);

  return {
    state,
    processRole,
    reloadSection,
    loadMore,
    selectProcessRole,
  };
}

function createCursorSets(): Record<MyWorkSection, Set<string>> {
  return {
    action_items: new Set<string>(),
    nodes: new Set<string>(),
    processes: new Set<string>(),
    projects: new Set<string>(),
  };
}

function stateFromPage<Item>(
  section: MyWorkSection,
  page: MyWorkPage<Item>,
  previousItems: Item[],
): MyWorkSectionState<Item> {
  return {
    items: appendUniqueMyWorkItems(section, previousItems, page.items),
    nextCursor: page.next_cursor?.trim() || undefined,
    hasMore: page.has_more,
    loading: false,
    error: "",
  };
}

function appendUniqueMyWorkItems<Item>(section: MyWorkSection, previousItems: Item[], pageItems: Item[]): Item[] {
  if (previousItems.length === 0) return [...pageItems];
  const seen = new Set(previousItems.map((item) => myWorkItemKey(section, item)));
  return [...previousItems, ...pageItems.filter((item) => {
    const key = myWorkItemKey(section, item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

function myWorkItemKey(section: MyWorkSection, item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const row = item as Record<string, unknown>;
  if (section === "action_items") return String(row.entity_id ?? "");
  if (section === "nodes") return String(row.node_id ?? "");
  if (section === "processes") return String(row.logic_gate_id ?? "");
  return String(row.project_id ?? "");
}

export function beginMyWorkSectionRequest<Item>(
  current: MyWorkSectionState<Item>,
  clearItems = false,
): MyWorkSectionState<Item> {
  return {
    ...current,
    ...(clearItems ? {
      items: [],
      nextCursor: undefined,
      hasMore: false,
    } : {}),
    loading: true,
    error: "",
  };
}

function replaceSection(
  state: MyWorkDataState,
  section: MyWorkSection,
  next: AnySectionState,
): MyWorkDataState {
  if (section === "action_items") return { ...state, action_items: next as MyWorkSectionState<MyWorkActionItem> };
  if (section === "nodes") return { ...state, nodes: next as MyWorkSectionState<MyWorkNode> };
  if (section === "processes") return { ...state, processes: next as MyWorkSectionState<MyWorkProcess> };
  return { ...state, projects: next as MyWorkSectionState<MyWorkProject> };
}

function applyInitialResponse(
  state: MyWorkDataState,
  response: MyWorkResponse,
  versions: Record<MyWorkSection, number>,
  currentVersions: Record<MyWorkSection, number>,
): MyWorkDataState {
  let next = state;
  if (currentVersions.action_items === versions.action_items) {
    next = replaceSection(next, "action_items", response.action_items
      ? stateFromPage("action_items", response.action_items, [])
      : { ...next.action_items, loading: false, error: "My Work response omitted action_items." });
  }
  if (currentVersions.nodes === versions.nodes) {
    next = replaceSection(next, "nodes", response.nodes
      ? stateFromPage("nodes", response.nodes, [])
      : { ...next.nodes, loading: false, error: "My Work response omitted nodes." });
  }
  if (currentVersions.processes === versions.processes) {
    next = replaceSection(next, "processes", response.processes
      ? stateFromPage("processes", response.processes, [])
      : { ...next.processes, loading: false, error: "My Work response omitted processes." });
  }
  if (currentVersions.projects === versions.projects) {
    next = replaceSection(next, "projects", response.projects
      ? stateFromPage("projects", response.projects, [])
      : { ...next.projects, loading: false, error: "My Work response omitted projects." });
  }
  return next;
}

function applyInitialError(
  state: MyWorkDataState,
  message: string,
  versions: Record<MyWorkSection, number>,
  currentVersions: Record<MyWorkSection, number>,
): MyWorkDataState {
  let next = state;
  for (const section of ["action_items", "nodes", "processes", "projects"] as const) {
    if (currentVersions[section] !== versions[section]) continue;
    next = replaceSection(next, section, { ...next[section], loading: false, error: message });
  }
  return next;
}
