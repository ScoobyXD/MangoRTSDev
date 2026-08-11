import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { apiFetchJSON, formatAuthError, type CurrentUserResponse } from "../../auth/cognitoAuth.js";
import {
  listCompanyUserGroups,
  listCompanyUsers,
  markCommunicationsWorkspaceResourcesStale,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
} from "../communications/communicationsApi.js";

type TeamsContentProps = {
  accent?: string;
  me?: CurrentUserResponse;
};

export const TeamsContent: React.FC<TeamsContentProps> = ({ accent = "#6366f1", me }) => {
  const companyID = getActiveCompanyID();
  const selectedMembership = me?.memberships.find((membership) => membership.company_id === companyID) ?? null;
  const companyLabel = selectedMembership?.company_name?.trim() || "Selected company";
  const canManageTeams = Boolean(companyID) && (!me || me.is_dev_admin || selectedMembership?.role === "company_admin" || selectedMembership?.role === "company_manager");
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [members, setMembers] = useState<CompanyUserGroupMember[]>([]);
  const [selectedGroupID, setSelectedGroupID] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newChildGroupName, setNewChildGroupName] = useState("");
  const [memberDraft, setMemberDraft] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const childGroupNameInputRef = useRef<HTMLInputElement | null>(null);

  const selectedGroup = groups.find((group) => group.group_id === selectedGroupID) ?? null;
  const groupsByParent = useMemo(() => {
    const grouped = new Map<string, CompanyUserGroup[]>();
    for (const group of groups) {
      const parentID = group.parent_group_id?.trim() ?? "";
      const list = grouped.get(parentID) ?? [];
      list.push(group);
      grouped.set(parentID, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name) || a.group_id.localeCompare(b.group_id));
    }
    return grouped;
  }, [groups]);

  const memberCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members) counts.set(member.group_id, (counts.get(member.group_id) ?? 0) + 1);
    return counts;
  }, [members]);

  const loadTeams = useCallback(async () => {
    if (!companyID || !canManageTeams) {
      setUsers([]);
      setGroups([]);
      setMembers([]);
      setSelectedGroupID("");
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    const [usersResult, groupsResult] = await Promise.allSettled([
      listCompanyUsers(companyID),
      listCompanyUserGroups(companyID),
    ]);
    const warnings: string[] = [];
    if (usersResult.status === "fulfilled") {
      setUsers(usersResult.value.map((user) => ({ ...user, email: user.email ?? "", role: user.role ?? "company_user" })));
    } else {
      console.error("Teams users load failed", usersResult.reason);
      setUsers([]);
      warnings.push(formatAuthError(usersResult.reason, "Failed to load users"));
    }
    if (groupsResult.status === "fulfilled") {
      const nextGroups = groupsResult.value.groups ?? [];
      setGroups(nextGroups);
      setMembers(groupsResult.value.members ?? []);
      setSelectedGroupID((previous) => nextGroups.some((group) => group.group_id === previous) ? previous : nextGroups[0]?.group_id ?? "");
    } else {
      console.error("Teams groups load failed", groupsResult.reason);
      setGroups([]);
      setMembers([]);
      setSelectedGroupID("");
      warnings.push(formatAuthError(groupsResult.reason, "Failed to load teams"));
    }
    setError(warnings.join(" "));
    setLoading(false);
  }, [canManageTeams, companyID]);

  useEffect(() => { void loadTeams(); }, [loadTeams]);

  useEffect(() => {
    const memberIDs = members.filter((member) => member.group_id === selectedGroupID).map((member) => member.user_id);
    setMemberDraft(new Set(memberIDs));
  }, [members, selectedGroupID]);

  const createGroup = useCallback(async (parentGroupID = "") => {
    const name = (parentGroupID ? newChildGroupName : newGroupName).trim();
    if (!companyID || !name) {
      setError("Team name required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      markCommunicationsWorkspaceResourcesStale(companyID, { userGroups: true });
      const group = await apiFetchJSON<CompanyUserGroup>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`, {
        method: "POST",
        body: JSON.stringify({ name, parent_group_id: parentGroupID }),
      });
      setGroups((current) => [...current.filter((item) => item.group_id !== group.group_id), group]);
      setSelectedGroupID(group.group_id);
      if (parentGroupID) setNewChildGroupName("");
      else setNewGroupName("");
      markCommunicationsWorkspaceResourcesStale(companyID, { userGroups: true });
      await loadTeams();
    } catch (createError) {
      console.error("Create team failed", createError);
      setError(formatAuthError(createError, "Create team failed"));
    } finally {
      setBusy(false);
    }
  }, [companyID, loadTeams, newChildGroupName, newGroupName]);

  const saveSelectedGroupMembers = useCallback(async () => {
    if (!companyID || !selectedGroupID) return;
    setBusy(true);
    setError("");
    try {
      const payload = await apiFetchJSON<{ members?: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups/${encodeURIComponent(selectedGroupID)}/members`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, user_ids: Array.from(memberDraft) }),
      });
      setMembers((current) => [
        ...current.filter((member) => member.group_id !== selectedGroupID),
        ...(payload.members ?? []),
      ]);
      markCommunicationsWorkspaceResourcesStale(companyID, { userGroups: true });
      await loadTeams();
    } catch (saveError) {
      console.error("Save team users failed", saveError);
      setError(formatAuthError(saveError, "Save team users failed"));
    } finally {
      setBusy(false);
    }
  }, [companyID, loadTeams, memberDraft, selectedGroupID]);

  const deleteSelectedGroup = useCallback(async () => {
    if (!companyID || !selectedGroupID) return;
    setBusy(true);
    setError("");
    try {
      await apiFetchJSON(`/v1/companies/${encodeURIComponent(companyID)}/user-groups/${encodeURIComponent(selectedGroupID)}`, { method: "DELETE" });
      setSelectedGroupID("");
      markCommunicationsWorkspaceResourcesStale(companyID, { userGroups: true });
      await loadTeams();
    } catch (deleteError) {
      console.error("Delete team failed", deleteError);
      setError(formatAuthError(deleteError, "Delete team failed"));
    } finally {
      setBusy(false);
    }
  }, [companyID, loadTeams, selectedGroupID]);

  const toggleDraftMember = useCallback((userID: string) => {
    setMemberDraft((current) => {
      const next = new Set(current);
      if (next.has(userID)) next.delete(userID);
      else next.add(userID);
      return next;
    });
  }, []);

  const renderGroup = useCallback((group: CompanyUserGroup, depth = 0): React.ReactNode => {
    const childGroups = groupsByParent.get(group.group_id) ?? [];
    const selected = selectedGroupID === group.group_id;
    return (
      <div key={group.group_id} style={teamTreeGroupStyle(depth)}>
        <div style={teamTreeRowShellStyle}>
          <button type="button" style={teamTreeRowStyle(selected)} onClick={() => setSelectedGroupID(group.group_id)}>
            <span style={teamTreeRowNameStyle}>{group.name}</span>
            <span style={teamTreeRowCountStyle}>{memberCountByGroup.get(group.group_id) ?? 0}</span>
          </button>
          <button
            type="button"
            title={`Add subgroup under ${group.name}`}
            aria-label={`Add subgroup under ${group.name}`}
            style={teamIconButtonStyle(accent)}
            disabled={busy}
            onClick={() => {
              setSelectedGroupID(group.group_id);
              setNewChildGroupName("");
              window.setTimeout(() => childGroupNameInputRef.current?.focus(), 0);
            }}
          >
            +
          </button>
        </div>
        {childGroups.map((child) => renderGroup(child, depth + 1))}
      </div>
    );
  }, [accent, busy, groupsByParent, memberCountByGroup, selectedGroupID]);

  return (
    <div style={teamsSurfaceStyle}>
      <header style={teamsHeaderStyle}>
        <div style={teamsTitleStackStyle}>
          <h2 style={teamsTitleStyle}>Teams</h2>
          <div style={teamsMetaStyle}>
            {companyID ? `${companyLabel} - ${groups.length} team${groups.length === 1 ? "" : "s"}` : "No company selected"}
            {loading ? " - Loading" : ""}
          </div>
        </div>
        <button type="button" style={teamsSecondaryButtonStyle} disabled={loading || busy || !canManageTeams} onClick={() => void loadTeams()}>
          Refresh
        </button>
      </header>

      <div style={teamsBodyStyle}>
        {error && <div style={teamsErrorStyle}>{error}</div>}
        {!companyID ? (
          <div style={teamsEmptyStateStyle}>Select a company to manage teams.</div>
        ) : !canManageTeams ? (
          <div style={teamsEmptyStateStyle}>Manager or admin access is required to manage teams.</div>
        ) : (
          <div style={teamsLayoutStyle}>
          <section style={teamsColumnStyle}>
            <div style={teamsSectionHeaderStyle}>
              <span>Teams</span>
              <span style={teamsSectionMetaStyle}>{users.length} user{users.length === 1 ? "" : "s"}</span>
            </div>
            <form style={teamsCreateFormStyle} onSubmit={(event) => {
              event.preventDefault();
              void createGroup("");
            }}>
              <input style={teamsInputStyle} value={newGroupName} onChange={(event) => setNewGroupName(event.currentTarget.value)} placeholder="New team name" />
              <button type="submit" style={teamsPrimaryButtonStyle(accent)} disabled={busy || !newGroupName.trim()}>Create</button>
            </form>
            <div className="company-explorer-scroll" style={teamsTreeStyle}>
              {groups.length === 0 ? <div style={teamsEmptyStateStyle}>No teams yet.</div> : (groupsByParent.get("") ?? []).map((group) => renderGroup(group))}
            </div>
          </section>

          <section style={teamsColumnStyle}>
            <div style={teamsSectionHeaderStyle}>
              <span>{selectedGroup?.name || "Team Members"}</span>
              <span style={teamsSectionMetaStyle}>{selectedGroup ? `${memberDraft.size} selected` : "Select a team"}</span>
            </div>
            {selectedGroup ? (
              <>
                <form style={teamsChildFormStyle} onSubmit={(event) => {
                  event.preventDefault();
                  void createGroup(selectedGroup.group_id);
                }}>
                  <input
                    ref={childGroupNameInputRef}
                    style={teamsInputStyle}
                    value={newChildGroupName}
                    onChange={(event) => setNewChildGroupName(event.currentTarget.value)}
                    placeholder={`New subgroup under ${selectedGroup.name}`}
                  />
                  <button type="submit" style={teamsSecondaryButtonStyle} disabled={busy || !newChildGroupName.trim()}>Add subgroup</button>
                </form>
                <div className="company-explorer-scroll" style={teamsMemberListStyle}>
                  {users.length === 0 ? <div style={teamsEmptyStateStyle}>No users available.</div> : users.map((user) => (
                    <label key={user.user_id} style={teamsMemberRowStyle}>
                      <input type="checkbox" checked={memberDraft.has(user.user_id)} onChange={() => toggleDraftMember(user.user_id)} />
                      <span style={teamsMemberNameStyle}>{user.display_name || user.email || user.user_id}</span>
                      <span style={teamsMemberEmailStyle}>{user.email || user.role || ""}</span>
                    </label>
                  ))}
                </div>
                <div style={teamsActionsStyle}>
                  <button type="button" style={teamsDangerButtonStyle} disabled={busy} onClick={() => void deleteSelectedGroup()}>Delete team</button>
                  <button type="button" style={teamsPrimaryButtonStyle(accent)} disabled={busy} onClick={() => void saveSelectedGroupMembers()}>
                    {busy ? "Saving" : "Save users"}
                  </button>
                </div>
              </>
            ) : (
              <div style={teamsEmptyStateStyle}>Select a team to manage users.</div>
            )}
          </section>
          </div>
        )}
      </div>
    </div>
  );
};

const teamsSurfaceStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 12,
  padding: 18,
  boxSizing: "border-box",
  background: "#f8fafc",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
  overflow: "hidden",
};

const teamsBodyStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 12,
  overflow: "hidden",
};
const teamsHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 12,
  borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
  paddingBottom: 12,
};

const teamsTitleStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 3,
};

const teamsTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 22,
  fontWeight: 760,
  letterSpacing: 0,
};

const teamsMetaStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 12,
  fontWeight: 650,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const teamsLayoutStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
  gap: 14,
  overflow: "hidden",
};

const teamsColumnStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto",
  alignContent: "start",
  gap: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: 8,
  background: "#ffffff",
  padding: 12,
  boxSizing: "border-box",
  overflow: "hidden",
};

const teamsSectionHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  color: "#111827",
  fontSize: 13,
  fontWeight: 800,
};

const teamsSectionMetaStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.54)",
  fontSize: 11,
  fontWeight: 700,
};

const teamsCreateFormStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
};

const teamsChildFormStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
};

const teamsInputStyle: React.CSSProperties = {
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#111827",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  outline: "none",
  padding: "0 10px",
};

function teamsPrimaryButtonStyle(accent: string): React.CSSProperties {
  return {
    minHeight: 34,
    border: "1px solid transparent",
    borderRadius: 6,
    background: accent,
    color: "#ffffff",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 760,
    padding: "0 12px",
  };
}

const teamsSecondaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 730,
  padding: "0 12px",
};

const teamsDangerButtonStyle: React.CSSProperties = {
  ...teamsSecondaryButtonStyle,
  color: "#be123c",
  borderColor: "rgba(190, 18, 60, 0.24)",
};

const teamsTreeStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
  overflow: "auto",
  paddingRight: 4,
};

function teamTreeGroupStyle(depth: number): React.CSSProperties {
  return {
    display: "grid",
    gap: 5,
    marginLeft: depth * 14,
  };
}

const teamTreeRowShellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 32px",
  gap: 5,
  alignItems: "stretch",
};

function teamTreeRowStyle(selected: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 34,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    border: `1px solid ${selected ? "rgba(99, 102, 241, 0.34)" : "rgba(100, 116, 139, 0.16)"}`,
    borderRadius: 6,
    background: selected ? "rgba(99, 102, 241, 0.08)" : "#ffffff",
    color: "#111827",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: selected ? 760 : 650,
    padding: "0 10px",
  };
}

const teamTreeRowNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
  textAlign: "left",
};

const teamTreeRowCountStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.54)",
  fontSize: 11,
  fontWeight: 800,
};

function teamIconButtonStyle(accent: string): React.CSSProperties {
  return {
    width: 32,
    minHeight: 34,
    border: "1px solid rgba(100, 116, 139, 0.2)",
    borderRadius: 6,
    background: "#ffffff",
    color: accent,
    cursor: "pointer",
    font: "inherit",
    fontSize: 16,
    fontWeight: 800,
    padding: 0,
  };
}

const teamsMemberListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
  overflow: "auto",
  border: "1px solid rgba(100, 116, 139, 0.14)",
  borderRadius: 6,
  padding: 8,
};

const teamsMemberRowStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 31,
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  color: "#111827",
  fontSize: 12,
  fontWeight: 620,
};

const teamsMemberNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const teamsMemberEmailStyle: React.CSSProperties = {
  minWidth: 0,
  color: "rgba(15, 23, 42, 0.54)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "right",
};

const teamsActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
};

const teamsErrorStyle: React.CSSProperties = {
  color: "#be123c",
  border: "1px solid rgba(190, 18, 60, 0.22)",
  borderRadius: 6,
  background: "#fff1f2",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 700,
};

const teamsEmptyStateStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.56)",
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1.35,
};
