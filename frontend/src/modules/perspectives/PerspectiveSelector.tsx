import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember } from "../communications/communicationsApi.js";

export type CompanyPerspectiveScope = "mine" | "team" | "company";
export type CompanyPerspectiveSubjectType = "user" | "group" | "company";

export type CompanyPerspective = {
  scope: CompanyPerspectiveScope;
  subjectType: CompanyPerspectiveSubjectType;
  subjectID: string;
};

type CompanyPerspectiveSelectorProps = {
  companyUsers: CompanyUser[];
  groups: CompanyUserGroup[];
  groupMembers: CompanyUserGroupMember[];
  currentUserID: string;
  value: CompanyPerspective;
  onChange: (value: CompanyPerspective) => void;
  label?: string;
  compact?: boolean;
};

export function companyUserDisplayLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID.trim() || "User";
}

export function companyGroupDisplayLabel(group: Pick<CompanyUserGroup, "group_id" | "name"> | null | undefined, fallbackGroupID: string): string {
  return group?.name?.trim() || fallbackGroupID.trim() || "Team";
}

export function perspectiveStorageKey(perspective: CompanyPerspective, currentUserID = ""): string {
  if (perspective.subjectType === "company" || perspective.scope === "company") return "company";
  const subjectID = perspective.subjectID.trim() || currentUserID.trim();
  return `${perspective.subjectType}:${subjectID}`;
}

export function userIDsForPerspective(
  perspective: CompanyPerspective,
  groupMembers: CompanyUserGroupMember[],
  currentUserID: string,
): Set<string> | null {
  if (perspective.scope === "company" || perspective.subjectType === "company") return null;
  if (perspective.subjectType === "group") {
    const groupID = perspective.subjectID.trim();
    return new Set(groupMembers.filter((member) => member.group_id.trim() === groupID).map((member) => member.user_id.trim()).filter(Boolean));
  }
  const userID = perspective.subjectID.trim() || currentUserID.trim();
  return new Set(userID ? [userID] : []);
}

export function firstCurrentUserGroupID(groups: CompanyUserGroup[], members: CompanyUserGroupMember[], currentUserID: string): string {
  const cleanUserID = currentUserID.trim();
  if (!cleanUserID) return "";
  const ownGroupIDs = new Set(members.filter((member) => member.user_id.trim() === cleanUserID).map((member) => member.group_id.trim()).filter(Boolean));
  return groups
    .filter((group) => ownGroupIDs.has(group.group_id.trim()))
    .sort((left, right) => (
      left.position - right.position ||
      companyGroupDisplayLabel(left, left.group_id).localeCompare(companyGroupDisplayLabel(right, right.group_id), undefined, { numeric: true, sensitivity: "base" }) ||
      left.group_id.localeCompare(right.group_id)
    ))[0]?.group_id ?? "";
}

export function normalizeCompanyPerspective(
  perspective: CompanyPerspective,
  currentUserID: string,
  groups: CompanyUserGroup[],
  members: CompanyUserGroupMember[],
): CompanyPerspective {
  if (perspective.scope === "company" || perspective.subjectType === "company") {
    return { scope: "company", subjectType: "company", subjectID: "company" };
  }
  if (perspective.subjectType === "group") {
    const groupID = perspective.subjectID.trim() || firstCurrentUserGroupID(groups, members, currentUserID);
    return groupID
      ? { scope: "team", subjectType: "group", subjectID: groupID }
      : { scope: "mine", subjectType: "user", subjectID: currentUserID.trim() };
  }
  return { scope: "mine", subjectType: "user", subjectID: perspective.subjectID.trim() || currentUserID.trim() };
}

export function companyPerspectiveLabel(
  perspective: CompanyPerspective,
  companyUsers: CompanyUser[],
  groups: CompanyUserGroup[],
  currentUserID: string,
): string {
  if (perspective.scope === "company" || perspective.subjectType === "company") return "Company";
  if (perspective.subjectType === "group") {
    const group = groups.find((item) => item.group_id.trim() === perspective.subjectID.trim());
    return companyGroupDisplayLabel(group, perspective.subjectID);
  }
  const userID = perspective.subjectID.trim() || currentUserID.trim();
  const user = companyUsers.find((item) => item.user_id.trim() === userID);
  return userID && userID === currentUserID.trim() ? "My view" : companyUserDisplayLabel(user, userID);
}

function companyUserSearchText(user: Pick<CompanyUser, "user_id" | "display_name" | "email">): string {
  return `${user.display_name ?? ""} ${user.email ?? ""} ${user.user_id}`.trim().toLowerCase();
}

export function CompanyPerspectiveSelector({
  companyUsers,
  groups,
  groupMembers,
  currentUserID,
  value,
  onChange,
  label = "Perspective",
  compact = false,
}: CompanyPerspectiveSelectorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id.trim(), user])), [companyUsers]);
  const normalized = useMemo(() => normalizeCompanyPerspective(value, currentUserID, groups, groupMembers), [currentUserID, groupMembers, groups, value]);
  const membersByGroupID = useMemo(() => {
    const grouped = new Map<string, CompanyUserGroupMember[]>();
    for (const member of groupMembers) {
      const groupID = member.group_id.trim();
      if (!groupID) continue;
      const bucket = grouped.get(groupID) ?? [];
      bucket.push(member);
      grouped.set(groupID, bucket);
    }
    for (const list of grouped.values()) {
      list.sort((left, right) => (
        companyUserDisplayLabel(userByID.get(left.user_id.trim()), left.user_id).localeCompare(
          companyUserDisplayLabel(userByID.get(right.user_id.trim()), right.user_id),
          undefined,
          { numeric: true, sensitivity: "base" },
        ) ||
        left.user_id.localeCompare(right.user_id)
      ));
    }
    return grouped;
  }, [groupMembers, userByID]);
  const selectedLabel = companyPerspectiveLabel(normalized, companyUsers, groups, currentUserID);
  const currentUser = userByID.get(currentUserID.trim());
  const currentUserLabel = companyUserDisplayLabel(currentUser, currentUserID);
  const firstTeamID = useMemo(() => firstCurrentUserGroupID(groups, groupMembers, currentUserID), [currentUserID, groupMembers, groups]);
  const sortedGroups = useMemo(() => (
    [...groups].sort((left, right) => (
      left.position - right.position ||
      companyGroupDisplayLabel(left, left.group_id).localeCompare(companyGroupDisplayLabel(right, right.group_id), undefined, { numeric: true, sensitivity: "base" }) ||
      left.group_id.localeCompare(right.group_id)
    ))
  ), [groups]);
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return companyUsers;
    return companyUsers.filter((user) => companyUserSearchText(user).includes(query));
  }, [companyUsers, search]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const choose = (next: CompanyPerspective) => {
    onChange(normalizeCompanyPerspective(next, currentUserID, groups, groupMembers));
    setOpen(false);
  };
  const chooseMine = () => choose({ scope: "mine", subjectType: "user", subjectID: currentUserID.trim() });
  const chooseTeam = () => choose({ scope: "team", subjectType: "group", subjectID: firstTeamID || sortedGroups[0]?.group_id || "" });
  const chooseCompany = () => choose({ scope: "company", subjectType: "company", subjectID: "company" });

  return (
    <div ref={rootRef} style={selectorRootStyle(compact)}>
      <div style={selectorLabelStyle}>{label}</div>
      <div style={scopeToggleStyle}>
        <button type="button" style={scopeButtonStyle(normalized.scope === "mine")} onClick={chooseMine}>My</button>
        <button type="button" style={scopeButtonStyle(normalized.scope === "team")} onClick={chooseTeam}>Teams</button>
        <button type="button" style={scopeButtonStyle(normalized.scope === "company")} onClick={chooseCompany}>Company</button>
      </div>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        style={dropdownButtonStyle(open, compact)}
      >
        <span style={dropdownLabelStyle}>{selectedLabel}</span>
        <span aria-hidden="true" style={chevronStyle}>v</span>
      </button>
      {open && (
        <div className="kanban-board-scroll" style={dropdownStyle}>
          <button type="button" onClick={chooseCompany} style={menuRowStyle(normalized.subjectType === "company")}>
            <span style={menuRowTextStyle}>Company</span>
            {normalized.subjectType === "company" && <span style={checkStyle}>{"\u2713"}</span>}
          </button>
          {sortedGroups.map((group) => {
            const groupID = group.group_id.trim();
            const selected = normalized.subjectType === "group" && normalized.subjectID.trim() === groupID;
            const members = membersByGroupID.get(groupID) ?? [];
            return (
              <div key={groupID} style={groupBlockStyle(groupID)}>
                <button
                  type="button"
                  onClick={() => choose({ scope: "team", subjectType: "group", subjectID: groupID })}
                  style={groupRowStyle(groupID, selected)}
                >
                  <span style={groupDotStyle(groupID)} />
                  <span style={menuRowTextStyle}>{companyGroupDisplayLabel(group, groupID)}</span>
                  <span style={memberCountStyle}>{members.length}</span>
                  {selected && <span style={checkStyle}>{"\u2713"}</span>}
                </button>
                {members.length > 0 && (
                  <div style={nestedUsersStyle}>
                    {members.slice(0, 8).map((member) => {
                      const userID = member.user_id.trim();
                      const user = userByID.get(userID);
                      return (
                        <button
                          key={`${groupID}:${userID}`}
                          type="button"
                          onClick={() => choose({ scope: "mine", subjectType: "user", subjectID: userID })}
                          style={nestedUserStyle(normalized.subjectType === "user" && normalized.subjectID.trim() === userID)}
                        >
                          {companyUserDisplayLabel(user, userID)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div style={searchWrapStyle}>
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search people"
              aria-label="Search people"
              spellCheck={false}
              style={searchInputStyle}
            />
          </div>
          <div style={usersListStyle}>
            {currentUserID.trim() && (
              <button type="button" onClick={chooseMine} style={menuRowStyle(normalized.subjectType === "user" && normalized.subjectID.trim() === currentUserID.trim())}>
                <span style={menuRowTextStyle}>{currentUserLabel}</span>
                <span style={memberCountStyle}>Me</span>
              </button>
            )}
            {searchResults.slice(0, 24).map((user) => {
              const userID = user.user_id.trim();
              if (!userID || userID === currentUserID.trim()) return null;
              const selected = normalized.subjectType === "user" && normalized.subjectID.trim() === userID;
              return (
                <button key={userID} type="button" onClick={() => choose({ scope: "mine", subjectType: "user", subjectID: userID })} style={menuRowStyle(selected)}>
                  <span style={menuRowTextStyle}>{companyUserDisplayLabel(user, userID)}</span>
                  {user.email?.trim() && <span style={memberCountStyle}>{user.email}</span>}
                  {selected && <span style={checkStyle}>{"\u2713"}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function selectorRootStyle(compact: boolean): React.CSSProperties {
  return {
    position: "relative",
    zIndex: 12,
    minWidth: compact ? 248 : 342,
    display: "grid",
    gridTemplateColumns: compact ? "minmax(0, 1fr)" : "auto auto minmax(132px, 1fr)",
    alignItems: "center",
    gap: compact ? 6 : 8,
  };
}

const selectorLabelStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
};

const scopeToggleStyle: React.CSSProperties = {
  height: 30,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 2,
  padding: 2,
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.62)",
  boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.86)",
  boxSizing: "border-box",
};

function scopeButtonStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    height: "100%",
    border: active ? "1px solid rgba(71, 85, 105, 0.36)" : "1px solid transparent",
    borderRadius: 6,
    background: active ? "#ffffff" : "transparent",
    color: active ? "#111827" : "#64748b",
    boxShadow: active ? "0 3px 8px rgba(15, 23, 42, 0.10)" : "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 900,
    padding: "0 7px",
  };
}

function dropdownButtonStyle(open: boolean, compact: boolean): React.CSSProperties {
  return {
    height: 30,
    minWidth: compact ? 0 : 154,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 9px",
    border: `1px solid ${open ? "rgba(59, 130, 246, 0.42)" : "rgba(148, 163, 184, 0.22)"}`,
    borderRadius: 8,
    background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(247, 249, 252, 0.86))",
    color: "#334155",
    boxShadow: open ? "0 8px 18px rgba(59, 130, 246, 0.13)" : "4px 4px 10px rgba(174, 174, 192, 0.18), -4px -4px 10px rgba(255, 255, 255, 0.82)",
    cursor: "pointer",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
}

const dropdownLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 900,
};

const chevronStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 900,
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 36,
  width: 340,
  maxHeight: 430,
  overflowY: "auto",
  display: "grid",
  gap: 8,
  padding: 9,
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.99), rgba(248, 250, 252, 0.95))",
  boxShadow: "0 20px 44px rgba(15, 23, 42, 0.18), inset 1px 1px 0 rgba(255, 255, 255, 0.94)",
  boxSizing: "border-box",
};

function menuRowStyle(selected: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 32,
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: selected ? "1px solid rgba(37, 99, 235, 0.68)" : "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 7,
    background: selected ? "linear-gradient(145deg, rgba(219, 234, 254, 0.94), rgba(239, 246, 255, 0.82))" : "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.78))",
    color: "#334155",
    boxShadow: selected ? "0 5px 14px rgba(37, 99, 235, 0.14)" : "0 3px 9px rgba(15, 23, 42, 0.06), inset 1px 1px 0 rgba(255, 255, 255, 0.86)",
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "0 8px",
    textAlign: "left",
    boxSizing: "border-box",
  };
}

const menuRowTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 850,
};

const memberCountStyle: React.CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: 110,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 800,
};

const checkStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#2563eb",
  fontSize: 12,
  fontWeight: 900,
};

const colorPalette = [
  { accent: "#06b6d4", border: "rgba(6, 182, 212, 0.30)", tint: "rgba(207, 250, 254, 0.58)", text: "#155e75" },
  { accent: "#22c55e", border: "rgba(34, 197, 94, 0.30)", tint: "rgba(220, 252, 231, 0.58)", text: "#166534" },
  { accent: "#8b5cf6", border: "rgba(139, 92, 246, 0.28)", tint: "rgba(237, 233, 254, 0.58)", text: "#5b21b6" },
  { accent: "#f97316", border: "rgba(249, 115, 22, 0.30)", tint: "rgba(255, 237, 213, 0.58)", text: "#9a3412" },
];

function colorForID(id: string): (typeof colorPalette)[number] {
  const clean = id.trim() || "default";
  let hash = 0;
  for (let index = 0; index < clean.length; index += 1) hash = ((hash * 31) + clean.charCodeAt(index)) >>> 0;
  return colorPalette[hash % colorPalette.length];
}

function groupBlockStyle(groupID: string): React.CSSProperties {
  const color = colorForID(groupID);
  return {
    display: "grid",
    gap: 5,
    padding: 6,
    border: `1px solid ${color.border}`,
    borderLeft: `3px solid ${color.accent}`,
    borderRadius: 8,
    background: `linear-gradient(145deg, rgba(255, 255, 255, 0.98), ${color.tint})`,
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.07), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
  };
}

function groupRowStyle(groupID: string, selected: boolean): React.CSSProperties {
  const color = colorForID(groupID);
  return {
    ...menuRowStyle(selected),
    color: color.text,
    border: selected ? `1px solid ${color.accent}` : "1px solid transparent",
    background: selected ? "rgba(255, 255, 255, 0.72)" : "rgba(255, 255, 255, 0.52)",
    boxShadow: selected ? "0 4px 11px rgba(15, 23, 42, 0.08)" : "none",
  };
}

function groupDotStyle(groupID: string): React.CSSProperties {
  const color = colorForID(groupID);
  return {
    width: 8,
    height: 8,
    flex: "0 0 8px",
    borderRadius: 999,
    background: color.accent,
  };
}

const nestedUsersStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  paddingLeft: 17,
};

function nestedUserStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 24,
    border: selected ? "1px solid rgba(37, 99, 235, 0.62)" : "1px solid transparent",
    borderRadius: 6,
    background: selected ? "rgba(219, 234, 254, 0.74)" : "rgba(255, 255, 255, 0.44)",
    color: "#334155",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 800,
    padding: "0 7px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
  };
}

const searchWrapStyle: React.CSSProperties = {
  paddingTop: 3,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  height: 30,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.76)",
  color: "#334155",
  outline: "none",
  padding: "0 9px",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 800,
  boxSizing: "border-box",
};

const usersListStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
};
