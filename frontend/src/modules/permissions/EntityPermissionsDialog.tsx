import React, { useEffect, useMemo, useState } from "react";
import type { BoundRequestJSON } from "../api/requestJSON";

type PermissionEntityType = "node" | "logic_gate";

type PermissionSubjectType = "user" | "group";

type CompanyUser = {
  company_id: string;
  user_id: string;
  email: string;
  display_name?: string;
  role: string;
};

type CompanyUserGroup = {
  company_id: string;
  group_id: string;
  parent_group_id?: string;
  name: string;
  position: number;
};

type CompanyUserGroupMember = {
  company_id: string;
  group_id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
};

type EntityPermission = {
  subject_type: PermissionSubjectType;
  subject_id: string;
  permission: "view";
};

type PermissionSelectionKey = `${PermissionSubjectType}:${string}`;

type EntityPermissionsDialogProps = {
  requestJSON: BoundRequestJSON;
  companyID: string;
  entityType: PermissionEntityType;
  entityID: string;
  title: string;
  onClose: () => void;
};

export const EntityPermissionsDialog: React.FC<EntityPermissionsDialogProps> = ({
  requestJSON,
  companyID,
  entityType,
  entityID,
  title,
  onClose,
}) => {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [members, setMembers] = useState<CompanyUserGroupMember[]>([]);
  const [selected, setSelected] = useState<Set<PermissionSelectionKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const permissionsPath = entityType === "node" ? `/v1/nodes/${encodeURIComponent(entityID)}/permissions` : `/v1/logic-gates/${encodeURIComponent(entityID)}/permissions`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError("");
      try {
        const [usersPayload, groupsPayload, permissionsPayload] = await Promise.all([
          requestJSON<{ users: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`),
          requestJSON<{ groups: CompanyUserGroup[]; members: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`),
          requestJSON<{ permissions: EntityPermission[] }>(`${permissionsPath}?company_id=${encodeURIComponent(companyID)}`),
        ]);
        if (cancelled) return;
        setUsers(usersPayload.users ?? []);
        setGroups(groupsPayload.groups ?? []);
        setMembers(groupsPayload.members ?? []);
        setSelected(new Set((permissionsPayload.permissions ?? []).map((item) => `${item.subject_type}:${item.subject_id}` as PermissionSelectionKey)));
      } catch (loadError) {
        if (!cancelled) {
          console.error("Failed to load permissions", loadError);
          setError("Failed to load permissions");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [companyID, permissionsPath, requestJSON]);

  const childrenByParent = useMemo(() => {
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

  const membersByGroup = useMemo(() => {
    const grouped = new Map<string, CompanyUserGroupMember[]>();
    for (const member of members) {
      const list = grouped.get(member.group_id) ?? [];
      list.push(member);
      grouped.set(member.group_id, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => permissionUserLabel(a).localeCompare(permissionUserLabel(b)));
    return grouped;
  }, [members]);

  const groupedUserIDs = useMemo(() => new Set(members.map((member) => member.user_id)), [members]);
  const ungroupedUsers = useMemo(() => users.filter((user) => !groupedUserIDs.has(user.user_id)).sort((a, b) => companyUserLabel(a).localeCompare(companyUserLabel(b))), [groupedUserIDs, users]);

  const toggle = (key: PermissionSelectionKey) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const permissions = Array.from(selected).map((key) => {
        const [subjectType, subjectID] = key.split(":", 2) as [PermissionSubjectType, string];
        return { subject_type: subjectType, subject_id: subjectID, permission: "view" };
      });
      await requestJSON(permissionsPath, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, permissions }),
      });
      onClose();
    } catch (saveError) {
      console.error("Failed to save permissions", saveError);
      setError("Failed to save permissions");
    } finally {
      setBusy(false);
    }
  };

  const renderGroup = (group: CompanyUserGroup, depth: number): React.ReactNode => {
    const key = `group:${group.group_id}` as PermissionSelectionKey;
    const groupMembers = membersByGroup.get(group.group_id) ?? [];
    const children = childrenByParent.get(group.group_id) ?? [];
    return (
      <div key={group.group_id} style={{ display: "grid", gap: 4, marginLeft: depth * 14 }}>
        <label style={permissionRowStyle}>
          <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
          <span style={permissionStrongTextStyle}>{group.name}</span>
          <span style={permissionMutedTextStyle}>{groupMembers.length} users</span>
        </label>
        {groupMembers.map((member) => {
          const userKey = `user:${member.user_id}` as PermissionSelectionKey;
          return (
            <label key={`${group.group_id}:${member.user_id}`} style={{ ...permissionRowStyle, marginLeft: 18 }}>
              <input type="checkbox" checked={selected.has(userKey)} onChange={() => toggle(userKey)} />
              <span>{permissionUserLabel(member)}</span>
            </label>
          );
        })}
        {children.map((child) => renderGroup(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={permissionBackdropStyle} onPointerDown={onClose}>
      <div style={permissionDialogStyle} onPointerDown={(event) => event.stopPropagation()}>
        <div style={permissionHeaderStyle}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <h2 style={permissionTitleStyle}>Permissions</h2>
            <div style={permissionMutedTextStyle}>{title}</div>
          </div>
          <button type="button" style={permissionIconButtonStyle} onClick={onClose} aria-label="Close permissions">x</button>
        </div>
        <div style={permissionInfoStyle}>
          {selected.size === 0 ? "Visible to all company users" : `${selected.size} permission assignments`}
        </div>
        {error && <div style={permissionErrorStyle}>{error}</div>}
        <div style={permissionListStyle}>
          {childrenByParent.get("")?.map((group) => renderGroup(group, 0))}
          {ungroupedUsers.length > 0 && (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={permissionSubheadStyle}>Ungrouped Users</div>
              {ungroupedUsers.map((user) => {
                const key = `user:${user.user_id}` as PermissionSelectionKey;
                return (
                  <label key={user.user_id} style={permissionRowStyle}>
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                    <span>{companyUserLabel(user)}</span>
                  </label>
                );
              })}
            </div>
          )}
          {groups.length === 0 && users.length === 0 && <div style={permissionMutedTextStyle}>No company users found.</div>}
        </div>
        <div style={permissionFooterStyle}>
          <button type="button" style={permissionSecondaryButtonStyle} onClick={() => setSelected(new Set())} disabled={busy}>Visible to all</button>
          <button type="button" style={permissionSecondaryButtonStyle} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" style={permissionPrimaryButtonStyle} onClick={save} disabled={busy}>{busy ? "Saving" : "Save"}</button>
        </div>
      </div>
    </div>
  );
};

function companyUserLabel(user: CompanyUser): string {
  const name = (user.display_name ?? "").trim();
  if (name && user.email) return `${name} <${user.email}>`;
  return name || user.email || user.user_id;
}

function permissionUserLabel(user: CompanyUserGroupMember): string {
  const name = (user.user_display_name ?? "").trim();
  const email = (user.user_email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

const permissionBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 180,
  background: "rgba(255,255,255,0.74)",
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const permissionDialogStyle: React.CSSProperties = {
  width: "min(620px, 100%)",
  maxHeight: "min(760px, calc(100vh - 32px))",
  border: "1px solid rgba(255, 136, 32, 0.64)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#111111",
  boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
  display: "grid",
  gridTemplateRows: "auto auto auto minmax(0, 1fr) auto",
  gap: 10,
  padding: 12,
  boxSizing: "border-box",
};

const permissionHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "start",
  gap: 10,
};

const permissionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.2,
};

const permissionIconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: "1px solid rgba(0,0,0,0.14)",
  borderRadius: 6,
  background: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
};

const permissionInfoStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  background: "#fbfbfb",
};

const permissionListStyle: React.CSSProperties = {
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 8,
  border: "1px solid rgba(0,0,0,0.1)",
  borderRadius: 6,
  padding: 8,
};

const permissionRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "5px 6px",
  fontSize: 12,
};

const permissionStrongTextStyle: React.CSSProperties = {
  minWidth: 0,
  fontWeight: 700,
  overflowWrap: "anywhere",
};

const permissionMutedTextStyle: React.CSSProperties = {
  minWidth: 0,
  color: "#5f6368",
  fontSize: 11,
  overflowWrap: "anywhere",
};

const permissionSubheadStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#333333",
  padding: "4px 6px",
};

const permissionErrorStyle: React.CSSProperties = {
  color: "#9c1b1b",
  fontSize: 12,
};

const permissionFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
};

const permissionSecondaryButtonStyle: React.CSSProperties = {
  minHeight: 32,
  border: "1px solid rgba(0,0,0,0.16)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  fontWeight: 700,
  padding: "0 10px",
};

const permissionPrimaryButtonStyle: React.CSSProperties = {
  ...permissionSecondaryButtonStyle,
  borderColor: "rgba(255,136,32,0.74)",
  background: "#ff8a00",
  color: "#111111",
};
