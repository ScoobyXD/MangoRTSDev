import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppFloatingMenuDismissal, useAppOverlayPortalTarget } from "../../app/AppModalPortal.js";
import type { BoundRequestJSON } from "../api/requestJSON.js";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember } from "../communications/communicationsApi.js";
import {
  CompanyUserSearchPicker,
  editorCompanyUserMatches,
  useFloatingLayerPosition,
} from "../editor/EditorFieldControls.js";
import { HuddlePeopleIcon } from "../huddles/HuddleResourceIcon.js";

export type MyWorkPersonSelection = {
  userID: string;
  label: string;
};

export type MyWorkPersonDirectory = {
  users: CompanyUser[];
  groups: CompanyUserGroup[];
  members: CompanyUserGroupMember[];
};

export type MyWorkPersonDirectoryRow =
  | { kind: "group"; key: string; groupID: string; label: string; depth: number; ungrouped?: boolean }
  | { kind: "user"; key: string; userID: string; label: string; email: string; depth: number; groupID?: string };

type MyWorkPersonPickerProps = {
  companyID: string;
  viewerUserID: string;
  selectedUserID: string;
  requestJSON: BoundRequestJSON;
  onSelect: (selection: MyWorkPersonSelection) => void;
};

type DirectoryOption = {
  key: string;
  id: string;
  userID: string;
  label: string;
};

export async function fetchMyWorkPersonDirectory(
  requestJSON: BoundRequestJSON,
  companyID: string,
  signal?: AbortSignal,
): Promise<MyWorkPersonDirectory> {
  const cleanCompanyID = companyID.trim();
  const [usersPayload, groupsPayload] = await Promise.all([
    requestJSON<{ users?: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(cleanCompanyID)}/users`, {
      cache: "no-store",
      signal,
    }),
    requestJSON<{ groups?: CompanyUserGroup[]; members?: CompanyUserGroupMember[] }>(
      `/v1/companies/${encodeURIComponent(cleanCompanyID)}/user-groups`,
      { cache: "no-store", signal },
    ),
  ]);
  const users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
  const groups = Array.isArray(groupsPayload.groups) ? groupsPayload.groups : [];
  const members = Array.isArray(groupsPayload.members) ? groupsPayload.members : [];
  assertDirectoryCompanyScope(users, cleanCompanyID, "user");
  assertDirectoryCompanyScope(groups, cleanCompanyID, "team");
  assertDirectoryCompanyScope(members, cleanCompanyID, "team member");
  return { users, groups, members };
}

export function buildMyWorkPersonDirectoryRows(
  directory: MyWorkPersonDirectory,
  query = "",
): MyWorkPersonDirectoryRow[] {
  const cleanQuery = query.trim().toLocaleLowerCase();
  const groupByID = new Map<string, CompanyUserGroup>();
  for (const group of directory.groups) {
    const groupID = group.group_id.trim();
    if (groupID && !groupByID.has(groupID)) groupByID.set(groupID, group);
  }

  const userByID = new Map<string, CompanyUser>();
  for (const user of directory.users) {
    const userID = user.user_id.trim();
    if (userID && !userByID.has(userID)) userByID.set(userID, user);
  }

  const childrenByParent = new Map<string, CompanyUserGroup[]>();
  for (const group of groupByID.values()) {
    const parentID = group.parent_group_id?.trim() ?? "";
    const effectiveParentID = parentID && groupByID.has(parentID) && parentID !== group.group_id.trim() ? parentID : "";
    const bucket = childrenByParent.get(effectiveParentID) ?? [];
    bucket.push(group);
    childrenByParent.set(effectiveParentID, bucket);
  }
  for (const bucket of childrenByParent.values()) bucket.sort(compareDirectoryGroups);

  const membershipsByGroup = new Map<string, string[]>();
  const groupedUserIDs = new Set<string>();
  for (const member of directory.members) {
    const groupID = member.group_id.trim();
    const userID = member.user_id.trim();
    if (!groupID || !userID || !groupByID.has(groupID) || !userByID.has(userID)) continue;
    groupedUserIDs.add(userID);
    const bucket = membershipsByGroup.get(groupID) ?? [];
    if (!bucket.includes(userID)) bucket.push(userID);
    membershipsByGroup.set(groupID, bucket);
  }

  const rows: MyWorkPersonDirectoryRow[] = [];
  const emittedGroupIDs = new Set<string>();
  const buildGroupRows = (group: CompanyUserGroup, depth: number, ancestors: Set<string>): MyWorkPersonDirectoryRow[] => {
    const groupID = group.group_id.trim();
    if (!groupID || ancestors.has(groupID)) return [];
    emittedGroupIDs.add(groupID);
    const nextAncestors = new Set(ancestors).add(groupID);
    const childRows = (childrenByParent.get(groupID) ?? []).flatMap((child) => buildGroupRows(child, depth + 1, nextAncestors));
    const users = (membershipsByGroup.get(groupID) ?? [])
      .map((userID) => userByID.get(userID))
      .filter((user): user is CompanyUser => Boolean(user && directoryUserMatches(user, cleanQuery)))
      .sort(compareDirectoryUsers);
    const userRows: MyWorkPersonDirectoryRow[] = users.map((user) => ({
      kind: "user",
      key: `team:${groupID}:user:${user.user_id.trim()}`,
      userID: user.user_id.trim(),
      label: directoryUserLabel(user, user.user_id),
      email: user.email?.trim() ?? "",
      depth: depth + 1,
      groupID,
    }));
    if (childRows.length === 0 && userRows.length === 0) return [];
    return [
      { kind: "group", key: `team:${groupID}`, groupID, label: directoryGroupLabel(group, groupID), depth },
      ...childRows,
      ...userRows,
    ];
  };

  for (const group of childrenByParent.get("") ?? []) rows.push(...buildGroupRows(group, 0, new Set()));
  for (const group of [...groupByID.values()].sort(compareDirectoryGroups)) {
    if (!emittedGroupIDs.has(group.group_id.trim())) rows.push(...buildGroupRows(group, 0, new Set()));
  }

  const ungroupedUsers = [...userByID.values()]
    .filter((user) => !groupedUserIDs.has(user.user_id.trim()) && directoryUserMatches(user, cleanQuery))
    .sort(compareDirectoryUsers);
  if (ungroupedUsers.length > 0) {
    rows.push({ kind: "group", key: "team:none", groupID: "", label: "No team", depth: 0, ungrouped: true });
    rows.push(...ungroupedUsers.map((user) => ({
      kind: "user" as const,
      key: `team:none:user:${user.user_id.trim()}`,
      userID: user.user_id.trim(),
      label: directoryUserLabel(user, user.user_id),
      email: user.email?.trim() ?? "",
      depth: 1,
    })));
  }
  return rows;
}

export function MyWorkPersonPicker({
  companyID,
  viewerUserID,
  selectedUserID,
  requestJSON,
  onSelect,
}: MyWorkPersonPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const peopleButtonRef = useRef<HTMLButtonElement | null>(null);
  const loadVersionRef = useRef(0);
  const [directory, setDirectory] = useState<MyWorkPersonDirectory>({ users: [], groups: [], members: [] });
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const portalTarget = useAppOverlayPortalTarget(rootRef.current?.ownerDocument);
  const resultsPosition = useFloatingLayerPosition(rootRef, open, { width: 390, maxHeight: 440 });

  const directoryScopeKey = `${companyID.trim()}:${viewerUserID.trim()}`;

  useEffect(() => {
    loadVersionRef.current += 1;
    setDirectory({ users: [], groups: [], members: [] });
    setLoadedScopeKey("");
    setLoading(false);
    setError("");
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [directoryScopeKey, requestJSON]);

  useEffect(() => {
    if (!open || loadedScopeKey === directoryScopeKey) return;
    const version = ++loadVersionRef.current;
    const controller = new AbortController();
    setDirectory({ users: [], groups: [], members: [] });
    setLoading(true);
    setError("");
    void fetchMyWorkPersonDirectory(requestJSON, companyID, controller.signal)
      .then((nextDirectory) => {
        if (controller.signal.aborted || loadVersionRef.current !== version) return;
        setDirectory(nextDirectory);
        setLoadedScopeKey(directoryScopeKey);
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted || loadVersionRef.current !== version) return;
        setDirectory({ users: [], groups: [], members: [] });
        setLoading(false);
        setError(cause instanceof Error && cause.message.trim() ? cause.message : "Company people could not be loaded.");
      });
    return () => {
      controller.abort();
      if (loadVersionRef.current === version) loadVersionRef.current += 1;
    };
  }, [companyID, directoryScopeKey, loadedScopeKey, open, requestJSON]);

  const userByID = useMemo(() => {
    return new Map(directory.users.map((user) => [user.user_id.trim(), user]));
  }, [directory.users]);
  const viewer = userByID.get(viewerUserID.trim());
  const selectedUser = userByID.get(selectedUserID.trim());
  const viewerLabel = directoryUserLabel(viewer, viewerUserID);
  const selectedLabel = selectedUserID.trim() === viewerUserID.trim()
    ? "My Work (You)"
    : `Viewing ${directoryUserLabel(selectedUser, selectedUserID)}`;
  const rows = useMemo(() => buildMyWorkPersonDirectoryRows(directory, query), [directory, query]);
  const showSelf = !query.trim()
    || editorCompanyUserMatches(viewer ?? { user_id: viewerUserID }, query)
    || "my work you".includes(query.trim().toLocaleLowerCase());
  const options = useMemo<DirectoryOption[]>(() => {
    const next: DirectoryOption[] = [];
    if (showSelf && viewerUserID.trim()) {
      next.push({ key: "self", id: "my-work-person-option-self", userID: viewerUserID.trim(), label: viewerLabel });
    }
    for (const row of rows) {
      if (row.kind !== "user") continue;
      next.push({
        key: row.key,
        id: `my-work-person-option-${next.length}`,
        userID: row.userID,
        label: row.label,
      });
    }
    return next;
  }, [rows, showSelf, viewerLabel, viewerUserID]);
  const optionByKey = useMemo(() => new Map(options.map((option, index) => [option.key, { option, index }])), [options]);
  const activeOption = options[Math.min(activeIndex, Math.max(0, options.length - 1))];

  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open || !activeOption || !resultsRef.current) return;
    const element = resultsRef.current.querySelector<HTMLElement>(`#${activeOption.id}`);
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeOption, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };
  useAppFloatingMenuDismissal(open, rootRef, close, resultsRef);

  const focusSearch = () => {
    const input = rootRef.current?.querySelector<HTMLInputElement>("input[role=combobox]");
    input?.focus({ preventScroll: true });
    input?.select();
  };
  const openAndFocusSearch = () => {
    setOpen(true);
    window.requestAnimationFrame(focusSearch);
  };
  const choose = (userID: string, label: string) => {
    onSelect({ userID, label });
    close();
    window.requestAnimationFrame(() => peopleButtonRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div ref={rootRef} data-my-work-person-picker="true" style={pickerRootStyle}>
      <span data-my-work-selected-subject="true" style={selectedSubjectStyle} title={selectedLabel}>{selectedLabel}</span>
      <div data-my-work-header-search="people" style={searchClusterStyle}>
        <CompanyUserSearchPicker
          id="my-work-person-search"
          inputAriaLabel="Search company people"
          resultsAriaLabel="Company people by team"
          query={query}
          placeholder="Search people"
          accent="rgba(59,130,246,0.34)"
          activeDescendant={activeOption?.id}
          showResults={open && Boolean(resultsPosition)}
          hasResults={loading || Boolean(error) || options.length > 0}
          emptyMessage="No matching company people"
          onQueryChange={(nextQuery) => {
            setQuery(nextQuery);
            setOpen(true);
          }}
          onInputFocus={() => setOpen(true)}
          onInputKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (options.length === 0) return;
              setActiveIndex((current) => event.key === "ArrowDown"
                ? (current + 1) % options.length
                : (current - 1 + options.length) % options.length);
              return;
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setActiveIndex(event.key === "Home" ? 0 : Math.max(0, options.length - 1));
              return;
            }
            if (event.key === "Enter" && activeOption) {
              event.preventDefault();
              choose(activeOption.userID, activeOption.label);
            }
          }}
          style={{ minWidth: 0 }}
          inputStyle={personSearchInputStyle}
          resultsPortalTarget={portalTarget}
          resultsContainerRef={resultsRef}
          listStyle={resultsPosition ? personResultsStyle(resultsPosition) : undefined}
          onBlur={(event) => {
            const related = event.relatedTarget;
            if (related instanceof Node && (rootRef.current?.contains(related) || resultsRef.current?.contains(related))) return;
            close();
          }}
        >
          {loading ? <div role="status" style={statusStyle}>Loading company people…</div> : null}
          {error ? <div role="alert" style={errorStyle}>{error}</div> : null}
          {!loading && showSelf && viewerUserID.trim() ? (
            <PersonOption
              id="my-work-person-option-self"
              label="My Work (You)"
              meta={viewerLabel}
              selected={selectedUserID.trim() === viewerUserID.trim()}
              active={activeOption?.key === "self"}
              onHover={() => setActiveIndex(optionByKey.get("self")?.index ?? 0)}
              onChoose={() => choose(viewerUserID.trim(), viewerLabel)}
            />
          ) : null}
          {!loading && rows.map((row) => {
            if (row.kind === "group") {
              return (
                <div
                  key={row.key}
                  role="presentation"
                  data-my-work-person-team={row.ungrouped ? "none" : row.groupID}
                  data-my-work-person-depth={row.depth}
                  style={teamHeadingStyle(row.depth, Boolean(row.ungrouped))}
                >
                  <HuddlePeopleIcon color={row.ungrouped ? "#64748b" : "#2563eb"} size={13} />
                  <span>{row.label}</span>
                </div>
              );
            }
            const indexed = optionByKey.get(row.key);
            if (!indexed) return null;
            return (
              <PersonOption
                key={row.key}
                id={indexed.option.id}
                label={row.label}
                meta={row.email}
                depth={row.depth}
                selected={row.userID === selectedUserID.trim()}
                active={activeOption?.key === row.key}
                onHover={() => setActiveIndex(indexed.index)}
                onChoose={() => choose(row.userID, row.label)}
              />
            );
          })}
        </CompanyUserSearchPicker>
        <button
          ref={peopleButtonRef}
          type="button"
          aria-label="Choose whose My Work to view"
          title="Choose whose My Work to view"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="my-work-person-search-options"
          data-my-work-people-button="true"
          onClick={() => {
            if (open) close();
            else openAndFocusSearch();
          }}
          style={peopleButtonStyle(open)}
        >
          <HuddlePeopleIcon color={open ? "#2563eb" : "#475569"} size={17} />
        </button>
      </div>
    </div>
  );
}

function PersonOption({
  id,
  label,
  meta,
  depth = 0,
  selected,
  active,
  onHover,
  onChoose,
}: {
  id: string;
  label: string;
  meta: string;
  depth?: number;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      data-my-work-person-option="true"
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onChoose}
      style={personOptionStyle(depth, selected, active)}
    >
      <span aria-hidden="true" style={personAvatarStyle}>
        {personInitials(label)}
      </span>
      <span style={personOptionTextStyle}>
        <span style={personOptionLabelStyle}>{label}</span>
        {meta ? <span style={personOptionMetaStyle}>{meta}</span> : null}
      </span>
      {selected ? <span aria-hidden="true" style={selectedCheckStyle}>✓</span> : null}
    </button>
  );
}

function assertDirectoryCompanyScope(
  rows: ReadonlyArray<{ company_id?: string }>,
  companyID: string,
  label: string,
): void {
  if (!companyID || rows.some((row) => row.company_id?.trim() !== companyID)) {
    throw new Error(`Company ${label} directory scope did not match the request.`);
  }
}

function directoryUserLabel(user: Pick<CompanyUser, "display_name" | "email"> | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID.trim() || "Company user";
}

function directoryGroupLabel(group: Pick<CompanyUserGroup, "name"> | undefined, fallbackGroupID: string): string {
  return group?.name?.trim() || fallbackGroupID.trim() || "Team";
}

function personInitials(label: string): string {
  return label.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join("") || "?";
}

function directoryUserMatches(user: CompanyUser, query: string): boolean {
  return !query || editorCompanyUserMatches(user, query);
}

function compareDirectoryUsers(left: CompanyUser, right: CompanyUser): number {
  return directoryUserLabel(left, left.user_id).localeCompare(directoryUserLabel(right, right.user_id), undefined, {
    numeric: true,
    sensitivity: "base",
  }) || left.user_id.localeCompare(right.user_id);
}

function compareDirectoryGroups(left: CompanyUserGroup, right: CompanyUserGroup): number {
  return (left.position - right.position)
    || directoryGroupLabel(left, left.group_id).localeCompare(directoryGroupLabel(right, right.group_id), undefined, {
      numeric: true,
      sensitivity: "base",
    })
    || left.group_id.localeCompare(right.group_id);
}

const pickerRootStyle: React.CSSProperties = {
  minWidth: 0,
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 9,
};

const selectedSubjectStyle: React.CSSProperties = {
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#475569",
  fontSize: 11,
  fontWeight: 850,
};

const searchClusterStyle: React.CSSProperties = {
  width: "min(340px, 38vw)",
  minWidth: 220,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 34px",
  alignItems: "center",
  gap: 6,
};

const personSearchInputStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  minHeight: 32,
  borderRadius: 10,
  background: "linear-gradient(145deg, rgba(255,255,255,.98), rgba(239,246,255,.88))",
  boxShadow: "inset 2px 2px 5px rgba(148,163,184,.12), inset -2px -2px 5px rgba(255,255,255,.86)",
  padding: "0 10px",
};

function peopleButtonStyle(open: boolean): React.CSSProperties {
  return {
    width: 34,
    height: 32,
    display: "grid",
    placeItems: "center",
    border: open ? "1px solid rgba(37,99,235,.46)" : "1px solid rgba(148,163,184,.26)",
    borderRadius: 10,
    background: open ? "linear-gradient(145deg,#eff6ff,#ede9fe)" : "linear-gradient(145deg,#ffffff,#f1f5f9)",
    boxShadow: open
      ? "0 7px 16px rgba(37,99,235,.16), inset 1px 1px 0 rgba(255,255,255,.9)"
      : "3px 3px 8px rgba(148,163,184,.18), -2px -2px 6px rgba(255,255,255,.86)",
    cursor: "pointer",
    padding: 0,
  };
}

function personResultsStyle(position: { left: number; top: number; width: number; maxHeight: number }): React.CSSProperties {
  return {
    position: "fixed",
    zIndex: 10020,
    left: position.left,
    top: position.top,
    width: position.width,
    maxHeight: position.maxHeight,
    overflowY: "auto",
    gap: 4,
    padding: 8,
    border: "1px solid rgba(148,163,184,.30)",
    borderRadius: 12,
    background: "linear-gradient(145deg,rgba(255,255,255,.99),rgba(248,250,252,.98))",
    boxShadow: "0 22px 48px rgba(15,23,42,.20), inset 1px 1px 0 rgba(255,255,255,.94)",
    boxSizing: "border-box",
  };
}

function teamHeadingStyle(depth: number, ungrouped: boolean): React.CSSProperties {
  return {
    minHeight: 27,
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginTop: depth === 0 ? 4 : 1,
    marginLeft: depth * 16,
    borderBottom: `1px solid ${ungrouped ? "rgba(100,116,139,.18)" : "rgba(37,99,235,.16)"}`,
    color: ungrouped ? "#64748b" : "#1e40af",
    fontSize: 10.5,
    fontWeight: 900,
    padding: "2px 7px",
  };
}

function personOptionStyle(depth: number, selected: boolean, active: boolean): React.CSSProperties {
  return {
    width: `calc(100% - ${depth * 16}px)`,
    minHeight: 38,
    marginLeft: depth * 16,
    display: "grid",
    gridTemplateColumns: "28px minmax(0,1fr) auto",
    alignItems: "center",
    gap: 8,
    border: selected
      ? "1px solid rgba(37,99,235,.58)"
      : active
        ? "1px solid rgba(99,102,241,.34)"
        : "1px solid transparent",
    borderRadius: 9,
    background: selected
      ? "linear-gradient(145deg,rgba(219,234,254,.92),rgba(238,242,255,.88))"
      : active
        ? "rgba(239,246,255,.72)"
        : "transparent",
    color: "#172033",
    cursor: "pointer",
    padding: "4px 8px",
    textAlign: "left",
    boxSizing: "border-box",
  };
}

const personAvatarStyle: React.CSSProperties = {
  width: 27,
  height: 27,
  display: "grid",
  placeItems: "center",
  borderRadius: 999,
  background: "linear-gradient(145deg,#2563eb,#7c3aed)",
  color: "#ffffff",
  boxShadow: "2px 2px 6px rgba(148,163,184,.20), -2px -2px 5px rgba(255,255,255,.75)",
  fontSize: 9,
  fontWeight: 900,
};

const personOptionTextStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 1 };
const personOptionLabelStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 850 };
const personOptionMetaStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 650 };
const selectedCheckStyle: React.CSSProperties = { color: "#2563eb", fontSize: 13, fontWeight: 900 };
const statusStyle: React.CSSProperties = { padding: "9px 10px", color: "#64748b", fontSize: 11, fontWeight: 700 };
const errorStyle: React.CSSProperties = { padding: "9px 10px", borderRadius: 8, background: "rgba(254,226,226,.72)", color: "#991b1b", fontSize: 11, fontWeight: 750 };
