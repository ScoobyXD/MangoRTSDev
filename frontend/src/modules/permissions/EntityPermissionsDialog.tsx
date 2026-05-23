import React, { useEffect, useMemo, useState } from "react";
import type { BoundRequestJSON } from "../api/requestJSON";

type PermissionEntityType = "node" | "logic_gate" | "shared_triage_folder";
type PermissionSubjectType = "user" | "group";
type ResourceAccessLevel = "no_access" | "view" | "edit" | "admin";

type CompanyUser = {
  company_id: string;
  user_id: string;
  email: string;
  display_name?: string;
  role: "dev_admin" | "company_admin" | "company_user" | string;
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
  permission?: ResourceAccessLevel;
  access_level?: ResourceAccessLevel;
};

type PermissionSelectionKey = `${PermissionSubjectType}:${string}`;

type EntityPermissionsDialogProps = {
  requestJSON: BoundRequestJSON;
  companyID: string;
  entityType: PermissionEntityType;
  entityID: string;
  title: string;
  onClose: () => void;
  onSaved?: () => void;
};

type EntityPermissionsPanelProps = {
  requestJSON: BoundRequestJSON;
  companyID: string;
  entityType: PermissionEntityType;
  entityID: string;
  title: string;
  onClose?: () => void;
  onSaved?: () => void;
  variant?: "dialog" | "embedded";
};

type PermissionPayload = {
  permissions?: EntityPermission[];
  access_grants?: EntityPermission[];
};

const EXPLICIT_ACCESS_OPTIONS: ReadonlyArray<{ value: ResourceAccessLevel; label: string }> = [
  { value: "no_access", label: "No Access" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
  { value: "admin", label: "Admin" },
];

export const EntityPermissionsPanel: React.FC<EntityPermissionsPanelProps> = ({
  requestJSON,
  companyID,
  entityType,
  entityID,
  title,
  onClose,
  onSaved,
  variant = "dialog",
}) => {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [members, setMembers] = useState<CompanyUserGroupMember[]>([]);
  const [accessBySubject, setAccessBySubject] = useState<Map<PermissionSelectionKey, ResourceAccessLevel>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const permissionsPath = permissionsPathFor(entityType, entityID);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError("");
      try {
        const [usersPayload, groupsPayload, permissionsPayload] = await Promise.all([
          requestJSON<{ users: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`),
          requestJSON<{ groups: CompanyUserGroup[]; members: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`),
          requestJSON<PermissionPayload>(`${permissionsPath}?company_id=${encodeURIComponent(companyID)}`),
        ]);
        if (cancelled) return;
        setUsers(usersPayload.users ?? []);
        setGroups(groupsPayload.groups ?? []);
        setMembers(groupsPayload.members ?? []);
        setAccessBySubject(permissionsToMap(permissionsPayload.permissions ?? permissionsPayload.access_grants ?? []));
        setSaved(false);
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
  const usersByID = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);
  const ungroupedUsers = useMemo(() => users.filter((user) => !groupedUserIDs.has(user.user_id)).sort((a, b) => companyUserLabel(a).localeCompare(companyUserLabel(b))), [groupedUserIDs, users]);
  const assignmentCount = accessBySubject.size;

  const setAccess = (key: PermissionSelectionKey, accessLevel: ResourceAccessLevel) => {
    setSaved(false);
    setAccessBySubject((previous) => {
      const next = new Map(previous);
      next.set(key, accessLevel);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const permissions = Array.from(accessBySubject.entries()).map(([key, accessLevel]) => {
        const [subjectType, subjectID] = key.split(":", 2) as [PermissionSubjectType, string];
        return { subject_type: subjectType, subject_id: subjectID, permission: accessLevel, access_level: accessLevel };
      });
      await requestJSON(permissionsPath, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, permissions }),
      });
      setSaved(true);
      onSaved?.();
      onClose?.();
    } catch (saveError) {
      console.error("Failed to save permissions", saveError);
      setError("Failed to save permissions");
    } finally {
      setBusy(false);
    }
  };

  const renderAccessSelect = (key: PermissionSelectionKey, forcedAccessLevel: ResourceAccessLevel | "" = "") => (
    <select
      value={forcedAccessLevel || accessBySubject.get(key) || ""}
      onChange={(event) => setAccess(key, event.target.value as ResourceAccessLevel)}
      style={permissionSelectStyle}
      disabled={busy || !!forcedAccessLevel}
      aria-label="Access level"
    >
      {forcedAccessLevel
        ? <option value={forcedAccessLevel}>{roleAccessLabel(forcedAccessLevel)}</option>
        : (
          <>
            <option value="" hidden>No Access</option>
            {EXPLICIT_ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </>
        )}
    </select>
  );

  const renderGroup = (group: CompanyUserGroup, depth: number): React.ReactNode => {
    const groupKey = `group:${group.group_id}` as PermissionSelectionKey;
    const groupMembers = membersByGroup.get(group.group_id) ?? [];
    const children = childrenByParent.get(group.group_id) ?? [];
    return (
      <div key={group.group_id} style={{ display: "grid", gap: 4, marginLeft: depth * 14 }}>
        <div style={permissionRowStyle}>
          <span style={permissionStrongTextStyle}>{group.name}</span>
          <span style={permissionMutedTextStyle}>{groupMembers.length} users</span>
          {renderAccessSelect(groupKey)}
        </div>
        {groupMembers.map((member) => {
          const userKey = `user:${member.user_id}` as PermissionSelectionKey;
          const user = usersByID.get(member.user_id);
          const forcedAccessLevel = companyUserRoleForcesAdmin(user?.role) ? "admin" : "";
          return (
            <div key={`${group.group_id}:${member.user_id}`} style={{ ...permissionRowStyle, marginLeft: 18 }}>
              <span>{permissionUserLabel(member)}</span>
              <span style={permissionMutedTextStyle}>{companyUserRoleLabel(user?.role)}</span>
              {renderAccessSelect(userKey, forcedAccessLevel)}
            </div>
          );
        })}
        {children.map((child) => renderGroup(child, depth + 1))}
      </div>
    );
  };

  const dialogMode = variant === "dialog";
  const containerStyle = dialogMode ? permissionDialogStyle : permissionEmbeddedStyle;

  return (
    <div style={containerStyle}>
      <div style={permissionHeaderStyle}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <h2 style={permissionTitleStyle}>Permissions</h2>
          <div style={permissionMutedTextStyle}>{title}</div>
        </div>
        {onClose && (
          <button type="button" style={permissionIconButtonStyle} onClick={onClose} aria-label="Close permissions">x</button>
        )}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={permissionInfoStyle}>
          {permissionSummaryText(saved, assignmentCount, entityType)}
        </div>
        {error && <div style={permissionErrorStyle}>{error}</div>}
      </div>
      <div style={permissionListStyle}>
        {childrenByParent.get("")?.map((group) => renderGroup(group, 0))}
        {ungroupedUsers.length > 0 && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={permissionSubheadStyle}>Ungrouped Users</div>
            {ungroupedUsers.map((user) => {
              const key = `user:${user.user_id}` as PermissionSelectionKey;
              const forcedAccessLevel = companyUserRoleForcesAdmin(user.role) ? "admin" : "";
              return (
                <div key={user.user_id} style={permissionRowStyle}>
                  <span>{companyUserLabel(user)}</span>
                  <span style={permissionMutedTextStyle}>{companyUserRoleLabel(user.role)}</span>
                  {renderAccessSelect(key, forcedAccessLevel)}
                </div>
              );
            })}
          </div>
        )}
        {groups.length === 0 && users.length === 0 && <div style={permissionMutedTextStyle}>No company users found.</div>}
      </div>
      <div style={permissionFooterStyle}>
        <button type="button" style={permissionSecondaryButtonStyle} onClick={() => { setSaved(false); setAccessBySubject(new Map()); }} disabled={busy}>{"Clear grants"}</button>
        {onClose && <button type="button" style={permissionSecondaryButtonStyle} onClick={onClose} disabled={busy}>Cancel</button>}
        <button type="button" style={permissionPrimaryButtonStyle} onClick={save} disabled={busy}>{busy ? "Saving" : "Save"}</button>
      </div>
    </div>
  );
};

export const EntityPermissionsDialog: React.FC<EntityPermissionsDialogProps> = (props) => {
  return (
    <div style={permissionBackdropStyle} onPointerDown={props.onClose}>
      <div onPointerDown={(event) => event.stopPropagation()}>
        <EntityPermissionsPanel
          requestJSON={props.requestJSON}
          companyID={props.companyID}
          entityType={props.entityType}
          entityID={props.entityID}
          title={props.title}
          onClose={props.onClose}
          onSaved={props.onSaved}
          variant="dialog"
        />
      </div>
    </div>
  );
};

function permissionsPathFor(entityType: PermissionEntityType, entityID: string): string {
  switch (entityType) {
    case "node":
      return `/v1/nodes/${encodeURIComponent(entityID)}/permissions`;
    case "logic_gate":
      return `/v1/logic-gates/${encodeURIComponent(entityID)}/permissions`;
    case "shared_triage_folder":
      return `/v1/communications/shared-inboxes/${encodeURIComponent(entityID)}/access`;
  }
}

function accessLevelLabel(accessLevel: ResourceAccessLevel): string {
  switch (accessLevel) {
    case "no_access":
      return "No Access";
    case "view":
      return "View";
    case "edit":
      return "Edit";
    case "admin":
      return "Admin";
  }
}

function roleAccessLabel(accessLevel: ResourceAccessLevel): string {
  return accessLevelLabel(accessLevel);
}

function companyUserRoleForcesAdmin(role: string | undefined): boolean {
  return role === "dev_admin" || role === "company_admin";
}

function companyUserRoleLabel(role: string | undefined): string {
  switch (role) {
    case "dev_admin":
      return "Dev Admin";
    case "company_admin":
      return "Company Admin";
    default:
      return "User";
  }
}

function permissionSummaryText(saved: boolean, assignmentCount: number, entityType: PermissionEntityType): string {
  if (saved) return "Permissions saved. Dev admins and company admins always keep admin access.";
  if (assignmentCount > 0) return `${assignmentCount} access grants. Dev admins and company admins always keep admin access.`;
  if (entityType === "shared_triage_folder") return "No grants saved here. Parent Shared Triage grants can still apply; otherwise access is denied except for dev admins and company admins.";
  return "No explicit grants. Access is denied except for dev admins and company admins.";
}

function permissionsToMap(permissions: EntityPermission[]): Map<PermissionSelectionKey, ResourceAccessLevel> {
  const out = new Map<PermissionSelectionKey, ResourceAccessLevel>();
  for (const permission of permissions) {
    const accessLevel = permission.access_level ?? permission.permission;
    if (accessLevel !== "no_access" && accessLevel !== "view" && accessLevel !== "edit" && accessLevel !== "admin") continue;
    out.set(`${permission.subject_type}:${permission.subject_id}` as PermissionSelectionKey, accessLevel);
  }
  return out;
}

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
  width: "min(680px, 100%)",
  maxHeight: "min(760px, calc(100vh - 32px))",
  border: "1px solid rgba(0, 188, 212, 0.64)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#111111",
  boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto",
  gap: 10,
  padding: 12,
  boxSizing: "border-box",
};

const permissionEmbeddedStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  border: "1px solid rgba(0, 188, 212, 0.42)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#111111",
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto",
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
  gridTemplateColumns: "minmax(0, 1fr) auto 120px",
  alignItems: "center",
  gap: 8,
  padding: "5px 6px",
  fontSize: 12,
};

const permissionSelectStyle: React.CSSProperties = {
  minWidth: 0,
  height: 30,
  border: "1px solid rgba(0,0,0,0.16)",
  borderRadius: 6,
  background: "#ffffff",
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
  borderColor: "rgba(0,188,212,0.74)",
  background: "#00bcd4",
  color: "#111111",
};
