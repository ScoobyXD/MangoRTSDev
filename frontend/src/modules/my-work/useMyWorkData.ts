import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError, type BoundRequestJSON } from "../api/requestJSON.js";
import {
  fetchMyWork,
  MY_WORK_HISTORY_PAGE_LIMIT,
  MY_WORK_PAGE_LIMIT,
  type MyWorkActionItem,
  type MyWorkActionItemPerspective,
  type MyWorkNode,
  type MyWorkPage,
  type MyWorkProcess,
  type MyWorkProcessRole,
  type MyWorkProject,
  type MyWorkResponse,
  type MyWorkSection,
  type MyWorkGroupingSetting,
  type MyWorkOrderingSetting,
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
  perspective?: MyWorkActionItemPerspective;
  grouping?: ReadonlyArray<MyWorkGroupingSetting>;
  ordering?: ReadonlyArray<MyWorkOrderingSetting>;
  clearItems?: boolean;
  append?: boolean;
  history?: boolean;
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

export function useMyWorkData(companyID: string, subjectID: string, requestJSON: BoundRequestJSON) {
  const [state, setState] = useState<MyWorkDataState>(createInitialState);
  const [actionItemPerspective, setActionItemPerspective] = useState<MyWorkActionItemPerspective>("mine");
  const [nodeRole, setNodeRole] = useState<MyWorkProcessRole>("responsible");
  const [processRole, setProcessRole] = useState<MyWorkProcessRole>("responsible");
  const stateRef = useRef(state);
  const actionItemPerspectiveRef = useRef(actionItemPerspective);
  const nodeRoleRef = useRef(nodeRole);
  const processRoleRef = useRef(processRole);
  const initialControllerRef = useRef<AbortController | null>(null);
  const sectionControllersRef = useRef<Partial<Record<MyWorkSection, AbortController>>>({});
  const requestVersionsRef = useRef<Record<MyWorkSection, number>>({
    action_items: 0,
    nodes: 0,
    processes: 0,
    projects: 0,
  });
  const consumedCursorsRef = useRef<Record<MyWorkSection, Set<string>>>(createCursorSets());
  const seenItemKeysRef = useRef<Record<MyWorkSection, Set<string>>>(createSectionSets());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    actionItemPerspectiveRef.current = actionItemPerspective;
  }, [actionItemPerspective]);

  useEffect(() => {
    nodeRoleRef.current = nodeRole;
  }, [nodeRole]);

  useEffect(() => {
    processRoleRef.current = processRole;
  }, [processRole]);

  const requestSection = useCallback(async (
    section: MyWorkSection,
    request: SectionRequest = {},
  ): Promise<void> => {
    if (!request.append) consumedCursorsRef.current[section] = new Set<string>();
    if (!request.append && request.clearItems) seenItemKeysRef.current[section] = new Set<string>();
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
        role: section === "nodes"
          ? request.role ?? nodeRoleRef.current
          : section === "processes"
            ? request.role ?? processRoleRef.current
            : undefined,
        perspective: section === "action_items"
          ? request.perspective ?? actionItemPerspectiveRef.current
          : undefined,
        grouping: request.grouping,
        ordering: request.ordering,
        history: request.history,
        limit: request.history ? MY_WORK_HISTORY_PAGE_LIMIT : MY_WORK_PAGE_LIMIT,
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
      const seenItemKeys = request.append ? seenItemKeysRef.current[section] : new Set<string>();
      const acceptedPageItems = takeUnseenMyWorkItems(section, page.items, seenItemKeys);
      if (!request.append) seenItemKeysRef.current[section] = seenItemKeys;
      setState((current) => replaceSection(current, section, stateFromPage(
        page,
        request.append ? (current[section] as AnySectionState).items : [],
        acceptedPageItems,
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
    seenItemKeysRef.current = createSectionSets();
    const controller = new AbortController();
    initialControllerRef.current = controller;
    const versions = {
      action_items: ++requestVersionsRef.current.action_items,
      nodes: ++requestVersionsRef.current.nodes,
      processes: ++requestVersionsRef.current.processes,
      projects: ++requestVersionsRef.current.projects,
    };
    actionItemPerspectiveRef.current = "mine";
    nodeRoleRef.current = "responsible";
    processRoleRef.current = "responsible";
    setActionItemPerspective("mine");
    setNodeRole("responsible");
    setProcessRole("responsible");
    setState({
      action_items: { ...createInitialState().action_items, loading: true },
      nodes: { ...createInitialState().nodes, loading: true },
      processes: { ...createInitialState().processes, loading: true },
      projects: { ...createInitialState().projects, loading: true },
    });

    void fetchMyWork(requestJSON, {
      companyID,
      limit: MY_WORK_PAGE_LIMIT,
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return;
      const preparedResponse = prepareInitialResponse(
        response,
        versions,
        requestVersionsRef.current,
        seenItemKeysRef.current,
      );
      setState((current) => applyInitialResponse(current, preparedResponse, versions, requestVersionsRef.current));
    }).catch((cause) => {
      if (controller.signal.aborted || isAbortError(cause)) return;
      const message = errorMessage(cause);
      setState((current) => applyInitialError(current, message, versions, requestVersionsRef.current));
    });

    return () => {
      controller.abort();
      Object.values(sectionControllersRef.current).forEach((sectionController) => sectionController?.abort());
      seenItemKeysRef.current = createSectionSets();
    };
  }, [companyID, requestJSON, subjectID]);

  const reloadSection = useCallback((
    section: MyWorkSection,
    grouping?: ReadonlyArray<MyWorkGroupingSetting>,
    clearItems = false,
    history = false,
    ordering?: ReadonlyArray<MyWorkOrderingSetting>,
  ): Promise<void> => requestSection(section, { grouping, ordering, clearItems, history }), [requestSection]);

  const loadMore = useCallback((
    section: MyWorkSection,
    grouping?: ReadonlyArray<MyWorkGroupingSetting>,
    history = false,
    ordering?: ReadonlyArray<MyWorkOrderingSetting>,
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
      ordering,
      history,
      append: true,
    });
  }, [requestSection]);

  const selectActionItemPerspective = useCallback((
    perspective: MyWorkActionItemPerspective,
    grouping?: ReadonlyArray<MyWorkGroupingSetting>,
    history = false,
    ordering?: ReadonlyArray<MyWorkOrderingSetting>,
  ): Promise<void> => {
    if (actionItemPerspectiveRef.current === perspective) return Promise.resolve();
    actionItemPerspectiveRef.current = perspective;
    setActionItemPerspective(perspective);
    return requestSection("action_items", { perspective, grouping, ordering, history, clearItems: true });
  }, [requestSection]);

  const selectNodeRole = useCallback((
    role: MyWorkProcessRole,
    grouping?: ReadonlyArray<MyWorkGroupingSetting>,
    history = false,
  ): Promise<void> => {
    if (nodeRoleRef.current === role) return Promise.resolve();
    nodeRoleRef.current = role;
    setNodeRole(role);
    return requestSection("nodes", { role, grouping, history, clearItems: true });
  }, [requestSection]);

  const selectProcessRole = useCallback((role: MyWorkProcessRole): Promise<void> => {
    if (processRoleRef.current === role) return Promise.resolve();
    processRoleRef.current = role;
    setProcessRole(role);
    return requestSection("processes", { role, clearItems: true });
  }, [requestSection]);

  return {
    state,
    actionItemPerspective,
    nodeRole,
    processRole,
    reloadSection,
    loadMore,
    selectActionItemPerspective,
    selectNodeRole,
    selectProcessRole,
  };
}

function createCursorSets(): Record<MyWorkSection, Set<string>> {
  return createSectionSets();
}

function createSectionSets(): Record<MyWorkSection, Set<string>> {
  return {
    action_items: new Set<string>(),
    nodes: new Set<string>(),
    processes: new Set<string>(),
    projects: new Set<string>(),
  };
}

function stateFromPage<Item>(
  page: MyWorkPage<Item>,
  previousItems: Item[],
  pageItems: Item[],
): MyWorkSectionState<Item> {
  return {
    items: [...previousItems, ...pageItems],
    nextCursor: page.next_cursor?.trim() || undefined,
    hasMore: page.has_more,
    loading: false,
    error: "",
  };
}

export function takeUnseenMyWorkItems<Item>(
  section: MyWorkSection,
  pageItems: Item[],
  seen: Set<string>,
): Item[] {
  return pageItems.filter((item) => {
    const key = myWorkItemKey(section, item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      ? stateFromPage(response.action_items, [], response.action_items.items)
      : { ...next.action_items, loading: false, error: "My Work response omitted action_items." });
  }
  if (currentVersions.nodes === versions.nodes) {
    next = replaceSection(next, "nodes", response.nodes
      ? stateFromPage(response.nodes, [], response.nodes.items)
      : { ...next.nodes, loading: false, error: "My Work response omitted nodes." });
  }
  if (currentVersions.processes === versions.processes) {
    next = replaceSection(next, "processes", response.processes
      ? stateFromPage(response.processes, [], response.processes.items)
      : { ...next.processes, loading: false, error: "My Work response omitted processes." });
  }
  if (currentVersions.projects === versions.projects) {
    next = replaceSection(next, "projects", response.projects
      ? stateFromPage(response.projects, [], response.projects.items)
      : { ...next.projects, loading: false, error: "My Work response omitted projects." });
  }
  return next;
}

function prepareInitialResponse(
  response: MyWorkResponse,
  versions: Record<MyWorkSection, number>,
  currentVersions: Record<MyWorkSection, number>,
  seenItemKeys: Record<MyWorkSection, Set<string>>,
): MyWorkResponse {
  let next = response;
  if (currentVersions.action_items === versions.action_items && response.action_items) {
    const seen = new Set<string>();
    const items = takeUnseenMyWorkItems("action_items", response.action_items.items, seen);
    seenItemKeys.action_items = seen;
    next = { ...next, action_items: { ...response.action_items, items } };
  }
  if (currentVersions.nodes === versions.nodes && response.nodes) {
    const seen = new Set<string>();
    const items = takeUnseenMyWorkItems("nodes", response.nodes.items, seen);
    seenItemKeys.nodes = seen;
    next = { ...next, nodes: { ...response.nodes, items } };
  }
  if (currentVersions.processes === versions.processes && response.processes) {
    const seen = new Set<string>();
    const items = takeUnseenMyWorkItems("processes", response.processes.items, seen);
    seenItemKeys.processes = seen;
    next = { ...next, processes: { ...response.processes, items } };
  }
  if (currentVersions.projects === versions.projects && response.projects) {
    const seen = new Set<string>();
    const items = takeUnseenMyWorkItems("projects", response.projects.items, seen);
    seenItemKeys.projects = seen;
    next = { ...next, projects: { ...response.projects, items } };
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
