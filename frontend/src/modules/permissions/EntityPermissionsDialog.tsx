import React, { useEffect, useMemo, useState } from "react";
import type { BoundRequestJSON } from "../api/requestJSON";
import { listCompanyUsers } from "../communications/communicationsApi";

type PermissionEntityType = "node" | "logic_gate" | "project" | "company_explorer_folder" | "shared_triage_folder" | "shared_inbox_folder" | "shared_inbox";
type PermissionSubjectType = "user" | "group";
type ResourceAccessLevel = "no_access" | "view" | "edit" | "admin";

type CompanyUser = {
  company_id: string;
  user_id: string;
  email: string;
  display_name?: string;
  role: "dev_admin" | "company_admin" | "company_manager" | "company_user" | string;
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

type EntityEffectiveAccess = {
  user_id: string;
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
  readOnly?: boolean;
  permissionsPath?: string;
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
  readOnly?: boolean;
  permissionsPath?: string;
};

type PermissionPayload = {
  default_access?: "edit" | "no_access";
  override_user_ids?: string[];
  permissions?: EntityPermission[];
  access_grants?: EntityPermission[];
  effective_access?: EntityEffectiveAccess[];
  can_edit_permissions?: boolean;
  can_edit_manager_permissions?: boolean;
};

const EXPLICIT_ACCESS_OPTIONS: ReadonlyArray<{ value: ResourceAccessLevel; label: string }> = [
  { value: "no_access", label: "No Access" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
  { value: "admin", label: "Admin" },
];
const CUSTOM_GROUP_ACCESS = "__custom__";

function DefaultAccessToggle({
  defaultAccess,
  disabled,
  onChange,
}: {
  defaultAccess: "edit" | "no_access";
  disabled: boolean;
  onChange: (value: "edit" | "no_access") => void;
}) {
  const noAccessActive = defaultAccess === "no_access";
  const labelStyle = (active: boolean): React.CSSProperties => ({
    position: "relative",
    zIndex: 1,
    color: active ? "#334155" : "#64748b",
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1,
    transition: "color 160ms ease",
    whiteSpace: "nowrap",
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={noAccessActive}
      aria-label={noAccessActive ? "Default no access" : "Default edit"}
      disabled={disabled}
      onClick={() => onChange(noAccessActive ? "edit" : "no_access")}
      style={{
        position: "relative",
        height: 32,
        width: 220,
        flex: "0 0 220px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        alignItems: "center",
        padding: 2,
        border: "1px solid rgba(100, 116, 139, 0.18)",
        borderRadius: 10,
        background: "rgba(255, 255, 255, 0.56)",
        boxSizing: "border-box",
        color: "#334155",
        cursor: disabled ? "default" : "pointer",
        font: "inherit",
        appearance: "none",
        opacity: disabled ? 0.58 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 2,
          top: 2,
          width: "calc((100% - 4px) / 2)",
          height: 26,
          border: "1px solid rgba(71, 85, 105, 0.38)",
          borderRadius: 8,
          background: "#ffffff",
          boxShadow: "0 3px 8px rgba(15, 23, 42, 0.10)",
          transform: noAccessActive ? "translateX(100%)" : "translateX(0)",
          transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
          boxSizing: "border-box",
        }}
      />
      <span style={labelStyle(!noAccessActive)}>Default Edit</span>
      <span style={labelStyle(noAccessActive)}>Default No Access</span>
    </button>
  );
}

export const EntityPermissionsPanel: React.FC<EntityPermissionsPanelProps> = ({
  requestJSON,
  companyID,
  entityType,
  entityID,
  title,
  onClose,
  onSaved,
  variant = "dialog",
  readOnly = false,
  permissionsPath: permissionsPathOverride,
}) => {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [members, setMembers] = useState<CompanyUserGroupMember[]>([]);
  const [accessBySubject, setAccessBySubject] = useState<Map<PermissionSelectionKey, ResourceAccessLevel>>(new Map());
  const [effectiveAccessByUser, setEffectiveAccessByUser] = useState<Map<string, ResourceAccessLevel>>(new Map());
  const [defaultAccess, setDefaultAccess] = useState<"edit" | "no_access">("edit");
  const [serverCanEditPermissions, setServerCanEditPermissions] = useState(true);
  const [serverCanEditManagerPermissions, setServerCanEditManagerPermissions] = useState(true);
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const permissionsPath = useMemo(
    () => permissionsPathOverride ?? permissionsPathFor(entityType, entityID),
    [entityID, entityType, permissionsPathOverride],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError("");
      try {
        const [companyUsers, groupsPayload, permissionsPayload] = await Promise.all([
          listCompanyUsers(companyID),
          requestJSON<{ groups: CompanyUserGroup[]; members: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`),
          requestJSON<PermissionPayload>(`${permissionsPath}?company_id=${encodeURIComponent(companyID)}`),
        ]);
        if (cancelled) return;
        setUsers(companyUsers.map((user) => ({ ...user, email: user.email ?? "", role: user.role ?? "company_user" })));
        const loadedGroups = groupsPayload.groups ?? [];
        setGroups(loadedGroups);
        setMembers(groupsPayload.members ?? []);
        setExpandedGroupIDs(new Set(loadedGroups.map((group) => group.group_id)));
        const loadedDefaultAccess = permissionsPayload.default_access === "no_access" ? "no_access" : "edit";
        setDefaultAccess(loadedDefaultAccess);
        setAccessBySubject(
          permissionsPayload.override_user_ids && permissionsPayload.override_user_ids.length > 0
            ? overrideUserIDsToMap(permissionsPayload.override_user_ids, loadedDefaultAccess)
            : permissionsToMap(permissionsPayload.permissions ?? permissionsPayload.access_grants ?? []),
        );
        setEffectiveAccessByUser(effectiveAccessToMap(permissionsPayload.effective_access ?? []));
        setServerCanEditPermissions(permissionsPayload.can_edit_permissions === true);
        setServerCanEditManagerPermissions(permissionsPayload.can_edit_manager_permissions === true);
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
  const effectiveReadOnly = readOnly || !serverCanEditPermissions;
  const controlsDisabled = busy || effectiveReadOnly;
  const usesDefaultAccessPolicy = entityType === "node" || entityType === "logic_gate" || entityType === "project" || entityType === "company_explorer_folder" || entityType === "shared_triage_folder" || entityType === "shared_inbox_folder" || entityType === "shared_inbox";
  const defaultExceptionAccessLevel = oppositeDefaultAccess(defaultAccess);

  const setAccess = (key: PermissionSelectionKey, accessLevel: ResourceAccessLevel) => {
    if (effectiveReadOnly) return;
    setSaved(false);
    setAccessBySubject((previous) => {
      const next = new Map(previous);
      next.set(key, accessLevel);
      return next;
    });
  };

  const clearAccess = (key: PermissionSelectionKey) => {
    if (effectiveReadOnly) return;
    setSaved(false);
    setAccessBySubject((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  };

  const setDefaultAccessMode = (nextDefaultAccess: "edit" | "no_access") => {
    if (effectiveReadOnly || defaultAccess === nextDefaultAccess) return;
    setSaved(false);
    setDefaultAccess(nextDefaultAccess);
  };

  const setUserOverride = (userID: string, enabled: boolean) => {
    if (effectiveReadOnly) return;
    const cleanUserID = userID.trim();
    if (!cleanUserID) return;
    setSaved(false);
    setAccessBySubject((previous) => {
      const next = new Map(previous);
      const key = `user:${cleanUserID}` as PermissionSelectionKey;
      if (enabled) {
        next.set(key, defaultExceptionAccessLevel);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const canEditDefaultUserOverride = (user: CompanyUser | undefined): boolean => {
    if (!user || companyUserRoleForcesAdmin(user.role)) return false;
    if (companyUserRoleIsManager(user.role) && !serverCanEditManagerPermissions) return false;
    return true;
  };

  const defaultAccessLabelForUser = (user: CompanyUser | undefined, checked: boolean): string => {
    if (!user) return checked ? accessLevelLabel(defaultExceptionAccessLevel) : accessLevelLabel(defaultAccess);
    if (companyUserRoleForcesAdmin(user.role)) return "Admin";
    if (companyUserRoleIsManager(user.role) && !serverCanEditManagerPermissions) {
      return accessLevelLabel(effectiveAccessByUser.get(user.user_id) ?? defaultAccess);
    }
    return checked ? accessLevelLabel(defaultExceptionAccessLevel) : accessLevelLabel(defaultAccess);
  };

  const toggleExpandedGroup = (groupID: string) => {
    setExpandedGroupIDs((previous) => {
      const next = new Set(previous);
      if (next.has(groupID)) next.delete(groupID);
      else next.add(groupID);
      return next;
    });
  };

  const save = async () => {
    if (effectiveReadOnly) return;
    setBusy(true);
    setError("");
    try {
      const overrideUserIDs = Array.from(accessBySubject.keys())
        .map((key) => {
          const [subjectType, subjectID] = key.split(":", 2) as [PermissionSubjectType, string];
          return subjectType === "user" ? subjectID : "";
        })
        .filter((userID) => userID.trim() !== "");
      const permissions = Array.from(accessBySubject.entries()).map(([key, accessLevel]) => {
        const [subjectType, subjectID] = key.split(":", 2) as [PermissionSubjectType, string];
        const normalizedAccess = usesDefaultAccessPolicy ? defaultExceptionAccessLevel : accessLevel;
        return { subject_type: subjectType, subject_id: subjectID, permission: normalizedAccess, access_level: normalizedAccess };
      });
      await requestJSON(permissionsPath, {
        method: "PUT",
        body: JSON.stringify(usesDefaultAccessPolicy
          ? { company_id: companyID, default_access: defaultAccess, override_user_ids: overrideUserIDs, permissions }
          : { company_id: companyID, permissions }),
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

  const renderAccessSelect = (
    key: PermissionSelectionKey,
    options: { forcedAccessLevel?: ResourceAccessLevel | ""; effectiveAccessLevel?: ResourceAccessLevel | ""; forceOverridesDirect?: boolean; allowCustom?: boolean } = {},
  ) => {
    const forcedAccessLevel = options.forcedAccessLevel ?? "";
    const directAccessLevel = accessBySubject.get(key) ?? "";
    const effectiveAccessLevel = options.effectiveAccessLevel ?? "";
    const displayAccessLevel = options.forceOverridesDirect
      ? forcedAccessLevel || directAccessLevel || effectiveAccessLevel || ""
      : directAccessLevel || effectiveAccessLevel || forcedAccessLevel || "";
    const value = options.allowCustom && !forcedAccessLevel && !directAccessLevel ? CUSTOM_GROUP_ACCESS : displayAccessLevel;
    const forcedOnly = !!forcedAccessLevel && !directAccessLevel && (options.forceOverridesDirect || !effectiveAccessLevel || effectiveAccessLevel === forcedAccessLevel);
    return (
      <select
        value={value}
        onChange={(event) => {
          if (event.target.value === CUSTOM_GROUP_ACCESS) {
            clearAccess(key);
            return;
          }
          setAccess(key, event.target.value as ResourceAccessLevel);
        }}
        style={permissionSelectStyle}
        disabled={controlsDisabled || (!!forcedAccessLevel && (options.forceOverridesDirect || !directAccessLevel))}
        aria-label="Access level"
      >
        {forcedOnly
          ? <option value={forcedAccessLevel}>{roleAccessLabel(forcedAccessLevel)}</option>
          : (
            <>
              {!options.allowCustom && <option value="" hidden>No Access</option>}
              {options.allowCustom && <option value={CUSTOM_GROUP_ACCESS}>Custom</option>}
              {EXPLICIT_ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </>
          )}
      </select>
    );
  };

  const renderGroup = (group: CompanyUserGroup, depth: number): React.ReactNode => {
    const groupKey = `group:${group.group_id}` as PermissionSelectionKey;
    const groupAccessLevel = accessBySubject.get(groupKey) ?? "";
    const groupMembers = membersByGroup.get(group.group_id) ?? [];
    const children = childrenByParent.get(group.group_id) ?? [];
    return (
      <div key={group.group_id} style={{ display: "grid", gap: 4, marginLeft: depth * 14 }}>
        <div style={permissionRowStyle}>
          <span style={permissionStrongTextStyle}>{group.name}</span>
          <span style={permissionMutedTextStyle}>{groupMembers.length} users</span>
          {renderAccessSelect(groupKey, { allowCustom: true })}
        </div>
        {groupMembers.map((member) => {
          const userKey = `user:${member.user_id}` as PermissionSelectionKey;
          const user = usersByID.get(member.user_id);
          const roleForcesAdmin = companyUserRoleForcesAdmin(user?.role);
          const forcedAccessLevel = roleForcesAdmin ? "admin" : groupAccessLevel;
          const forceOverridesDirect = !roleForcesAdmin && !!groupAccessLevel;
          return (
            <div key={`${group.group_id}:${member.user_id}`} style={{ ...permissionRowStyle, marginLeft: 18 }}>
              <span>{permissionUserLabel(member)}</span>
              <span style={permissionMutedTextStyle}>{companyUserRoleLabel(user?.role)}</span>
              {renderAccessSelect(userKey, { forcedAccessLevel, effectiveAccessLevel: effectiveAccessByUser.get(member.user_id) ?? "", forceOverridesDirect })}
            </div>
          );
        })}
        {children.map((child) => renderGroup(child, depth + 1))}
      </div>
    );
  };

  const renderDefaultUserRow = (user: CompanyUser, label: string, keySuffix: string, depth = 0): React.ReactNode => {
    const key = `user:${user.user_id}` as PermissionSelectionKey;
    const checked = accessBySubject.has(key);
    const editable = canEditDefaultUserOverride(user);
    return (
      <label key={keySuffix} style={{ ...permissionRowStyle, marginLeft: depth * 14, opacity: editable || companyUserRoleForcesAdmin(user.role) ? 1 : 0.72 }}>
        <span>{label}</span>
        <span style={permissionMutedTextStyle}>{companyUserRoleLabel(user.role)} · {defaultAccessLabelForUser(user, checked)}</span>
        {companyUserRoleForcesAdmin(user.role) ? (
          <span style={permissionMutedTextStyle}>Admin</span>
        ) : (
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => {
              if (editable) setUserOverride(user.user_id, event.currentTarget.checked);
            }}
            disabled={controlsDisabled || !editable}
            aria-label="Permission exception"
            style={permissionCheckboxStyle}
          />
        )}
      </label>
    );
  };

  const renderDefaultGroup = (group: CompanyUserGroup, depth: number): React.ReactNode => {
    const groupMembers = membersByGroup.get(group.group_id) ?? [];
    const children = childrenByParent.get(group.group_id) ?? [];
    const expanded = expandedGroupIDs.has(group.group_id);
    const visibleCount = groupMembers.length + children.length;
    return (
      <div key={group.group_id} style={{ display: "grid", gap: 4, marginLeft: depth * 14 }}>
        <div style={permissionGroupRowStyle}>
          <button
            type="button"
            style={permissionDisclosureButtonStyle}
            onClick={() => toggleExpandedGroup(group.group_id)}
            aria-label={expanded ? "Collapse group" : "Expand group"}
          >
            {expanded ? "-" : "+"}
          </button>
          <span style={permissionStrongTextStyle}>{group.name}</span>
          <span style={permissionMutedTextStyle}>{visibleCount} items</span>
        </div>
        {expanded && groupMembers.map((member) => {
          const user = usersByID.get(member.user_id);
          return user ? renderDefaultUserRow(user, permissionUserLabel(member), `${group.group_id}:${member.user_id}`, 1) : null;
        })}
        {expanded && children.map((child) => renderDefaultGroup(child, depth + 1))}
      </div>
    );
  };

  const dialogMode = variant === "dialog";
  const containerStyle = dialogMode ? permissionDialogStyle : permissionEmbeddedStyle;
  const actionButtons = (
    <div style={permissionHeaderActionsStyle}>
      <button className="mango-elevated-action" type="button" style={permissionSecondaryButtonStyle} onClick={() => { if (!effectiveReadOnly) { setSaved(false); setAccessBySubject(new Map()); } }} disabled={controlsDisabled}>{usesDefaultAccessPolicy ? "Clear exceptions" : "Clear grants"}</button>
      {usesDefaultAccessPolicy && <DefaultAccessToggle defaultAccess={defaultAccess} disabled={controlsDisabled} onChange={setDefaultAccessMode} />}
      {onClose && <button className="mango-elevated-action" type="button" style={permissionSecondaryButtonStyle} onClick={onClose} disabled={busy}>Cancel</button>}
      <button className="mango-elevated-action" type="button" style={permissionPrimaryButtonStyle} onClick={save} disabled={controlsDisabled}>{busy ? "Saving" : "Save"}</button>
      {onClose && (
        <button className="mango-elevated-action" type="button" style={permissionIconButtonStyle} onClick={onClose} aria-label="Close permissions">x</button>
      )}
    </div>
  );

  return (
    <div className="mango-editor-hover-highlight" style={containerStyle}>
      <div style={permissionHeaderStyle}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <h2 style={permissionTitleStyle}>Permissions</h2>
          <div style={permissionMutedTextStyle}>{title}</div>
        </div>
        {actionButtons}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={permissionInfoStyle}>
          {permissionSummaryText(saved, assignmentCount, entityType, defaultAccess)}
        </div>
        {effectiveReadOnly && <div style={permissionReadOnlyNoticeStyle}>Manager or admin edit access is required to edit permissions.</div>}
        {error && <div style={permissionErrorStyle}>{error}</div>}
      </div>
      <div style={permissionListStyle}>
        {usesDefaultAccessPolicy ? (
          <div style={{ display: "grid", gap: 4 }}>
            {childrenByParent.get("")?.map((group) => renderDefaultGroup(group, 0))}
            {ungroupedUsers.length > 0 && (
              <>
                <div style={permissionSubheadStyle}>Ungrouped Users</div>
                {ungroupedUsers.map((user) => renderDefaultUserRow(user, companyUserLabel(user), user.user_id))}
              </>
            )}
          </div>
        ) : (
          <>
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
                  {renderAccessSelect(key, { forcedAccessLevel, effectiveAccessLevel: effectiveAccessByUser.get(user.user_id) ?? "" })}
                </div>
              );
            })}
          </div>
            )}
          </>
        )}
        {groups.length === 0 && users.length === 0 && <div style={permissionMutedTextStyle}>No company users found.</div>}
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
          readOnly={props.readOnly}
          permissionsPath={props.permissionsPath}
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
    case "project":
      return `/v1/projects/${encodeURIComponent(entityID)}/permissions`;
    case "company_explorer_folder":
      return `/v1/company-explorer/folders/${encodeURIComponent(entityID)}/permissions`;
    case "shared_triage_folder":
    case "shared_inbox_folder":
    case "shared_inbox":
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
  return role === "dev_admin" || role === "company_admin" || role === "owner" || role === "admin";
}

function companyUserRoleIsManager(role: string | undefined): boolean {
  return role === "company_manager" || role === "manager";
}

function companyUserRoleLabel(role: string | undefined): string {
  switch (role) {
    case "dev_admin":
      return "Dev Admin";
    case "company_admin":
      return "Company Admin";
    case "company_manager":
    case "manager":
      return "Manager";
    default:
      return "User";
  }
}

function permissionSummaryText(saved: boolean, assignmentCount: number, entityType: PermissionEntityType, defaultAccess: "edit" | "no_access"): string {
  if (saved) return "Permissions saved. Dev admins and company admins always keep admin access. Managers follow resource permissions.";
  if (entityType === "node" || entityType === "logic_gate" || entityType === "project" || entityType === "company_explorer_folder" || entityType === "shared_triage_folder" || entityType === "shared_inbox_folder" || entityType === "shared_inbox") {
    const defaultLabel = defaultAccess === "edit" ? "Default edit" : "Default no access";
    if (assignmentCount > 0) return `${defaultLabel}. ${assignmentCount} exception users. Dev admins and company admins always keep admin access. Managers follow resource permissions.`;
    return `${defaultLabel}. No exception users. Dev admins and company admins always keep admin access. Managers follow resource permissions.`;
  }
  if (assignmentCount > 0) return `${assignmentCount} access grants. Dev admins and company admins always keep admin access. Managers follow resource permissions.`;
  return "No explicit grants. Access is denied except for dev admins and company admins.";
}

function oppositeDefaultAccess(defaultAccess: "edit" | "no_access"): "edit" | "no_access" {
  return defaultAccess === "edit" ? "no_access" : "edit";
}

function overrideUserIDsToMap(userIDs: string[], defaultAccess: "edit" | "no_access"): Map<PermissionSelectionKey, ResourceAccessLevel> {
  const out = new Map<PermissionSelectionKey, ResourceAccessLevel>();
  const accessLevel = oppositeDefaultAccess(defaultAccess);
  for (const rawUserID of userIDs) {
    const userID = rawUserID.trim();
    if (!userID) continue;
    out.set(`user:${userID}` as PermissionSelectionKey, accessLevel);
  }
  return out;
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

function effectiveAccessToMap(items: EntityEffectiveAccess[]): Map<string, ResourceAccessLevel> {
  const out = new Map<string, ResourceAccessLevel>();
  for (const item of items) {
    const userID = item.user_id?.trim();
    const accessLevel = item.access_level;
    if (!userID) continue;
    if (accessLevel !== "no_access" && accessLevel !== "view" && accessLevel !== "edit" && accessLevel !== "admin") continue;
    out.set(userID, accessLevel);
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

const PERMISSION_PANEL_BACKGROUND = "linear-gradient(180deg, #fbfbfd 0%, #f2f4f8 100%)";
const PERMISSION_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)";
const PERMISSION_ACTIVE_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f5f6fa 100%)";
const PERMISSION_EDGE_FRAME = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
const PERMISSION_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.26), -7px -7px 16px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";
const PERMISSION_PANEL_SHADOW = "inset 0 0 0 1px rgba(255, 255, 255, 0.72), inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255, 255, 255, 0.86), 0 18px 42px rgba(15, 23, 42, 0.16)";

const permissionBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 180,
  background: "rgba(241, 245, 249, 0.66)",
  backdropFilter: "blur(14px) saturate(1.18)",
  WebkitBackdropFilter: "blur(14px) saturate(1.18)",
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const permissionDialogStyle: React.CSSProperties = {
  width: "min(680px, 100%)",
  maxHeight: "min(760px, calc(100vh - 32px))",
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 18,
  background: PERMISSION_PANEL_BACKGROUND,
  color: "#111827",
  boxShadow: PERMISSION_PANEL_SHADOW,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 12,
  padding: 14,
  boxSizing: "border-box",
};

const permissionEmbeddedStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 16,
  background: PERMISSION_PANEL_BACKGROUND,
  color: "#111827",
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 12,
  padding: 14,
  boxSizing: "border-box",
  boxShadow: PERMISSION_PANEL_SHADOW,
};

const permissionHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "start",
  gap: 10,
  padding: "8px 10px",
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 12,
  background: "linear-gradient(90deg, rgba(255, 241, 242, 0.74), rgba(254, 249, 195, 0.52) 34%, rgba(236, 253, 245, 0.54) 66%, rgba(239, 246, 255, 0.70))",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08), inset 1px 1px 0 rgba(255, 255, 255, 0.88)",
};

const permissionHeaderActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const permissionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: 1.2,
  fontWeight: 850,
};

const permissionIconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 8,
  background: PERMISSION_SURFACE,
  boxShadow: PERMISSION_SHADOW,
  cursor: "pointer",
  fontWeight: 700,
};

const permissionInfoStyle: React.CSSProperties = {
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 10,
  padding: "8px 10px",
  fontSize: 12,
  background: "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(230,252,255,0.52) 46%, rgba(247,239,255,0.58))",
  boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
};

const permissionReadOnlyNoticeStyle: React.CSSProperties = {
  border: "1px solid rgba(185, 28, 28, 0.32)",
  borderRadius: 6,
  padding: "10px 12px",
  fontSize: 15,
  fontWeight: 700,
  background: "#fff7f7",
  color: "#991b1b",
};

const permissionListStyle: React.CSSProperties = {
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 7,
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 12,
  padding: 8,
  background: "rgba(255, 255, 255, 0.42)",
  boxShadow: "inset 4px 4px 14px rgba(174, 174, 192, 0.16), inset -4px -4px 14px rgba(255, 255, 255, 0.82)",
};

const permissionRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto 120px",
  alignItems: "center",
  gap: 8,
  padding: "7px 8px",
  fontSize: 12,
  border: "1px solid rgba(255, 255, 255, 0.70)",
  borderRadius: 10,
  background: PERMISSION_SURFACE,
  boxShadow: "3px 3px 9px rgba(174, 174, 192, 0.16), -3px -3px 9px rgba(255, 255, 255, 0.78)",
};

const permissionGroupRowStyle: React.CSSProperties = {
  ...permissionRowStyle,
  gridTemplateColumns: "24px minmax(0, 1fr) auto",
};

const permissionDisclosureButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 850,
  lineHeight: 1,
  padding: 0,
};

const permissionSelectStyle: React.CSSProperties = {
  minWidth: 0,
  height: 30,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: PERMISSION_ACTIVE_SURFACE,
  boxShadow: "inset 2px 2px 6px rgba(174, 174, 192, 0.18), inset -2px -2px 6px rgba(255, 255, 255, 0.82)",
  fontSize: 12,
  color: "#111827",
  fontWeight: 700,
  padding: "0 8px",
};

const permissionCheckboxStyle: React.CSSProperties = {
  justifySelf: "center",
  width: 18,
  height: 18,
  accentColor: "#2563eb",
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
  fontWeight: 850,
  color: "#334155",
  padding: "4px 6px",
};

const permissionErrorStyle: React.CSSProperties = {
  color: "#b00020",
  fontSize: 12,
};

const permissionSecondaryButtonStyle: React.CSSProperties = {
  minHeight: 32,
  border: "1px solid rgba(255, 255, 255, 0.72)",
  borderRadius: 10,
  background: PERMISSION_SURFACE,
  color: "#111111",
  cursor: "pointer",
  fontWeight: 700,
  padding: "0 10px",
  boxShadow: PERMISSION_SHADOW,
  transition: "background 150ms ease, border-color 150ms ease, box-shadow 170ms ease, transform 170ms ease",
};

const permissionPrimaryButtonStyle: React.CSSProperties = {
  ...permissionSecondaryButtonStyle,
  borderColor: "transparent",
  background: `${PERMISSION_ACTIVE_SURFACE} padding-box, ${PERMISSION_EDGE_FRAME} border-box`,
  color: "#0f172a",
  boxShadow: `${PERMISSION_SHADOW}, 0 0 0 1px rgba(120, 224, 255, 0.18), 0 0 14px rgba(183, 124, 255, 0.20)`,
};
